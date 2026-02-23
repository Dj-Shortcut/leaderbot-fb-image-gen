import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerChatRoutes } from "./chat";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

type FacebookWebhookEvent = {
  sender?: { id?: string };
  message?: {
    text?: string;
    attachments?: Array<{ type?: string }>;
  };
  postback?: {
    title?: string;
    payload?: string;
  };
};

function registerMetaWebhookRoutes(app: express.Express) {
  app.get("/webhook/facebook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = process.env.FB_VERIFY_TOKEN || process.env.VERIFY_TOKEN;

    if (mode === "subscribe" && token === verifyToken && typeof challenge === "string") {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  });

  app.post("/webhook/facebook", (req, res) => {
    const payload = req.body;
    res.sendStatus(200);

    setImmediate(() => {
      try {
        const entries = Array.isArray(payload?.entry) ? payload.entry : [];

        for (const entry of entries) {
          const events: FacebookWebhookEvent[] = [
            ...(Array.isArray(entry?.messaging) ? entry.messaging : []),
          ];

          for (const event of events) {
            const senderId = event.sender?.id ?? "unknown";
            const eventType = event.postback ? "postback" : event.message ? "message" : "unknown";
            const hasImageAttachment = Boolean(
              event.message?.attachments?.some(attachment => attachment.type === "image")
            );
            const hasText = typeof event.message?.text === "string" && event.message.text.length > 0;

            console.log("[facebook-webhook] event", {
              eventType,
              senderId,
              content: hasImageAttachment ? "image" : hasText ? "text" : "other",
            });
          }
        }
      } catch (error) {
        console.error("[facebook-webhook] failed to process event", error);
      }
    });
  });
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
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
    console.log(`Server running on http://${host}:${port}/`);
  });
}

startServer().catch(console.error);
