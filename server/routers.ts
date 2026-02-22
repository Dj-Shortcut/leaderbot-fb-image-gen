import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import {
  canUserGenerateImage,
  incrementUserQuota,
  createImageRequest,
  updateImageRequest,
  getUserImageRequests,
  getCompletedImages,
  getTodayStats,
  updateTodayStats,
  logNotification,
  getRecentNotifications,
  getUserById,
} from "./db";
import { generateImage } from "./_core/imageGeneration";
import { storagePut } from "./storage";
import { notifyOwner } from "./_core/notification";
import { TRPCError } from "@trpc/server";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Image generation procedures
  image: router({
    /**
     * Generate an image from a text prompt
     * Enforces daily quota limit (1 per user per 24 hours)
     */
    generate: protectedProcedure
      .input(z.object({ prompt: z.string().min(5).max(500) }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;

        // Check if user has quota remaining
        const canGenerate = await canUserGenerateImage(userId);
        if (!canGenerate) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You have reached your daily image generation limit. Please try again tomorrow.",
          });
        }

        let requestId = 0;
        try {
          // Create pending image request record
          const requestResult = await createImageRequest({
            userId,
            prompt: input.prompt,
            status: "pending",
          });

          requestId = (requestResult as any).insertId || 0;

          // Generate the image
          const { url: imageUrl } = await generateImage({
            prompt: input.prompt,
          });

          // Upload to S3 with user-specific path
          const fileName = `${userId}-${Date.now()}.png`;
          const fileKey = `images/${userId}/${fileName}`;

          // For now, we'll use the URL directly from the image generation service
          // In production, you might want to download and re-upload to S3 for persistence
          const imageKey = fileKey;

          // Update the image request with completion details
          await updateImageRequest(requestId, {
            imageUrl,
            imageKey,
            status: "completed",
            completedAt: new Date(),
          });

          // Increment user's daily quota
          await incrementUserQuota(userId);

          // Update today's usage statistics
          const todayStats = await getTodayStats();
          if (todayStats) {
            await updateTodayStats({
              totalImagesGenerated: todayStats.totalImagesGenerated + 1,
            });
          } else {
            await updateTodayStats({
              totalImagesGenerated: 1,
              totalUsersActive: 1,
            });
          }

          // Send owner notification if milestone reached
          const stats = await getTodayStats();
          if (stats && stats.totalImagesGenerated % 10 === 0) {
            await notifyOwner({
              title: "Milestone Reached! 🎉",
              content: `Your Leaderbot has generated ${stats.totalImagesGenerated} images today!`,
            });
            await logNotification({
              type: "milestone",
              title: "Milestone Reached",
              content: `Generated ${stats.totalImagesGenerated} images today`,
              metadata: { count: stats.totalImagesGenerated },
              sent: 1,
            });
          }

          return {
            success: true,
            imageUrl,
            requestId,
            message: "Image generated successfully!",
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";

          // Log failed request
          if (requestId) {
            await updateImageRequest(requestId, {
              status: "failed",
              errorMessage,
              completedAt: new Date(),
            });
          }

          // Update failed request count
          const todayStats = await getTodayStats();
          if (todayStats) {
            await updateTodayStats({
              totalFailedRequests: todayStats.totalFailedRequests + 1,
            });
          }

          // Send error notification to owner
          await notifyOwner({
            title: "Image Generation Error",
            content: `Failed to generate image for user ${ctx.user.name}: ${errorMessage}`,
          });

          await logNotification({
            type: "error",
            title: "Image Generation Failed",
            content: `Error: ${errorMessage}`,
            metadata: { userId, prompt: input.prompt },
            sent: 1,
          });

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to generate image. Please try again later.",
          });
        }
      }),

    /**
     * Check if user can generate an image today
     */
    checkQuota: protectedProcedure.query(async ({ ctx }) => {
      const canGenerate = await canUserGenerateImage(ctx.user.id);
      return { canGenerate };
    }),

    /**
     * Get user's image generation history
     */
    getUserImages: protectedProcedure
      .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
      .query(async ({ ctx, input }) => {
        const images = await getUserImageRequests(ctx.user.id, input.limit, input.offset);
        return images;
      }),

    /**
     * Get gallery of all completed images (public)
     */
    getGallery: publicProcedure
      .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
      .query(async ({ input }) => {
        const images = await getCompletedImages(input.limit, input.offset);
        return images;
      }),
  }),

  // Admin procedures
  admin: router({
    /**
     * Get today's usage statistics (admin only)
     */
    getStats: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can access statistics",
        });
      }

      const stats = await getTodayStats();
      return stats || {
        date: new Date().toISOString().split('T')[0],
        totalImagesGenerated: 0,
        totalUsersActive: 0,
        totalFailedRequests: 0,
      };
    }),

    /**
     * Get recent notifications (admin only)
     */
    getNotifications: protectedProcedure
      .input(z.object({ limit: z.number().default(20) }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admins can access notifications",
          });
        }

        const notifications = await getRecentNotifications(input.limit);
        return notifications;
      }),

    /**
     * Get all users and their usage (admin only)
     */
    getAllUsers: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can access user data",
        });
      }

      // This would require adding a query to db.ts to get all users with their stats
      // For now, returning empty array as placeholder
      return [];
    }),
  }),
});

export type AppRouter = typeof appRouter;
