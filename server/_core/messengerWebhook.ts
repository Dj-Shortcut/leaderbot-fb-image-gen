import express from "express";
import { TtlDedupeSet } from "./dedupe";
import { sendImage, sendQuickReplies, sendText, safeLog } from "./messengerApi";
import { type Style } from "./messengerStyles";
import {
  createImageGenerator,
  GenerationTimeoutError,
  InvalidGenerationInputError,
  MissingOpenAiApiKeyError,
  OpenAiGenerationError,
} from "./imageService";
import {
  getOrCreateState,
  getQuickRepliesForState,
  pruneOldState,
  setChosenStyle,
  setFlowState,
  setLastGenerated,
  setPendingImage,
  type ConversationState,
} from "./messengerState";
import { toLogUser, toUserKey } from "./privacy";

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

function getEventDedupeKey(event: FacebookWebhookEvent, userKey: string): string | undefined {
  const messageId = event.message?.mid?.trim();
  if (messageId) {
    return `mid:${messageId}`;
  }

  const timestamp = event.timestamp;

  if (Number.isFinite(timestamp)) {
    return `fallback:${userKey}:${timestamp}`;
  }

  return undefined;
}

const STYLE_OPTIONS: Style[] = ["caricature", "petals", "gold", "cinematic", "disco", "clouds"];

const STYLE_LABELS: Record<Style, string> = {
  caricature: "Caricature",
  petals: "Petals",
  gold: "Gold",
  cinematic: "Cinematic",
  disco: "Disco",
  clouds: "Clouds",
};

const USER_MESSAGES = {
  idleIntro: "✨ I turn your photos into stylized images.\nSend me a picture to get started.",
  photoReceived: "✅ Photo received",
  stylePicker: "🎨 Pick a style to transform your image:",
  generating: (styleLabel: string) => `✨ Creating your ${styleLabel} version…\nThis takes a few seconds.`,
  success: "✨ Your image is ready.",
  failure: "⚠️ I couldn’t generate this style right now.\nYou can try again or pick a different style.",
} as const;

const PHOTO_PROMPT = "Send a photo when you're ready 📷";
const PHOTO_REQUIRED_PROMPT = "Send a photo first 📷";

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
export type AckKind = "like" | "ok" | "thanks" | "emoji";


type GreetingResponse =
  | { mode: "text"; text: string }
  | { mode: "quick_replies"; state: ConversationState; text: string };

export function getGreetingResponse(state: ConversationState): GreetingResponse {
  switch (state) {
    case "PROCESSING":
      return { mode: "text", text: "I’m still working on it—few seconds." };
    case "AWAITING_STYLE":
      return { mode: "quick_replies", state: "AWAITING_STYLE", text: USER_MESSAGES.stylePicker };
    case "RESULT_READY":
      return {
        mode: "quick_replies",
        state: "RESULT_READY",
        text: USER_MESSAGES.success,
      };
    case "FAILURE":
      return {
        mode: "quick_replies",
        state: "FAILURE",
        text: "That one failed. Want to retry or pick another style?",
      };
    case "AWAITING_PHOTO":
      return { mode: "text", text: PHOTO_PROMPT };
    case "IDLE":
    default:
      return { mode: "quick_replies", state: "IDLE", text: USER_MESSAGES.idleIntro };
  }
}

function normalizeStyle(input: string): Style | undefined {
  const normalized = input.trim().toLowerCase();
  return STYLE_OPTIONS.find(style => style === normalized);
}

function stylePayloadToStyle(payload: string): Style | undefined {
  const canonicalPayloadStyle = normalizeStyle(payload);
  if (canonicalPayloadStyle) {
    return canonicalPayloadStyle;
  }

  if (!payload.startsWith("STYLE_")) {
    return undefined;
  }

  const styleKey = payload.slice("STYLE_".length).toLowerCase();
  return normalizeStyle(styleKey);
}

function parseStyle(text: string): Style | undefined {
  return normalizeStyle(text);
}

