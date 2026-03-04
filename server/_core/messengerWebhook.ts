import express from "express";
import { normalizeLang } from "./i18n";
import { createWebhookHandlers } from "./webhookHandlers";
import { resetWebhookReplayProtection } from "./webhookReplayProtection";
import { detectAck, getGreetingResponse, summarizeWebhook } from "./webhookHelpers";

const PRIVACY_POLICY_URL = process.env.PRIVACY_POLICY_URL?.trim() || "<link>";
const DEFAULT_LANG = normalizeLang(process.env.DEFAULT_MESSENGER_LANG);

const handlers = createWebhookHandlers({
  defaultLang: DEFAULT_LANG,
  privacyPolicyUrl: PRIVACY_POLICY_URL,
});

export { detectAck, getGreetingResponse, summarizeWebhook };

export function resetMessengerEventDedupe(): void {
  resetWebhookReplayProtection();
}

export async function processFacebookWebhookPayload(payload: unknown): Promise<void> {
  await handlers.processFacebookWebhookPayload(payload);
}

export function registerMetaWebhookRoutes(app: express.Express): void {
  const handleVerification: express.RequestHandler = (req, res) => {
    const mode = req.query["hub.mode"];
    const verifyToken = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const configuredToken = process.env.FB_VERIFY_TOKEN;

    if (mode === "subscribe" && verifyToken === configuredToken) {
      return res.status(200).type("text/plain").send(challenge);
    }
    return res.sendStatus(403);
  };

  app.get("/webhook", handleVerification);
  app.get("/webhook/facebook", handleVerification);

  app.post("/webhook/facebook", (req, res) => {
    res.sendStatus(200);
    setImmediate(() => {
      void processFacebookWebhookPayload(req.body).catch(console.error);
    });
  });
}
