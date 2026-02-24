import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerChatRoutes } from "./chat";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./vite";
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
    res.status(200).send("ok");
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

  app.get("/privacy", (_req, res) => {
    res.type("html").send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Privacy Policy – Leaderbot</title>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; line-height: 1.6; padding: 0 20px; }
        h1 { color: #222; }
      </style>
    </head>
    <body>
      <h1>Privacy Policy – Leaderbot</h1>
      <p>Leaderbot processes user-submitted images solely for AI-based image transformation.</p>
      <p>We do not sell, store long-term, or share user data with third parties.</p>
      <p>Images are processed temporarily and deleted after transformation.</p>
      <p>We only access messaging data required to provide this service.</p>
      <p>For questions, contact: shortcutcomputerguy@gmail.com</p>
    </body>
    </html>
  `);
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

  if (process.env.NODE_ENV !== "production") {
    const [{ setupVite }, { createServer }] = await Promise.all([
      import("./vite"),
      import("vite"),
    ]);
    await setupVite(app, server, createServer);
  } else {
    serveStatic(app);
  }

  const PORT = process.env.PORT || 8080;
  const HOST = "0.0.0.0";

  server.listen(PORT, HOST, () => {
    console.log(`Server listening on port ${PORT} (${HOST})`);
  });
}

startServer().catch(console.error);
