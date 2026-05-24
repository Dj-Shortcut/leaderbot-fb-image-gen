import type { Express } from "express";
import { z } from "zod";
import { processInternalMessengerImageRequest } from "./messengerWebhook";

const internalImageRequestSchema = z.object({
  psid: z.string().trim().min(1),
  prompt: z.string().trim().min(1).max(2_000),
  reqId: z.string().trim().min(1).max(128),
  lang: z.enum(["nl", "en"]).optional(),
  timestamp: z.number().int().positive().optional(),
});

function getInternalImageRequestToken(): string {
  return (
    process.env.INTERNAL_IMAGE_REQUEST_TOKEN?.trim() ||
    process.env.ADMIN_TOKEN?.trim() ||
    ""
  );
}

function readBearerToken(header: string | undefined): string {
  const value = header?.trim() ?? "";
  const spaceIndex = value.indexOf(" ");
  

  if (spaceIndex === -1) {
    return "";
  }

  const scheme = value.slice(0, spaceIndex);
  const token = value.slice(spaceIndex + 1).trim();

  if (scheme.toLowerCase() !== "bearer" || !token) {
    return "";
  }

  return token;
}

export function registerInternalImageRequestRoutes(app: Express): void {
  app.post("/internal/messenger/image-request", async (req, res) => {
    const expectedToken = getInternalImageRequestToken();
    const providedToken = readBearerToken(req.header("authorization"));
    if (!expectedToken || providedToken !== expectedToken) {
      res.sendStatus(403);
      return;
    }

    const parsed = internalImageRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid image request payload" });
      return;
    }

    res.status(202).json({ status: "queued" });
     void processInternalMessengerImageRequest(parsed.data).catch(
      (error: unknown) => {
        console.error("[internal image request] failed", {
          error:
            error instanceof Error ? error.message : String(error),
        });
      }
    );