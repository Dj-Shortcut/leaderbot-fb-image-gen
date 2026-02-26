import { randomUUID } from "crypto";
import express from "express";
import { TtlDedupeSet } from "./dedupe";
import { sendImage, sendQuickReplies, sendText, safeLog } from "./messengerApi";
import { recordImageJob } from "./messengerJobStore";
import {
  anonymizePsid,
  getOrCreateState,
  getQuickRepliesForState,
  pruneOldState,
  setChosenStyle,
  setFlowState,
  setPendingImage,
  type ConversationState,
} from "./messengerState";

type FacebookWebhookEvent = {
  sender?: { id?: string };
  message?: {
    mid?: string;
    is_echo?: boolean;
    text?: string;
    quick_reply?: { payload?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  postback?: {
    title?: string;
    payload?: string;
  };
  timestamp?: number;
};

type WebhookEventSummary = {
  type: "message" | "postback" | "read" | "delivery" | "other";
  hasText: boolean;
  attachmentTypes: string[];
  isEcho: boolean;
  hasRead: boolean;
  hasDelivery: boolean;
  hasPostback: boolean;
};

type WebhookSummary = {
  object: unknown;
  entryCount: number;
  events: WebhookEventSummary[];
};

export function summarizeWebhook(body: unknown): WebhookSummary {
  const fallbackSummary = {
    object: (body as { object?: unknown } | null | undefined)?.object,
    entryCount: 0,
    events: [],
  } satisfies WebhookSummary;

  try {
    const rawBody = (body ?? {}) as { object?: unknown; entry?: Array<{ messaging?: unknown[] }> };
    const entries = Array.isArray(rawBody.entry) ? rawBody.entry : [];

    const summary: WebhookSummary = {
      object: rawBody.object,
      entryCount: entries.length,
      events: [],
    };

    for (const entry of entries) {
      const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];

      for (const rawEvent of messaging) {
        const event = (rawEvent ?? {}) as FacebookWebhookEvent & {
          delivery?: unknown;
          read?: unknown;
        };
        const attachments = Array.isArray(event.message?.attachments) ? event.message.attachments : [];
        const attachmentTypes = attachments
          .map(attachment => attachment?.type)
          .filter((type): type is string => typeof type === "string");

        const type =
          event.read ? "read" :
          event.delivery ? "delivery" :
          event.postback ? "postback" :
          event.message ? "message" :
          "other";

        summary.events.push({
          type,
          hasText: typeof event.message?.text === "string",
          attachmentTypes,
          isEcho: Boolean(event.message?.is_echo),
          hasRead: Boolean(event.read),
          hasDelivery: Boolean(event.delivery),
          hasPostback: Boolean(event.postback),
        });
      }
    }

    return summary;
  } catch {
    return fallbackSummary;
  }
}

const incomingEventDedupe = new TtlDedupeSet(10 * 60 * 1000);

function getEventDedupeKey(event: FacebookWebhookEvent): string | undefined {
  const messageId = event.message?.mid?.trim();
  if (messageId) {
    return `mid:${messageId}`;
  }

  const senderId = event.sender?.id?.trim();
  const timestamp = event.timestamp;

  if (senderId && Number.isFinite(timestamp)) {
    return `fallback:${senderId}:${timestamp}`;
  }

  return undefined;
}

const STYLE_OPTIONS = ["Disco", "Gold", "Anime", "Clouds"] as const;
const MOCK_STYLE_IMAGES: Record<string, string> = {
  disco: "https://picsum.photos/seed/disco-placeholder/1024/1024",
  gold: "https://picsum.photos/seed/gold-placeholder/1024/1024",
  anime: "https://picsum.photos/seed/anime-placeholder/1024/1024",
  clouds: "https://picsum.photos/seed/clouds-placeholder/1024/1024",
};
const GREETINGS = new Set(["hi", "hello", "hey", "yo", "hola"]);
const SMALLTALK = new Set([
  "how are you",
  "how are you?",
  "sup",
  "what's up",
  "whats up",
  "thanks",
  "thank you",
]);

type GreetingResponse =
  | { mode: "text"; text: string }
  | { mode: "quick_replies"; state: ConversationState; text: string };

export function getGreetingResponse(state: ConversationState): GreetingResponse {
  switch (state) {
    case "PROCESSING":
      return { mode: "text", text: "I’m still working on it—few seconds." };
    case "AWAITING_STYLE":
      return { mode: "quick_replies", state: "AWAITING_STYLE", text: "What style should I use?" };
    case "RESULT_READY":
      return {
        mode: "quick_replies",
        state: "RESULT_READY",
        text: "Yo 👋 Wil je nog een style proberen op dezelfde foto, of een nieuwe sturen?",
      };
    case "AWAITING_PHOTO":
      return { mode: "quick_replies", state: "AWAITING_PHOTO", text: "Send a photo when you’re ready 📸" };
    case "IDLE":
    default:
      return { mode: "quick_replies", state: "IDLE", text: "Welcome 👋 Pick a quick start." };
  }
}

function stylePayloadToLabel(payload: string): string | undefined {
  if (!payload.startsWith("STYLE_")) {
    return undefined;
  }

  const name = payload.slice("STYLE_".length).toLowerCase();
  return STYLE_OPTIONS.find(style => style.toLowerCase() === name);
}

function parseStyle(text: string): string | undefined {
  const normalized = text.trim().toLowerCase();
  return STYLE_OPTIONS.find(style => style.toLowerCase() === normalized);
}

function toMessengerReplies(state: ConversationState) {
  return getQuickRepliesForState(state).map(reply => ({
    content_type: "text" as const,
    title: reply.title,
    payload: reply.payload,
  }));
}

async function sendStateQuickReplies(psid: string, state: ConversationState, text: string): Promise<void> {
  const replies = toMessengerReplies(state);

  if (replies.length === 0) {
    await sendText(psid, text);
    return;
  }

  await sendQuickReplies(psid, text, replies);
}

async function sendGreeting(psid: string): Promise<void> {
  await sendStateQuickReplies(psid, "IDLE", "Welcome 👋 Pick a quick start.");
}

async function sendStylePicker(psid: string): Promise<void> {
  await sendStateQuickReplies(psid, "AWAITING_STYLE", "What style should I use?");
}

async function explainFlow(psid: string): Promise<void> {
  await sendStateQuickReplies(psid, "IDLE", "I turn photos into stylized images. Send me a picture to start.");
}

async function handleGreeting(psid: string, userId: string): Promise<void> {
  const state = getOrCreateState(userId);

  const response = getGreetingResponse(state.stage);
  if (response.mode === "text") {
    await sendText(psid, response.text);
    return;
  }

  await sendStateQuickReplies(psid, response.state, response.text);
}

function isMockModeEnabled(): boolean {
  return process.env.MOCK_MODE !== "false";
}

function getMockImageForStyle(style: string): string {
  const normalizedStyle = style.trim().toLowerCase();
  return MOCK_STYLE_IMAGES[normalizedStyle] ?? MOCK_STYLE_IMAGES.disco;
}

async function waitForMockProcessing(): Promise<void> {
  const delayMs = 2000 + Math.floor(Math.random() * 2001);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

async function runMockGeneration(psid: string, userId: string, style: string): Promise<void> {
  setFlowState(userId, "PROCESSING");
  const imageJobId = randomUUID();

  recordImageJob({
    userId,
    style,
    imageJobId,
    timestamp: Date.now(),
  });

  await sendText(psid, `Perfect — applying ${style} style now (mock) ✨`);
  await sendText(psid, `Job queued: ${imageJobId}`);
  await waitForMockProcessing();
  await sendImage(psid, getMockImageForStyle(style));

  setFlowState(userId, "RESULT_READY");
  await sendStateQuickReplies(psid, "RESULT_READY", "Done. What do you want next?");
}

async function runStyleGeneration(psid: string, userId: string, style: string): Promise<void> {
  if (isMockModeEnabled()) {
    await runMockGeneration(psid, userId, style);
    return;
  }

  setFlowState(userId, "PROCESSING");
  await sendText(psid, `Perfect — applying ${style} style now ✨`);
  await sendText(psid, "Real generation is not connected yet.");
  setFlowState(userId, "AWAITING_STYLE");
  await sendStylePicker(psid);
}

async function handleStyleSelection(psid: string, userId: string, style: string): Promise<void> {
  const state = getOrCreateState(userId);
  setChosenStyle(userId, style);

  if (!state.lastPhoto) {
    setFlowState(userId, "AWAITING_PHOTO");
    await sendStateQuickReplies(psid, "AWAITING_PHOTO", `Nice choice: ${style}. Send me a photo first 📸`);
    return;
  }

  await runStyleGeneration(psid, userId, style);
}

async function handlePayload(psid: string, userId: string, payload: string): Promise<void> {
  const selectedStyle = stylePayloadToLabel(payload);
  if (selectedStyle) {
    await handleStyleSelection(psid, userId, selectedStyle);
    return;
  }

  if (payload === "CHOOSE_STYLE") {
    setFlowState(userId, "AWAITING_STYLE");
    await sendStylePicker(psid);
    return;
  }

  if (payload === "WHAT_IS_THIS") {
    await explainFlow(psid);
    return;
  }

  if (payload === "START_PHOTO" || payload === "SEND_PHOTO") {
    setFlowState(userId, "AWAITING_PHOTO");
    await sendStateQuickReplies(psid, "AWAITING_PHOTO", "Send a photo when you’re ready 📸");
    return;
  }

  safeLog("unknown_payload", { userId, payload });
}

async function handleMessage(psid: string, userId: string, event: FacebookWebhookEvent): Promise<void> {
  const message = event.message;

  if (!message || message.is_echo) {
    return;
  }

  const quickPayload = message.quick_reply?.payload;
  if (quickPayload) {
    await handlePayload(psid, userId, quickPayload);
    return;
  }

  const imageAttachment = message.attachments?.find(att => att.type === "image" && att.payload?.url);
  if (imageAttachment?.payload?.url) {
    await sendText(psid, "Photo received ✅");
    setPendingImage(userId, imageAttachment.payload.url);
    await sendStylePicker(psid);
    return;
  }

  const text = message.text?.trim();
  if (!text) {
    return;
  }

  const normalizedText = text.toLowerCase();

  const styleFromText = parseStyle(text);
  if (styleFromText) {
    await handleStyleSelection(psid, userId, styleFromText);
    return;
  }

  if (GREETINGS.has(normalizedText) || SMALLTALK.has(normalizedText)) {
    await handleGreeting(psid, userId);
    return;
  }

  await explainFlow(psid);
}

async function handleEvent(event: FacebookWebhookEvent): Promise<void> {
  const psid = event.sender?.id;
  if (!psid) {
    return;
  }

  if (event.message?.is_echo) {
    return;
  }

  const dedupeKey = getEventDedupeKey(event);
  if (dedupeKey && incomingEventDedupe.seen(dedupeKey)) {
    safeLog("duplicate_event_skipped", { dedupeKey });
    return;
  }

  const userId = anonymizePsid(psid);

  if (event.postback?.payload) {
    await handlePayload(psid, userId, event.postback.payload);
    return;
  }

  await handleMessage(psid, userId, event);
}

export async function processFacebookWebhookPayload(payload: unknown): Promise<void> {
  pruneOldState();
  const entries = Array.isArray((payload as { entry?: unknown[] } | null)?.entry)
    ? (payload as { entry: Array<{ messaging?: unknown[] }> }).entry
    : [];

  for (const entry of entries) {
    const events = Array.isArray(entry?.messaging) ? entry.messaging : [];

    for (const event of events) {
      await handleEvent((event ?? {}) as FacebookWebhookEvent);
    }
  }
}

export function resetMessengerEventDedupe(): void {
  incomingEventDedupe.clear();
}

export function registerMetaWebhookRoutes(app: express.Express): void {
  const handleVerification: express.RequestHandler = (req, res) => {
    const mode = req.query["hub.mode"];
    const verifyToken = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && verifyToken === process.env.FB_VERIFY_TOKEN) {
      return res.status(200).type("text/plain").send(challenge);
    }

    return res.sendStatus(403);
  };

  app.get("/webhook", handleVerification);
  app.get("/webhook/facebook", handleVerification);

  app.post("/webhook/facebook", (req, res) => {
    console.log("===WEBHOOK_FACEBOOK_POST_HIT===");

    const webhookInLog = {
      level: "info",
      msg: "webhook_in",
      reqId: (req as { reqId?: unknown }).reqId,
      summary: summarizeWebhook(req.body),
    };

    try {
      console.log(JSON.stringify(webhookInLog));
    } catch {
      console.log("[webhook_in]", webhookInLog);
    }

    const payload = req.body;
    res.sendStatus(200);

    setImmediate(async () => {
      try {
        await processFacebookWebhookPayload(payload);
      } catch (error) {
        console.error("[facebook-webhook] failed to process event", error);
      }
    });
  });
}
