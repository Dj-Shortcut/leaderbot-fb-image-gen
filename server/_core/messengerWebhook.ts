import express from "express";
import rateLimit from "express-rate-limit";
import { z, ZodError } from "zod";
import { normalizeLang } from "./i18n";
import { createWebhookHandlers } from "./webhookHandlers";
import { resetWebhookReplayProtection } from "./webhookReplayProtection";
import {
  detectAck,
  getGreetingResponse,
  summarizeWebhook,
} from "./webhookHelpers";
import { facebookWebhookPayloadSchema } from "./webhookSchemas";
import { sendWhatsAppText } from "./whatsappApi";
import { toUserKey, toLogUser } from "./privacy";
import { handleSharedTextMessage } from "./sharedTextHandler";
import {
  getOrCreateState,
  markIntroSeen,
  setFlowState,
  type ConversationState,
} from "./messengerState";
import type { NormalizedInboundMessage } from "./normalizedInboundMessage";
import { sendWhatsAppBotResponse } from "./botResponseAdapters";

const PRIVACY_POLICY_URL = process.env.PRIVACY_POLICY_URL?.trim() || "<link>";
const DEFAULT_LANG = normalizeLang(process.env.DEFAULT_MESSENGER_LANG);

const webhookVerificationQuerySchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string().min(1),
  "hub.challenge": z.string().min(1),
});

const handlers = createWebhookHandlers({
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

function getMetaVerifyToken(): string {
  return (
    process.env.META_VERIFY_TOKEN?.trim() ||
    process.env.FB_VERIFY_TOKEN?.trim() ||
    ""
  );
}

function isWhatsAppWebhookPayload(
  payload: unknown
): payload is { object: "whatsapp_business_account" } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { object?: unknown }).object === "whatsapp_business_account"
  );
}

function logWhatsAppWebhookPayload(payload: unknown): void {
  const serializedBody = JSON.stringify(payload, null, 2);
  console.log("[whatsapp webhook] inbound payload");
  console.log(serializedBody);
}

function extractWhatsAppTextEvents(
  payload: unknown
): NormalizedInboundMessage[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const entries = Array.isArray((payload as { entry?: unknown[] }).entry)
    ? (payload as { entry: unknown[] }).entry
    : [];

  return entries.flatMap(entry => {
    const changes = Array.isArray(
      (entry as { changes?: unknown[] } | null)?.changes
    )
      ? ((entry as { changes: unknown[] }).changes ?? [])
      : [];

    return changes.flatMap(change => {
      const value =
        typeof change === "object" && change !== null
          ? ((change as { value?: unknown }).value ?? null)
          : null;
      const messages = Array.isArray(
        (value as { messages?: unknown[] } | null)?.messages
      )
        ? ((value as { messages: unknown[] }).messages ?? [])
        : [];

      return messages.flatMap(message => {
        if (typeof message !== "object" || message === null) {
          return [];
        }

        const from =
          typeof (message as { from?: unknown }).from === "string"
            ? (message as { from: string }).from
            : "";
        const messageType =
          typeof (message as { type?: unknown }).type === "string"
            ? (message as { type: string }).type
            : "unknown";
        const textBody =
          typeof (message as { text?: { body?: unknown } }).text?.body ===
          "string"
            ? (message as { text: { body: string } }).text.body
            : null;

        if (!from) {
          return [];
        }

        return [
          {
            channel: "whatsapp",
            senderId: from,
            userId: toUserKey(from),
            messageType:
              messageType === "text"
                ? "text"
                : messageType === "image"
                  ? "image"
                  : "unknown",
            textBody: textBody ?? undefined,
          },
        ];
      });
    });
  });
}

async function handleWhatsAppWebhookPayload(payload: unknown): Promise<void> {
  logWhatsAppWebhookPayload(payload);

  const events = extractWhatsAppTextEvents(payload);
  if (events.length === 0) {
    console.log("[whatsapp webhook] no inbound messages found");
    return;
  }

  for (const event of events) {
    console.log("[whatsapp webhook] normalized inbound event", {
      channel: event.channel,
      user: toLogUser(event.userId),
      messageType: event.messageType,
    });

    if (event.messageType !== "text") {
      continue;
    }

    console.log("[whatsapp webhook] normalized event handoff", {
      channel: event.channel,
      user: toLogUser(event.userId),
      messageType: event.messageType,
    });

    try {
      const reqId = `${event.senderId}-${Date.now()}`;
      const result = await handleSharedTextMessage({
        message: event,
        reqId,
        lang: DEFAULT_LANG,
        getState: () => Promise.resolve(getOrCreateState(event.senderId)),
        setFlowState: (nextState: ConversationState) =>
          Promise.resolve(setFlowState(event.senderId, nextState)),
        logState: (state, context) => {
          console.log("[whatsapp webhook] shared state", {
            context,
            user: toLogUser(event.userId),
            stage: state.stage,
            hasPhoto: Boolean(state.lastPhotoUrl),
          });
        },
      });
      await sendWhatsAppBotResponse(result.response, {
        sendText: async text => {
          console.log("[whatsapp webhook] reply attempt", {
            to: event.senderId,
            messageType: event.messageType,
          });
          await sendWhatsAppText(event.senderId, text);
          console.log("[whatsapp webhook] reply sent", {
            to: event.senderId,
          });
        },
      });
      if (result.afterSend === "markIntroSeen") {
        await Promise.resolve(markIntroSeen(event.senderId));
      }
    } catch (error) {
      console.error("[whatsapp webhook] reply failed", {
        to: event.senderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function processFacebookWebhookPayload(
  payload: unknown
): Promise<void> {
  await handlers.processFacebookWebhookPayload(payload);
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

  app.post("/webhook/facebook", (req, res) => {
    if (isWhatsAppWebhookPayload(req.body)) {
      console.log("[whatsapp webhook] POST delivery received");
      res.sendStatus(200);
      setImmediate(() => {
        void handleWhatsAppWebhookPayload(req.body);
      });
      return;
    }

    try {
      facebookWebhookPayloadSchema.parse(req.body);
    } catch (error) {
      if (error instanceof ZodError) {
        console.warn(
          "[messenger webhook] POST rejected: invalid payload shape"
        );
        res.status(400).json({ error: "Invalid webhook payload" });
        return;
      }

      throw error;
    }

    console.log("[messenger webhook] POST delivery received");
    res.sendStatus(200);
    setImmediate(() => {
      void processFacebookWebhookPayload(req.body).catch(console.error);
    });
  });
}
