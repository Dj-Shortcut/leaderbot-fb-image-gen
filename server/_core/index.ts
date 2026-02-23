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

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({
      ok: true,
      name: "leaderbot-images",
      version: appVersion,
      time: new Date().toISOString(),
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
