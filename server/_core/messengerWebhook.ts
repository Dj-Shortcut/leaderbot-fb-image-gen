import express from "express";
import { TtlDedupeSet } from "./dedupe";
import { sendImage, sendQuickReplies, sendText, safeLog } from "./messengerApi";
import { type Style } from "./messengerStyles";
import {
  createImageGenerator,
  getGenerationMetrics,
  GenerationTimeoutError,
  InvalidGenerationInputError,
  MissingInputImageError,
  MissingAppBaseUrlError,
  MissingOpenAiApiKeyError,
  OpenAiGenerationError,
} from "./imageService";
import {
  clearPendingImageState,
  getOrCreateState,
  getQuickRepliesForState,
  setChosenStyle,
  setFlowState,
  setLastGenerated,
  setPendingImage,
  setPreselectedStyle,
  setPreferredLang,
  type ConversationState,
  anonymizePsid,
} from "./messengerState";
import { normalizeLang, t, type Lang } from "./i18n";
import { toLogUser, toUserKey } from "./privacy";
import { isDebugLogEnabled, shouldSampleWebhookSummary } from "./logLevel";
import { storagePut } from "../storage";

type FacebookWebhookEvent = {
  sender?: { id?: string; locale?: string };
  referral?: { ref?: string };
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
    referral?: { ref?: string };
  };
  timestamp?: number;
};

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

