import { randomUUID } from "crypto";
import express from "express";
import { TtlDedupeSet } from "./dedupe";
import { sendQuickReplies, sendText, safeLog } from "./messengerApi";
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
const GREETINGS = new Set(["hi", "hello", "hey", "yo", "hola"]);

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
  await sendText(psid, "Hey 👋");
  await sendStateQuickReplies(psid, "IDLE", "Send me a photo and I’ll transform it into something special.");
}

async function sendStylePicker(psid: string): Promise<void> {
  await sendStateQuickReplies(psid, "AWAITING_STYLE", "Nice, got it. What style should I use?");
}

async function explainFlow(psid: string): Promise<void> {
  await sendStateQuickReplies(psid, "IDLE", "I turn photos into stylized images. Send me a picture to start.");
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

  setFlowState(userId, "RESULT_READY");
  await sendStateQuickReplies(psid, "RESULT_READY", "Done. What do you want next?");
}

async function handleStyleSelection(psid: string, userId: string, style: string): Promise<void> {
  const state = getOrCreateState(userId);
  setChosenStyle(userId, style);

  if (!state.lastPhoto) {
    setFlowState(userId, "AWAITING_PHOTO");
    await sendStateQuickReplies(psid, "AWAITING_PHOTO", `Nice choice: ${style}. Send me a photo first 📸`);
    return;
  }

  await runMockGeneration(psid, userId, style);
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

  if (payload === "SEND_PHOTO") {
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
    setPendingImage(userId, imageAttachment.payload.url);
    await sendStylePicker(psid);
    return;
  }

  const text = message.text?.trim();
  if (!text) {
    return;
  }

  const styleFromText = parseStyle(text);
  if (styleFromText) {
    await handleStyleSelection(psid, userId, styleFromText);
    return;
  }

  if (GREETINGS.has(text.toLowerCase())) {
    await sendGreeting(psid);
    return;
  }

  await explainFlow(psid);
}

async function handleEvent(event: FacebookWebhookEvent): Promise<void> {
  const psid = event.sender?.id;
  if (!psid) {
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
