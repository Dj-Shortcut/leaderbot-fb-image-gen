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
        body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; line-height: 1.6; padding: 0 20px; color: #1a1a1a; }
        h1, h2 { color: #222; }
        ul { padding-left: 20px; }
      </style>
    </head>
    <body>
      <h1>Privacy Policy – Leaderbot</h1>
      <p><strong>Last updated:</strong> 2026-02-24</p>
      <p>Leaderbot ("we", "our") is a Messenger-based service that transforms user-submitted images using AI styles.</p>

      <h2>What data we collect</h2>
      <p>When you interact with Leaderbot through Facebook Messenger, we may receive:</p>
      <ul>
        <li>Messages you send to the Page</li>
        <li>Images you submit for transformation</li>
        <li>Basic messaging metadata necessary to deliver the service (e.g., sender ID, timestamps)</li>
      </ul>
      <p>We do not request your password or access your private Facebook profile data beyond what Messenger delivers for this integration.</p>

      <h2>How we use data</h2>
      <p>We use your data only to:</p>
      <ul>
        <li>Receive your request</li>
        <li>Process and transform your submitted image</li>
        <li>Send the transformed image back to you in Messenger</li>
        <li>Maintain service reliability, prevent abuse, and troubleshoot issues</li>
      </ul>

      <h2>Image handling and retention</h2>
      <p>Images are processed for the purpose of generating the requested transformation.</p>
      <p>We do not sell your images.</p>
      <p>We do not use your images to market to you.</p>
      <p>We do not share your images with third parties except as required to provide the service (e.g., image processing providers).</p>
      <p>Images and generated outputs are retained only as long as needed to deliver the result and ensure basic operational stability, then deleted or anonymized.</p>

      <h2>Sharing and third parties</h2>
      <p>We may use third-party infrastructure providers (hosting, logging, and image processing) solely to operate the service. We do not share personal data for advertising purposes.</p>

      <h2>Security</h2>
      <p>We take reasonable measures to protect data in transit and at rest. No system is 100% secure, but we aim to minimize data exposure and access.</p>

      <h2>Your choices</h2>
      <p>You can stop using the service at any time by not messaging the Page.</p>

      <h2>Data deletion requests</h2>
      <p>If you want us to delete data associated with your interactions, contact us at: shortcutcomputerguy@gmail.com</p>
      <p>Include your Facebook profile name and the approximate time you messaged the Page so we can locate your conversation context.</p>

      <h2>Contact</h2>
      <p>Email: shortcutcomputerguy@gmail.com</p>
    </body>
    </html>
  `);
  });

  app.get("/data-deletion", (_req, res) => {
    res.type("html").send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>User Data Deletion Instructions – Leaderbot</title>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; line-height: 1.6; padding: 0 20px; color: #1a1a1a; }
        h1, h2 { color: #222; }
        ul { padding-left: 20px; }
      </style>
    </head>
    <body>
      <h1>User Data Deletion Instructions – Leaderbot</h1>
      <p>If you want your data removed from Leaderbot, you can request deletion at any time.</p>

      <h2>Data that can be deleted</h2>
      <ul>
        <li>Conversation identifiers and message logs associated with your interaction history</li>
        <li>Retained images and generated outputs, if any are still stored</li>
      </ul>

      <h2>How to request deletion</h2>
      <p>Email your request to: <strong>shortcutcomputerguy@gmail.com</strong></p>
      <p>To help us identify your records accurately, include:</p>
      <ul>
        <li>Your Facebook profile name</li>
        <li>The approximate time you messaged the Page</li>
      </ul>

      <h2>Processing timeframe</h2>
      <p>After we verify your request details, deletion is completed within a reasonable timeframe.</p>
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

  const PORT = Number(process.env.PORT || 8080);
  const HOST = "0.0.0.0";

  server.listen(PORT, HOST, () => {
    console.log(`Server listening on port ${PORT} (${HOST})`);
  });
}

startServer().catch(console.error);