export function detectAck(raw: string | undefined | null): AckKind | null {
  if (!raw) {
    return null;
  }

  const text = raw.trim();
  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();

  if (/^\(\s*y\s*\)$/.test(lower)) {
    return "like";
  }

  if (/^(ok|oke|k|kk|yes|yep|ja|jep)$/.test(lower)) {
    return "ok";
  }

  if (/^(thanks|thx|merci|tks)$/.test(lower)) {
    return "thanks";
  }

  if (text.length > 0 && Array.from(text).every(char => /[\p{Extended_Pictographic}\s]/u.test(char))) {
    return "emoji";
  }

  return null;
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
  await sendStateQuickReplies(psid, "IDLE", USER_MESSAGES.idleIntro);
}

async function sendStylePicker(psid: string): Promise<void> {
  await sendStateQuickReplies(psid, "AWAITING_STYLE", USER_MESSAGES.stylePicker);
}

async function sendPhotoReceivedPrompt(psid: string): Promise<void> {
  await sendStylePicker(psid);
}

async function sendGeneratingPrompt(psid: string, style: Style, mode: string): Promise<void> {
  await sendText(
    psid,
    mode === "mock"
      ? `Processing ${STYLE_LABELS[style]} style ✨`
      : `Perfect — applying ${STYLE_LABELS[style]} style now ✨`,
  );
}

async function sendSuccessPrompt(psid: string): Promise<void> {
  await sendStateQuickReplies(psid, "RESULT_READY", "Done ✅ What next?");
}

async function sendFailurePrompt(psid: string, style: Style, message: string): Promise<void> {
  await sendQuickReplies(psid, message, [
    { content_type: "text", title: "Retry this style", payload: style },
    { content_type: "text", title: "Choose another style", payload: "CHOOSE_STYLE" },
  ]);
}

