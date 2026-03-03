import { sendImage, sendQuickReplies, sendText, safeLog } from "./messengerApi";
import {
  createImageGenerator,
  getGenerationMetrics,
  GenerationTimeoutError,
  MissingInputImageError,
  MissingAppBaseUrlError,
  MissingOpenAiApiKeyError,
} from "./imageService";
import {
  clearPendingImageState,
  getOrCreateState,
  setChosenStyle,
  setFlowState,
  setLastGenerated,
  setPendingImage,
  setPreselectedStyle,
  setPreferredLang,
  markIntroSeen,
  anonymizePsid,
  type ConversationState,
} from "./messengerState";
import { normalizeLang, t, type Lang } from "./i18n";
import { toLogUser, toUserKey } from "./privacy";
import { TtlDedupeSet } from "./dedupe";
import type { Style } from "./messengerStyles";
import {
  detectAck,
  FacebookWebhookEvent,
  getEventDedupeKey,
  getGreetingResponse,
  normalizeStyle,
  parseReferralStyle,
  parseStyle,
  STYLE_LABELS,
  stylePayloadToStyle,
  toMessengerReplies,
} from "./webhookHelpers";

type HandlerDeps = {
  incomingEventDedupe: TtlDedupeSet;
  defaultLang: Lang;
  privacyPolicyUrl: string;
};

const GREETINGS = new Set(["hi", "hello", "hey", "yo", "hola"]);
const SMALLTALK = new Set(["how are you", "how are you?", "sup", "what's up", "whats up", "thanks", "thank you"]);

export function createWebhookHandlers({ incomingEventDedupe, defaultLang, privacyPolicyUrl }: HandlerDeps) {
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

  async function sendIntro(psid: string, lang: Lang): Promise<void> {
    await sendStateQuickReplies(psid, "IDLE", t(lang, "flowExplanation"));
  }

  async function sendReferralPhotoPrompt(psid: string, style: Style, lang: Lang): Promise<void> {
    const styleLabel = STYLE_LABELS[style];
    const text =
      lang === "en"
        ? `You came in via ${styleLabel}. Send a photo to start `
        : `Je bent binnengekomen via ${styleLabel}. Stuur een foto om te starten `;
    await sendText(psid, text);
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
      getGenerationMetrics(error) ?? { totalMs: 0 };

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

  async function handleStyleSelection(psid: string, userId: string, selectedStyle: Style, reqId: string, lang: Lang): Promise<void> {
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
      await handleStyleSelection(psid, userId, selectedStyle, reqId, lang);
      return;
    }

    if (payload === "CHOOSE_STYLE") {
      await setPreselectedStyle(psid, null);
      await setFlowState(psid, "AWAITING_STYLE");
      await sendStylePicker(psid, lang);
      return;
    }

    if (payload === "RETRY_STYLE") {
      const chosenStyle = (await getOrCreateState(psid)).selectedStyle;
      const retryStyle = chosenStyle ? parseStyle(chosenStyle) : undefined;

      if (retryStyle) {
        await handleStyleSelection(psid, userId, retryStyle, reqId, lang);
        return;
      }

      await setFlowState(psid, "AWAITING_STYLE");
      await sendStylePicker(psid, lang);
      return;
    }

    if (payload === "WHAT_IS_THIS") {
      await sendText(psid, t(lang, "flowExplanation"));
      return;
    }

    if (payload === "PRIVACY_INFO") {
      await sendText(psid, t(lang, "privacy", { link: privacyPolicyUrl }));
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

      const state = await getOrCreateState(psid);
      const preselectedStyle = normalizeStyle(state.preselectedStyle ?? "");
      await setPendingImage(psid, imageAttachment.payload.url);

      if (preselectedStyle) {
        await setPreselectedStyle(psid, null);
        await setChosenStyle(psid, preselectedStyle);
        await runStyleGeneration(psid, userId, preselectedStyle, reqId, lang);
        return;
      }

      await setFlowState(psid, "AWAITING_STYLE");
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

    if (GREETINGS.has(normalizedText) || SMALLTALK.has(normalizedText)) {
      const state = await getOrCreateState(psid);
      if (!state.hasSeenIntro && state.stage === "IDLE") {
        await sendIntro(psid, lang);
        await markIntroSeen(psid);
        return;
      }

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
    const lang = state.preferredLang || localeLang || defaultLang;

    if (localeLang && localeLang !== state.preferredLang) {
      await setPreferredLang(psid, localeLang);
    }

    const dedupeKey = getEventDedupeKey(event, userId);
    if (dedupeKey && incomingEventDedupe.seen(dedupeKey)) return;

    const referralStyle = parseReferralStyle(event.postback?.referral?.ref ?? event.referral?.ref);
    if (referralStyle) {
      await clearPendingImageState(psid);
      await setPreselectedStyle(psid, referralStyle);
      await setFlowState(psid, "AWAITING_PHOTO");
      return sendReferralPhotoPrompt(psid, referralStyle, lang);
    }

    if (event.postback?.payload) {
      await handlePayload(psid, userId, event.postback.payload, reqId, lang);
      return;
    }

    await handleMessage(psid, userId, event, reqId, lang);
  }

  async function processFacebookWebhookPayload(payload: unknown): Promise<void> {
    const entries = (payload as any)?.entry || [];
    for (const entry of entries) {
      const events = entry?.messaging || [];
      for (const event of events) {
        await handleEvent(event);
      }
    }
  }

  return { processFacebookWebhookPayload };
}
