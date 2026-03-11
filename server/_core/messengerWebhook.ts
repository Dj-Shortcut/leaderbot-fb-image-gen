import express from "express";
import rateLimit from "express-rate-limit";
import { z, ZodError } from "zod";
import { normalizeLang } from "./i18n";
import { createWebhookHandler } from "./webhookHandlers";
import { resetWebhookReplayProtection } from "./webhookReplayProtection";
import {
  detectAck,
  getGreetingResponse,
  summarizeWebhook,
} from "./webhookHelpers";
import { facebookWebhookPayloadSchema } from "./webhookSchemas";

const PRIVACY_POLICY_URL = process.env.PRIVACY_POLICY_URL?.trim() || "<link>";
const DEFAULT_LANG = normalizeLang(process.env.DEFAULT_MESSENGER_LANG);

const webhookVerificationQuerySchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string().min(1),
  "hub.challenge": z.string().min(1),
});

const handlers = createWebhookHandler({
  defaultLang: DEFAULT_LANG,
  privacyPolicyUrl: PRIVACY_POLICY_URL,
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

export { detectAck, getGreetingResponse, summarizeWebhook };

export function resetMessengerEventDedupe(): void {
  resetWebhookReplayProtection();
}

export async function processFacebookWebhookPayload(
  payload: unknown
): Promise<void> {
  await handlers.processFacebookWebhookPayload(payload);
}

export function registerMetaWebhookRoutes(app: express.Express): void {
  const handleVerification: express.RequestHandler = (req, res) => {
    const configuredToken = process.env.FB_VERIFY_TOKEN?.trim();
    const parsedQuery = webhookVerificationQuerySchema.safeParse(req.query);

    if (
      !configuredToken ||
      !parsedQuery.success ||
      parsedQuery.data["hub.verify_token"] !== configuredToken
    ) {
      return res.sendStatus(403);
    }

    return res
      .status(200)
      .type("text/plain")
      .send(parsedQuery.data["hub.challenge"]);
  };

  app.use("/webhook", webhookLimiter);
  app.get("/webhook", handleVerification);
  app.get("/webhook/facebook", handleVerification);

  app.post("/webhook/facebook", (req, res) => {
    try {
      facebookWebhookPayloadSchema.parse(req.body);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ error: "Invalid webhook payload" });
        return;
      }

      throw error;
    }

    res.sendStatus(200);
    setImmediate(() => {
      void processFacebookWebhookPayload(req.body).catch(console.error);
    });
  });
}