async function explainFlow(psid: string): Promise<void> {
  await sendStateQuickReplies(psid, "IDLE", USER_MESSAGES.idleIntro);
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


async function runStyleGeneration(psid: string, userId: string, style: Style): Promise<void> {
  const { mode, generator } = createImageGenerator();

  setFlowState(userId, "PROCESSING");
  await sendGeneratingPrompt(psid, style, mode);

  const startedAt = Date.now();
  safeLog("generation_start", { style, mode });

  try {
    const { imageUrl } = await generator.generate({
      style,
      sourceImageUrl: getOrCreateState(userId).lastPhoto ?? undefined,
      userKey: userId,
    });

    safeLog("generation_success", { mode, ms: Date.now() - startedAt });
    await sendImage(psid, imageUrl);
    setLastGenerated(userId, style, imageUrl);
    setFlowState(userId, "RESULT_READY");
    await sendSuccessPrompt(psid);
  } catch (error) {
    const errorClass = error instanceof Error ? error.constructor.name : "UnknownError";
    safeLog("generation_fail", { mode, errorClass, ms: Date.now() - startedAt });

    let failureText = "I couldn’t generate that image right now.";
    if (error instanceof MissingOpenAiApiKeyError) {
      safeLog("openai_not_configured", { mode });
      failureText = "AI generation isn’t enabled yet.";
    } else if (error instanceof GenerationTimeoutError) {
      failureText = "This took too long.";
    } else if (error instanceof InvalidGenerationInputError || error instanceof OpenAiGenerationError) {
      failureText = "I couldn’t generate that image right now.";
    }

    await sendText(psid, USER_MESSAGES.failure);

    setFlowState(userId, "AWAITING_STYLE");
    await sendFailurePrompt(psid, style, failureText);
  }
}

async function handleStyleSelection(psid: string, userId: string, style: Style): Promise<void> {
  const state = getOrCreateState(userId);

  if (state.stage === "PROCESSING") {
    const statusStyle = STYLE_LABELS[style];
    await sendText(psid, `✨ Creating your ${statusStyle} version… This takes a few seconds.`);
    return;
  }

  setChosenStyle(userId, style);
  safeLog("style_selected", { user: toLogUser(userId), selectedStyle: style });

  if (!state.lastPhoto) {
    setFlowState(userId, "AWAITING_PHOTO");
    await sendText(psid, PHOTO_REQUIRED_PROMPT);
    return;
  }

  await runStyleGeneration(psid, userId, style);
}

async function handlePayload(psid: string, userId: string, payload: string): Promise<void> {
  if (payload.startsWith("RETRY_STYLE_")) {
    const retryStyleFromPayload = normalizeStyle(payload.slice("RETRY_STYLE_".length));
    const state = getOrCreateState(userId);
    const selectedStyle = normalizeStyle(state.selectedStyle ?? "") ?? retryStyleFromPayload;

    if (!selectedStyle) {
      setFlowState(userId, "AWAITING_STYLE");
      await sendStylePicker(psid);
      return;
    }

    if (!state.lastPhoto) {
      setFlowState(userId, "AWAITING_PHOTO");
      await sendText(psid, PHOTO_REQUIRED_PROMPT);
      return;
    }

    await runStyleGeneration(psid, userId, selectedStyle);
    return;
  }

  const selectedStyle = stylePayloadToStyle(payload);
  if (selectedStyle) {
    getOrCreateState(userId);
    await handleStyleSelection(psid, userId, selectedStyle);
    return;
  }

  if (payload === "CHOOSE_STYLE") {
    setFlowState(userId, "AWAITING_STYLE");
    await sendStylePicker(psid);
    return;
  }

  if (payload === "RETRY_STYLE") {
    const chosenStyle = getOrCreateState(userId).selectedStyle;
    const retryStyle = chosenStyle ? parseStyle(chosenStyle) : undefined;

    if (retryStyle) {
      await handleStyleSelection(psid, userId, retryStyle);
      return;
    }

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
    await sendText(psid, PHOTO_PROMPT);
    return;
  }

  if (payload === "DOWNLOAD_HD") {
    const state = getOrCreateState(userId);

    if (state.lastImageUrl) {
      await sendImage(psid, state.lastImageUrl);
      return;
    }

    await sendText(psid, "I can share HD downloads after I generate an image.");
    setFlowState(userId, "AWAITING_PHOTO");
    await sendText(psid, PHOTO_PROMPT);
    return;
  }

  safeLog("unknown_payload", { user: toLogUser(userId) });
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
    setFlowState(userId, "AWAITING_STYLE");
    await sendPhotoReceivedPrompt(psid);
    return;
  }

  const text = message.text;
  const ack = detectAck(text);
  if (ack) {
    safeLog("ack_ignored", { ack });
    return;
  }

  const trimmedText = text?.trim();
  const normalizedText = trimmedText?.toLowerCase();
  if (!normalizedText || !trimmedText) {
    return;
  }

  const styleFromText = parseStyle(trimmedText);
  if (styleFromText) {
    getOrCreateState(userId);
    await handleStyleSelection(psid, userId, styleFromText);
    return;
  }

  const state = getOrCreateState(userId);
  if (!state.lastPhoto) {
    setFlowState(userId, "AWAITING_PHOTO");
    await sendText(psid, PHOTO_PROMPT);
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

  const userId = toUserKey(psid);

  if (event.message?.is_echo) {
    safeLog("echo_ignored", { user: toLogUser(userId) });
    return;
  }

  const dedupeKey = getEventDedupeKey(event, userId);
  if (dedupeKey && incomingEventDedupe.seen(dedupeKey)) {
    safeLog("duplicate_event_skipped", { user: toLogUser(userId) });
    return;
  }

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
    const configuredToken = process.env.FB_VERIFY_TOKEN;

    // Fail closed: require both mode and token to be properly configured and match
    if (
      mode === "subscribe" &&
      typeof configuredToken === "string" &&
      configuredToken.length > 0 &&
      typeof verifyToken === "string" &&
      verifyToken === configuredToken
    ) {
      return res.status(200).type("text/plain").send(challenge);
    }

    // Log verification failures for security monitoring
    if (mode === "subscribe") {
      console.warn("[Webhook] Verification failed", {
        hasToken: typeof verifyToken === "string",
        isConfigured: typeof configuredToken === "string" && configuredToken.length > 0,
        matches: verifyToken === configuredToken,
      });
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
