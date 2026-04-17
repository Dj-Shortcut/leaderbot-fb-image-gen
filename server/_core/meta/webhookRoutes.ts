import express from "express";
import rateLimit from "express-rate-limit";
import { z, ZodError } from "zod";
import { facebookWebhookPayloadSchema } from "../webhookSchemas";
import {
  isWhatsAppWebhookPayload,
} from "../inbound/whatsappInbound";

const webhookVerificationQuerySchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string().min(1),
  "hub.challenge": z.string().min(1),
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function getMetaVerifyToken(): string {
  return (
    process.env.META_VERIFY_TOKEN?.trim() ||
    process.env.FB_VERIFY_TOKEN?.trim() ||
    ""
  );
}

function processWhatsAppWebhookPayloadSafely(payload: unknown): void {
  void import("../whatsappWebhook")
    .then(module => module.processWhatsAppWebhookPayload(payload))
    .catch(error => {
      console.error("[whatsapp webhook] async processing failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function processFacebookWebhookPayloadSafely(payload: unknown): void {
  void import("../messengerWebhook")
    .then(module => module.processFacebookWebhookPayload(payload))
    .catch(error => {
      console.error("[messenger webhook] async processing failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function registerMetaWebhookRoutes(app: express.Express): void {
  const handleVerification: express.RequestHandler = (req, res) => {
    const configuredToken = getMetaVerifyToken();
    const parsedQuery = webhookVerificationQuerySchema.safeParse(req.query);
    const path = req.path;

    console.log("[meta webhook] GET verification request", { path });

    if (
      !configuredToken ||
      !parsedQuery.success ||
      parsedQuery.data["hub.verify_token"] !== configuredToken
    ) {
      console.warn("[meta webhook] GET verification rejected", {
        path,
        hasConfiguredToken: Boolean(configuredToken),
        hasMode: typeof req.query["hub.mode"] === "string",
        hasChallenge: typeof req.query["hub.challenge"] === "string",
      });
      return res.sendStatus(403);
    }

    console.log("[meta webhook] GET verification accepted", { path });
    return res
      .status(200)
      .type("text/plain")
      .send(parsedQuery.data["hub.challenge"]);
  };

  app.use("/webhook", webhookLimiter);
  app.get("/webhook", handleVerification);
  app.get("/webhook/facebook", handleVerification);

  const handleWebhookPost: express.RequestHandler = (req, res) => {
    if (isWhatsAppWebhookPayload(req.body)) {
      console.log("[whatsapp webhook] POST delivery received");
      res.sendStatus(200);
      setImmediate(() => {
        processWhatsAppWebhookPayloadSafely(req.body);
      });
      return;
    }

    try {
      facebookWebhookPayloadSchema.parse(req.body);
    } catch (error) {
      if (error instanceof ZodError) {
        console.warn("[messenger webhook] POST rejected: invalid payload shape");
        res.status(400).json({ error: "Invalid webhook payload" });
        return;
      }

      throw error;
    }

    console.log("[messenger webhook] POST delivery received");
    res.sendStatus(200);
    setImmediate(() => {
      processFacebookWebhookPayloadSafely(req.body);
    });
  };

  app.post("/webhook", handleWebhookPost);
  app.post("/webhook/facebook", handleWebhookPost);
}