function parseReferralStyle(ref: string | undefined): Style | undefined {
  if (!ref?.startsWith("style_")) {
    return undefined;
  }

  return normalizeStyle(ref.slice("style_".length));
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

async function sendReferralPhotoPrompt(psid: string, style: Style, lang: Lang): Promise<void> {
  const styleLabel = STYLE_LABELS[style];
  const text =
    lang === "en"
      ? `You came in via ${styleLabel}. Send a photo to start `
      : `Je bent binnengekomen via ${styleLabel}. Stuur een foto om te starten `;
  await sendText(psid, text);
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

function logGenerationSummary(summary: {
  reqId: string;
  psid: string;
  mode: string;
  style: Style;
  ok: boolean;
  errorClass?: string;
  fbImageFetchMs?: number;
  openAiMs?: number;
  uploadOrServeMs?: number;
  totalMs: number;
}): void {
  console.info(JSON.stringify({
    level: "info",
    msg: "generation_summary",
    reqId: summary.reqId,
    psid: summary.psid,
    mode: summary.mode,
    style: summary.style,
    ok: summary.ok,
    errorClass: summary.errorClass,
    fb_image_fetch_ms: summary.fbImageFetchMs,
    openai_ms: summary.openAiMs,
    upload_or_serve_ms: summary.uploadOrServeMs,
    total_ms: summary.totalMs,
  }));
}

async function runStyleGeneration(psid: string, userId: string, style: Style, reqId: string, lang: Lang): Promise<void> {
  const { mode, generator } = createImageGenerator();

  await setFlowState(psid, "PROCESSING");
  await sendText(psid, t(lang, "generatingPrompt", { styleLabel: STYLE_LABELS[style] }));

  const state = await getOrCreateState(psid);
  const lastImageUrl = state.lastPhotoUrl;

  try {
    const { imageUrl, proof, metrics } = await generator.generate({
      style,
      sourceImageUrl: lastImageUrl ?? undefined,
      userKey: userId,
      reqId,
    });

    console.info(JSON.stringify({
      level: "info",
      msg: "generation_summary",
      reqId,
      psid,
      mode,
      style,
      ok: true,
      fb_image_fetch_ms: metrics.fbImageFetchMs,
      openai_ms: metrics.openAiMs,
      upload_or_serve_ms: metrics.uploadOrServeMs,
      total_ms: metrics.totalMs,
    }));

    console.log("PROOF_SUMMARY", JSON.stringify({
      reqId,
      psidHash: anonymizePsid(psid).slice(0, 12),
      style,
      incomingLen: proof.incomingLen,
      incomingSha256: proof.incomingSha256,
      openaiInputLen: proof.openaiInputLen,
      openaiInputSha256: proof.openaiInputSha256,
      outputUrl: imageUrl,
      totalMs: metrics.totalMs,
      ok: true,
    }));

    await sendImage(psid, imageUrl);
    await setLastGenerated(psid, imageUrl);
    await sendStateQuickReplies(psid, "RESULT_READY", t(lang, "success"));
  } catch (error) {
    console.error("OPENAI_CALL_ERROR", { psid, error: error instanceof Error ? error.message : undefined });

    const errorClass = error instanceof Error ? error.constructor.name : "UnknownError";
    const metrics = getGenerationMetrics(error) ?? { totalMs: 0 };

    console.log("PROOF_SUMMARY", JSON.stringify({
      reqId,
      psidHash: anonymizePsid(psid).slice(0, 12),
      style,
      ok: false,
      errorCode: errorClass,
    }));

    let failureText = t(lang, "generationGenericFailure");
    if (error instanceof MissingInputImageError) {
      await sendText(psid, t(lang, "missingInputImage"));
      await setFlowState(psid, "AWAITING_PHOTO");
      return;
    } else if (error instanceof MissingOpenAiApiKeyError || error instanceof MissingAppBaseUrlError) {
      failureText = t(lang, "generationUnavailable");
    } else if (error instanceof GenerationTimeoutError) {
      failureText = t(lang, "generationTimeout");
    }

    await sendText(psid, t(lang, "failure"));
    await setFlowState(psid, "FAILURE");
    
    await sendQuickReplies(psid, failureText, [
        { content_type: "text", title: t(lang, "retryThisStyle"), payload: `RETRY_STYLE_${style}` },
        { content_type: "text", title: t(lang, "otherStyle"), payload: "CHOOSE_STYLE" },
    ]);
  }
}

async function handlePayload(psid: string, userId: string, payload: string, reqId: string, lang: Lang): Promise<void> {
  if (payload.startsWith("RETRY_STYLE_")) {
    const retryStyle = normalizeStyle(payload.slice("RETRY_STYLE_".length));
    if (retryStyle) {
        await runStyleGeneration(psid, userId, retryStyle, reqId, lang);
        return;
    }
  }

  const selectedStyle = stylePayloadToStyle(payload);
  if (selectedStyle) {
    const state = await getOrCreateState(psid);
    if (state.stage === "PROCESSING") {
        await sendText(psid, t(lang, "processingBlocked"));
        return;
    }
    await setChosenStyle(psid, selectedStyle);
    if (!state.lastPhotoUrl) {
        await setFlowState(psid, "AWAITING_PHOTO");
        await sendText(psid, t(lang, "styleWithoutPhoto"));
        return;
    }
    await runStyleGeneration(psid, userId, selectedStyle, reqId, lang);
    return;
  }

  if (payload === "CHOOSE_STYLE") {
    setPreselectedStyle(userId, null);
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
    await sendText(psid, t(lang, "flowExplanation"));
    return;
  }

  if (payload === "PRIVACY_INFO") {
    await sendText(psid, t(lang, "privacy", { link: PRIVACY_POLICY_URL }));
    return;
  }

  safeLog("unknown_payload", { user: toLogUser(userId) });
}

async function handleMessage(psid: string, userId: string, event: FacebookWebhookEvent, reqId: string, lang: Lang): Promise<void> {
  const message = event.message;
  if (!message || message.is_echo) return;

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

    const state = getOrCreateState(userId);
    const preselectedStyle = normalizeStyle(state.preselectedStyle ?? "");
    setPendingImage(userId, imageAttachment.payload.url);

    if (preselectedStyle) {
      setPreselectedStyle(userId, null);
      setChosenStyle(userId, preselectedStyle);
      await runStyleGeneration(psid, userId, preselectedStyle, reqId, lang);
      return;
    }

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

  const text = message.text?.trim().toLowerCase();
  if (!text) return;

  if (GREETINGS.has(text) || SMALLTALK.has(text)) {
    const state = await getOrCreateState(psid);
    const response = getGreetingResponse(state.stage, lang);
    if (response.mode === "text") {
        await sendText(psid, response.text);
    } else {
        await sendStateQuickReplies(psid, response.state, response.text);
    }
    return;
  }

  const state = await getOrCreateState(psid);
  if (!state.lastPhotoUrl) {
    await setFlowState(psid, "AWAITING_PHOTO");
    await sendText(psid, t(lang, "textWithoutPhoto"));
    return;
  }

  await sendText(psid, t(lang, "flowExplanation"));
}

async function handleEvent(event: FacebookWebhookEvent): Promise<void> {
  const psid = event.sender?.id;
  if (!psid) return;

  const userId = toUserKey(psid);
  const reqId = `${psid}-${Date.now()}`;
  const localeLang = normalizeLang(event.sender?.locale);
  const state = await getOrCreateState(psid);
  const lang = state.preferredLang || localeLang || DEFAULT_LANG;

  if (localeLang && localeLang !== state.preferredLang) {
      await setPreferredLang(psid, localeLang);
  }

  const dedupeKey = getEventDedupeKey(event, userId);
  if (dedupeKey && incomingEventDedupe.seen(dedupeKey)) return;

  const referralStyle = parseReferralStyle(event.postback?.referral?.ref ?? event.referral?.ref);
  if (referralStyle) {
    clearPendingImageState(userId);
    setPreselectedStyle(userId, referralStyle);
    setFlowState(userId, "AWAITING_PHOTO");
    await sendReferralPhotoPrompt(psid, referralStyle, lang);
    return;
  }

  if (event.postback?.payload) {
    await handlePayload(psid, userId, event.postback.payload, reqId, lang);
    return;
  }

  await handleMessage(psid, userId, event, reqId, lang);
}

export async function processFacebookWebhookPayload(payload: unknown): Promise<void> {
  const entries = (payload as any)?.entry || [];
  for (const entry of entries) {
    const events = entry?.messaging || [];
    for (const event of events) {
      await handleEvent(event);
    }
  }
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
