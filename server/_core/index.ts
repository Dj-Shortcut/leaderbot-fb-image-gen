import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerChatRoutes } from "./chat";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerMetaWebhookRoutes } from "./messengerWebhook";

const appVersion = process.env.GIT_SHA || process.env.SOURCE_VERSION || "dev";

function extractWebhookEventTypes(body: unknown): string[] {
  const unique = new Set<string>();
  const payload = body as { entry?: Array<{ messaging?: Array<{ message?: unknown; postback?: unknown }> }> };
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const event of events) {
      if (event?.message) {
        unique.add("messages");
      }
      if (event?.postback) {
        unique.add("postbacks");
      }
    }
  }

  return Array.from(unique);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.use((req, res, next) => {
    const startTime = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      const log: Record<string, unknown> = {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        latency_ms: Number(durationMs.toFixed(1)),
      };

      if (req.method === "POST" && req.path === "/webhook/facebook") {
        const eventTypes = extractWebhookEventTypes(req.body);
        if (eventTypes.length > 0) {
          log.event_types = eventTypes;
        }
      }

      console.log(JSON.stringify(log));
    });

    next();
  });

  app.get("/healthz", (_req, res) => {
    res.status(200).json({
      ok: true,
      name: "leaderbot-images",
      version: appVersion,
      time: new Date().toISOString(),
    });
  });

  app.get("/debug/build", (req, res) => {
    const adminToken = process.env.ADMIN_TOKEN;
    const providedToken = req.header("X-Admin-Token");

    if (!adminToken || providedToken !== adminToken) {
      return res.sendStatus(403);
    }

    return res.status(200).json({
      name: "leaderbot-images",
      version: appVersion,
      uptime_s: Math.floor(process.uptime()),
      node: process.version,
      envFlags: {
        hasFbVerifyToken: Boolean(process.env.FB_VERIFY_TOKEN),
        hasFbPageAccessToken: Boolean(process.env.FB_PAGE_ACCESS_TOKEN),
        hasFbAppSecret: Boolean(process.env.FB_APP_SECRET),
        hasAdminToken: Boolean(process.env.ADMIN_TOKEN),
      },
    });
  });

  registerMetaWebhookRoutes(app);

  registerOAuthRoutes(app);
  registerChatRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "8080", 10);
  const host = process.env.HOST || "0.0.0.0";

  server.listen(port, host, () => {
    console.log(`Server listening on port ${port} (${host})`);
  });
}

startServer().catch(console.error);
