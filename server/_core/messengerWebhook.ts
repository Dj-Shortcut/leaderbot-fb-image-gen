import express from "express";
import { TtlDedupeSet } from "./dedupe";
import { sendImage, sendQuickReplies, sendText, safeLog } from "./messengerApi";
import { type Style } from "./messengerStyles";
import {
  createImageGenerator,
  GenerationTimeoutError,
  InvalidGenerationInputError,
  MissingInputImageError,
  MissingAppBaseUrlError,
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
  setPreferredLang,
  type ConversationState,
  anonymizePsid,
} from "./messengerState";
import { normalizeLang, t, type Lang } from "./i18n";
import { toLogUser, toUserKey } from "./privacy";
import { isDebugLogEnabled, isStateDumpEnabled, shouldSampleWebhookSummary } from "./logLevel";

type FacebookWebhookEvent = {
  sender?: { id?: string; locale?: string };
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

const PRIVACY_POLICY_URL = process.env.PRIVACY_POLICY_URL?.trim() || "<link>";
const DEFAULT_LANG: Lang = normalizeLang(process.env.DEFAULT_MESSENGER_LANG);

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

export function getGreetingResponse(state: ConversationState, lang: Lang = DEFAULT_LANG): GreetingResponse {
  switch (state) {
    case "PROCESSING":
      return { mode: "text", text: t(lang, "processingBlocked") };
    case "AWAITING_STYLE":
      return { mode: "quick_replies", state: "AWAITING_STYLE", text: t(lang, "stylePicker") };
    case "RESULT_READY":
      return {
        mode: "quick_replies",
        state: "RESULT_READY",
        text: t(lang, "success"),
      };
    case "FAILURE":
      return {
        mode: "quick_replies",
        state: "FAILURE",
        text: t(lang, "failure"),
      };
    case "AWAITING_PHOTO":
      return { mode: "text", text: t(lang, "textWithoutPhoto") };
    case "IDLE":
    default:
      return { mode: "quick_replies", state: "IDLE", text: t(lang, "flowExplanation") };
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

async function sendStylePicker(psid: string, lang: Lang): Promise<void> {
  await sendStateQuickReplies(psid, "AWAITING_STYLE", t(lang, "stylePicker"));
}

async function sendPhotoReceivedPrompt(psid: string, lang: Lang): Promise<void> {
  await sendStylePicker(psid, lang);
}

async function sendGeneratingPrompt(psid: string, style: Style, lang: Lang): Promise<void> {
  await sendText(
    psid,
    t(lang, "generatingPrompt", { styleLabel: STYLE_LABELS[style] }),
  );
}

async function sendSuccessPrompt(psid: string, lang: Lang): Promise<void> {
  await sendStateQuickReplies(psid, "RESULT_READY", t(lang, "success"));
}

async function sendFailurePrompt(psid: string, style: Style, message: string, lang: Lang): Promise<void> {
  await sendQuickReplies(psid, message, [
    { content_type: "text", title: t(lang, "retryThisStyle"), payload: style },
    { content_type: "text", title: t(lang, "otherStyle"), payload: "CHOOSE_STYLE" },
  ]);
}

async function explainFlow(psid: string, lang: Lang): Promise<void> {
  await sendText(psid, t(lang, "flowExplanation"));
}

async function explainPrivacy(psid: string, lang: Lang): Promise<void> {
  await sendText(psid, t(lang, "privacy", { link: PRIVACY_POLICY_URL }));
}

async function explainWhoIsBehind(psid: string, lang: Lang): Promise<void> {
  await sendText(psid, t(lang, "aboutLeaderbot"));
}

async function handleGreeting(psid: string, userId: string, lang: Lang): Promise<void> {
  const state = getOrCreateState(userId);

  const response = getGreetingResponse(state.stage, lang);
  if (response.mode === "text") {
    await sendText(psid, response.text);
    return;
  }

  await sendStateQuickReplies(psid, response.state, response.text);
}


async function runStyleGeneration(psid: string, userId: string, style: Style, reqId: string, lang: Lang): Promise<void> {
  const { mode, generator } = createImageGenerator();

  setFlowState(userId, "PROCESSING");
  await sendGeneratingPrompt(psid, style, lang);

  const startedAt = Date.now();
  safeLog("generation_start", { style, mode });
  const state = getOrCreateState(userId);
  const lastImageUrl = state.lastPhoto;
  const chosenStyle = style;

  if (isStateDumpEnabled()) {
    console.log("STATE_BEFORE_GENERATE", {
      psid,
      state,
      lastImageUrl,
      hasImage: !!lastImageUrl,
    });
  }

  console.log("OPENAI_CALL_START", {
    psid,
    style: chosenStyle,
  });

  try {
    const { imageUrl, proof } = await generator.generate({
      style,
      sourceImageUrl: lastImageUrl ?? undefined,
      userKey: userId,
      reqId,
    });

    console.log("OPENAI_CALL_SUCCESS", { psid });

    const totalMs = Date.now() - startedAt;
    safeLog("generation_success", { mode, ms: totalMs });
    console.log("PROOF_SUMMARY", JSON.stringify({
      reqId,
      psidHash: anonymizePsid(psid).slice(0, 12),
      style: chosenStyle,
      incomingLen: proof.incomingLen,
      incomingSha256: proof.incomingSha256,
      openaiInputLen: proof.openaiInputLen,
      openaiInputSha256: proof.openaiInputSha256,
      outputUrl: imageUrl,
      totalMs,
      ok: true,
    }));
    console.log("MESSENGER_SEND_IMAGE", { psid, imageUrl });
    await sendImage(psid, imageUrl);
    setLastGenerated(userId, style, imageUrl);
    setFlowState(userId, "RESULT_READY");
    await sendSuccessPrompt(psid, lang);
  } catch (error) {
    console.error("OPENAI_CALL_ERROR", {
      psid,
      error: error instanceof Error ? error.message : undefined,
    });

    const errorClass = error instanceof Error ? error.constructor.name : "UnknownError";
    const totalMs = Date.now() - startedAt;
    safeLog("generation_fail", { mode, errorClass, ms: totalMs });
    console.log("PROOF_SUMMARY", JSON.stringify({
      reqId,
      psidHash: anonymizePsid(psid).slice(0, 12),
      style: chosenStyle,
      incomingLen: 0,
      incomingSha256: "",
      openaiInputLen: 0,
      openaiInputSha256: "",
      outputUrl: null,
      totalMs,
      ok: false,
      errorCode: errorClass,
    }));

    let failureText = t(lang, "generationGenericFailure");
    if (error instanceof MissingInputImageError) {
      console.error("MISSING_INPUT_IMAGE", { reqId, userId });
      await sendText(psid, t(lang, "missingInputImage"));
      setFlowState(userId, "AWAITING_PHOTO");
      return;
    } else if (error instanceof MissingOpenAiApiKeyError || error instanceof MissingAppBaseUrlError) {
      safeLog("openai_not_configured", { mode });
      failureText = t(lang, "generationUnavailable");
    } else if (error instanceof GenerationTimeoutError) {
      failureText = t(lang, "generationTimeout");
    } else if (error instanceof InvalidGenerationInputError || error instanceof OpenAiGenerationError) {
      failureText = t(lang, "generationGenericFailure");
    }

    await sendText(psid, t(lang, "failure"));

    setFlowState(userId, "FAILURE");
    await sendFailurePrompt(psid, style, failureText, lang);
  }
}

async function handleStyleSelection(psid: string, userId: string, style: Style, reqId: string, lang: Lang): Promise<void> {
  const state = getOrCreateState(userId);
  const chosenStyle = style;

  console.log("STYLE_SELECTED", {
    psid,
    style: chosenStyle,
  });

  if (state.stage === "PROCESSING") {
    await sendText(psid, t(lang, "processingBlocked"));
    return;
  }

  setChosenStyle(userId, style);
  safeLog("style_selected", { user: toLogUser(userId), selectedStyle: style });

  if (!state.lastPhoto) {
    setFlowState(userId, "AWAITING_PHOTO");
    await sendText(psid, t(lang, "styleWithoutPhoto"));
    return;
  }

  await runStyleGeneration(psid, userId, style, reqId, lang);
}

async function handlePayload(psid: string, userId: string, payload: string, reqId: string, lang: Lang): Promise<void> {
  if (payload.startsWith("RETRY_STYLE_")) {
    const retryStyleFromPayload = normalizeStyle(payload.slice("RETRY_STYLE_".length));
    const state = getOrCreateState(userId);
    const selectedStyle = normalizeStyle(state.selectedStyle ?? "") ?? retryStyleFromPayload;

    if (!selectedStyle) {
      setFlowState(userId, "AWAITING_STYLE");
      await sendStylePicker(psid, lang);
      return;
    }

    if (!state.lastPhoto) {
      setFlowState(userId, "AWAITING_PHOTO");
      await sendText(psid, t(lang, "styleWithoutPhoto"));
      return;
    }

    console.log("STYLE_SELECTED", {
      psid,
      style: selectedStyle,
    });

    await runStyleGeneration(psid, userId, selectedStyle, reqId, lang);
    return;
  }

  const selectedStyle = stylePayloadToStyle(payload);
  if (selectedStyle) {
    getOrCreateState(userId);
    await handleStyleSelection(psid, userId, selectedStyle, reqId, lang);
    return;
  }

  if (payload === "CHOOSE_STYLE") {
    setFlowState(userId, "AWAITING_STYLE");
    await sendStylePicker(psid, lang);
    return;
  }

  if (payload === "RETRY_STYLE") {
    const chosenStyle = getOrCreateState(userId).selectedStyle;
    const retryStyle = chosenStyle ? parseStyle(chosenStyle) : undefined;

    if (retryStyle) {
      await handleStyleSelection(psid, userId, retryStyle, reqId, lang);
      return;
    }

    setFlowState(userId, "AWAITING_STYLE");
    await sendStylePicker(psid, lang);
    return;
  }

  if (payload === "WHAT_IS_THIS") {
    await explainFlow(psid, lang);
    return;
  }

  if (payload === "PRIVACY_INFO") {
    await explainPrivacy(psid, lang);
    return;
  }

  if (payload === "WHO_IS_BEHIND") {
    await explainWhoIsBehind(psid, lang);
    return;
  }

  if (payload === "START_PHOTO" || payload === "SEND_PHOTO") {
    setFlowState(userId, "AWAITING_PHOTO");
    await sendText(psid, t(lang, "textWithoutPhoto"));
    return;
  }

  if (payload === "DOWNLOAD_HD") {
    const state = getOrCreateState(userId);

    if (state.lastImageUrl) {
      await sendImage(psid, state.lastImageUrl);
      return;
    }

    await sendText(psid, t(lang, "hdUnavailable"));
    setFlowState(userId, "AWAITING_PHOTO");
    await sendText(psid, t(lang, "textWithoutPhoto"));
    return;
  }

  safeLog("unknown_payload", { user: toLogUser(userId) });
}

async function handleMessage(psid: string, userId: string, event: FacebookWebhookEvent, reqId: string, lang: Lang): Promise<void> {
  const message = event.message;

  if (!message || message.is_echo) {
    return;
  }

  const quickPayload = message.quick_reply?.payload;
  if (quickPayload) {
    await handlePayload(psid, userId, quickPayload, reqId, lang);
    return;
  }

  const imageAttachment = message.attachments?.find(att => att.type === "image" && att.payload?.url);
  if (imageAttachment?.payload?.url) {
    console.log("PHOTO_RECEIVED", {
      psid,
      hasAttachments: !!message.attachments,
    });

    setPendingImage(userId, imageAttachment.payload.url);
    setFlowState(userId, "AWAITING_STYLE");
    await sendPhotoReceivedPrompt(psid, lang);
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

  if (normalizedText === "wie zit hierachter?" || normalizedText === "wie zit hierachter") {
    await explainWhoIsBehind(psid, lang);
    return;
  }

  const styleFromText = parseStyle(trimmedText);
  if (styleFromText) {
    getOrCreateState(userId);
    await handleStyleSelection(psid, userId, styleFromText, reqId, lang);
    return;
  }

  if (GREETINGS.has(normalizedText) || SMALLTALK.has(normalizedText)) {
    await handleGreeting(psid, userId, lang);
    return;
  }

  const state = getOrCreateState(userId);
  if (!state.lastPhoto) {
    setFlowState(userId, "AWAITING_PHOTO");
    await sendText(psid, t(lang, "textWithoutPhoto"));
    return;
  }

  await explainFlow(psid, lang);
}

function getEventLang(event: FacebookWebhookEvent, userId: string): Lang {
  const localeLang = normalizeLang(event.sender?.locale);
  const stateLang = getOrCreateState(userId).preferredLang;

  if (typeof event.sender?.locale === "string" && event.sender.locale.trim().length > 0) {
    setPreferredLang(userId, localeLang);
    return localeLang;
  }

  return stateLang ?? DEFAULT_LANG;
}

async function handleEvent(event: FacebookWebhookEvent): Promise<void> {
  const psid = event.sender?.id;
  if (!psid) {
    return;
  }

  const userId = toUserKey(psid);
  const reqId = `${psid}-${Date.now()}`;
  const lang = getEventLang(event, userId);

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
    await handlePayload(psid, userId, event.postback.payload, reqId, lang);
    return;
  }

  await handleMessage(psid, userId, event, reqId, lang);
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
    if (shouldSampleWebhookSummary()) {
      const webhookInLog = {
        level: isDebugLogEnabled() ? "debug" : "info",
        msg: "webhook_in",
        reqId: (req as { reqId?: unknown }).reqId,
        summary: summarizeWebhook(req.body),
      };

      try {
        console.log(JSON.stringify(webhookInLog));
      } catch {
        console.log("[webhook_in]", webhookInLog);
      }
    }

    const payload: unknown = req.body;
    res.sendStatus(200);

    setImmediate(() => {
      void processFacebookWebhookPayload(payload).catch(error => {
        console.error("[facebook-webhook] failed to process event", error);
      });
    });
  });
}
