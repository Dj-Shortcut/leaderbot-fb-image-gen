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
  setLastUserMessageAt,
  setPendingImage,
  setPreselectedStyle,
  setPreferredLang,
  markIntroSeen,
  anonymizePsid,
  type ConversationState,
} from "./messengerState";
import { normalizeLang, t, type Lang } from "./i18n";
import { toLogUser, toUserKey } from "./privacy";
import type { Style } from "./messengerStyles";
import { claimWebhookReplayKey } from "./webhookReplayProtection";
import {
  detectAck,
  type FacebookWebhookEntry,
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
import { runGuardedGeneration } from "./generationGuard";

type HandlerDeps = {
  defaultLang: Lang;
  privacyPolicyUrl: string;
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

export function createWebhookHandlers({ defaultLang, privacyPolicyUrl }: HandlerDeps) {
  function getAttachmentHostname(url: string): string | null {
    try {
      return new URL(url).hostname || null;
    } catch {
      return null;
    }
  }

  function logIncomingMessage(
    psid: string,
    userId: string,
    event: FacebookWebhookEvent,
    reqId: string
  ): void {
    console.log(
      JSON.stringify({
        level: "debug",
        msg: "incoming_message",
        reqId,
        user: toLogUser(userId),
        psidHash: anonymizePsid(psid).slice(0, 12),
        isEcho: Boolean(event.message?.is_echo),
        text: event.message?.text ?? null,
        quickReplyPayload: event.message?.quick_reply?.payload ?? null,
        attachments:
          event.message?.attachments?.map(attachment => ({
            type: attachment.type,
            hasUrl: Boolean(attachment.payload?.url),
          })) ?? [],
        postbackPayload: event.postback?.payload ?? null,
        referralRef: event.postback?.referral?.ref ?? event.referral?.ref ?? null,
      })
    );
  }

  function logUserState(
    psid: string,
    userId: string,
    state: Awaited<ReturnType<typeof getOrCreateState>>,
    reqId: string,
    context: string
  ): void {
    console.log(
      JSON.stringify({
        level: "debug",
        msg: "user_state",
        context,
        reqId,
        user: toLogUser(userId),
        psidHash: anonymizePsid(psid).slice(0, 12),
        stage: state.stage,
        hasSeenIntro: state.hasSeenIntro,
        hasLastPhoto: Boolean(state.lastPhotoUrl),
        selectedStyle: state.selectedStyle ?? null,
        preselectedStyle: state.preselectedStyle ?? null,
        preferredLang: state.preferredLang ?? null,
      })
    );
  }

  async function sendLoggedText(psid: string, text: string, reqId: string): Promise<void> {
    console.log(
      JSON.stringify({
        level: "debug",
        msg: "outgoing_message",
        kind: "text",
        reqId,
        psidHash: anonymizePsid(psid).slice(0, 12),
        text,
      })
    );
    await sendText(psid, text);
  }

  async function sendLoggedQuickReplies(
    psid: string,
    text: string,
    replies: Parameters<typeof sendQuickReplies>[2],
    reqId: string
  ): Promise<void> {
    console.log(
      JSON.stringify({
        level: "debug",
        msg: "outgoing_message",
        kind: "quick_replies",
        reqId,
        psidHash: anonymizePsid(psid).slice(0, 12),
        text,
        quickReplies: replies.map(reply => ({
          title: reply.title,
          payload: reply.payload,
        })),
      })
    );
    await sendQuickReplies(psid, text, replies);
  }

  async function sendLoggedImage(psid: string, imageUrl: string, reqId: string): Promise<void> {
    console.log(
      JSON.stringify({
        level: "debug",
        msg: "outgoing_message",
        kind: "image",
        reqId,
        psidHash: anonymizePsid(psid).slice(0, 12),
        imageUrl,
      })
    );
    await sendImage(psid, imageUrl);
  }

  async function sendStateQuickReplies(
    psid: string,
    state: ConversationState,
    text: string,
    reqId: string
  ): Promise<void> {
    const replies = toMessengerReplies(state);
    if (replies.length === 0) {
      await sendLoggedText(psid, text, reqId);
      return;
    }

    await sendLoggedQuickReplies(psid, text, replies, reqId);
  }

  async function sendStylePicker(psid: string, lang: Lang, reqId: string): Promise<void> {
    await sendStateQuickReplies(psid, "AWAITING_STYLE", t(lang, "stylePicker"), reqId);
  }

  async function sendPhotoReceivedPrompt(
    psid: string,
    lang: Lang,
    reqId: string
  ): Promise<void> {
    await sendStylePicker(psid, lang, reqId);
  }

  async function sendIntro(psid: string, lang: Lang, reqId: string): Promise<void> {
    await sendStateQuickReplies(psid, "IDLE", t(lang, "flowExplanation"), reqId);
  }

  async function sendReferralPhotoPrompt(
    psid: string,
    style: Style,
    lang: Lang,
    reqId: string
  ): Promise<void> {
    const styleLabel = STYLE_LABELS[style];
    const text =
      lang === "en"
        ? `You came in via ${styleLabel}. Send a photo to start `
        : `Je bent binnengekomen via ${styleLabel}. Stuur een foto om te starten `;
    await sendLoggedText(psid, text, reqId);
  }

  async function runStyleGeneration(
    psid: string,
    userId: string,
    style: Style,
    reqId: string,
    lang: Lang
  ): Promise<void> {
    const didRun = await runGuardedGeneration(psid, async () => {
      const { mode, generator } = createImageGenerator();

      await setFlowState(psid, "PROCESSING");
      await sendLoggedText(
        psid,
        t(lang, "generatingPrompt", { styleLabel: STYLE_LABELS[style] }),
        reqId
      );

      const state = await getOrCreateState(psid);
      const lastImageUrl = state.lastPhotoUrl;

      try {
        const { imageUrl, proof, metrics } = await generator.generate({
          style,
          sourceImageUrl: lastImageUrl ?? undefined,
          userKey: userId,
          reqId,
        });

        console.info(
          JSON.stringify({
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
          })
        );

        console.log(
          "PROOF_SUMMARY",
          JSON.stringify({
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
          })
        );

        await sendLoggedImage(psid, imageUrl, reqId);
        await setLastGenerated(psid, imageUrl);
        await sendStateQuickReplies(psid, "RESULT_READY", t(lang, "success"), reqId);
        await setFlowState(psid, "IDLE");
      } catch (error) {
        console.error("OPENAI_CALL_ERROR", {
          psid,
          error: error instanceof Error ? error.message : undefined,
        });

        const errorClass =
          error instanceof Error ? error.constructor.name : "UnknownError";
        getGenerationMetrics(error) ?? { totalMs: 0 };

        console.log(
          "PROOF_SUMMARY",
          JSON.stringify({
            reqId,
            psidHash: anonymizePsid(psid).slice(0, 12),
            style,
            ok: false,
            errorCode: errorClass,
          })
        );

        let failureText = t(lang, "generationGenericFailure");
        if (error instanceof MissingInputImageError) {
          await sendLoggedText(psid, t(lang, "missingInputImage"), reqId);
          await setFlowState(psid, "AWAITING_PHOTO");
          return;
        } else if (
          error instanceof MissingOpenAiApiKeyError ||
          error instanceof MissingAppBaseUrlError
        ) {
          failureText = t(lang, "generationUnavailable");
        } else if (error instanceof GenerationTimeoutError) {
          failureText = t(lang, "generationTimeout");
        }

        await sendLoggedText(psid, t(lang, "failure"), reqId);
        await setFlowState(psid, "FAILURE");

        await sendLoggedQuickReplies(psid, failureText, [
          {
            content_type: "text",
            title: t(lang, "retryThisStyle"),
            payload: `RETRY_STYLE_${style}`,
          },
          {
            content_type: "text",
            title: t(lang, "otherStyle"),
            payload: "CHOOSE_STYLE",
          },
        ], reqId);
      }
    });

    if (didRun === null) {
      await sendLoggedText(psid, t(lang, "processingBlocked"), reqId);
    }
  }

  async function handleStyleSelection(
    psid: string,
    userId: string,
    selectedStyle: Style,
    reqId: string,
    lang: Lang
  ): Promise<void> {
    const state = await getOrCreateState(psid);
    if (state.stage === "PROCESSING") {
      await sendLoggedText(psid, t(lang, "processingBlocked"), reqId);
      return;
    }

    await setChosenStyle(psid, selectedStyle);
    if (!state.lastPhotoUrl) {
      await setFlowState(psid, "AWAITING_PHOTO");
      await sendLoggedText(psid, t(lang, "styleWithoutPhoto"), reqId);
      return;
    }

    await runStyleGeneration(psid, userId, selectedStyle, reqId, lang);
  }

  async function handlePayload(
    psid: string,
    userId: string,
    payload: string,
    reqId: string,
    lang: Lang
  ): Promise<void> {
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
      await sendStylePicker(psid, lang, reqId);
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
      await sendStylePicker(psid, lang, reqId);
      return;
    }

    if (payload === "WHAT_IS_THIS") {
      await sendLoggedText(psid, t(lang, "flowExplanation"), reqId);
      return;
    }

    if (payload === "PRIVACY_INFO") {
      await sendLoggedText(psid, t(lang, "privacy", { link: privacyPolicyUrl }), reqId);
      return;
    }

    safeLog("unknown_payload", { user: toLogUser(userId) });
  }

  async function handleMessage(
    psid: string,
    userId: string,
    event: FacebookWebhookEvent,
    reqId: string,
    lang: Lang
  ): Promise<void> {
    const message = event.message;
    if (!message || message.is_echo) return;
    await setLastUserMessageAt(psid, event.timestamp ?? Date.now());

    const quickPayload = message.quick_reply?.payload;
    if (quickPayload) {
      await handlePayload(psid, userId, quickPayload, reqId, lang);
      return;
    }

    const imageAttachment = message.attachments?.find(
      att => att.type === "image" && att.payload?.url
    );
    if (imageAttachment?.payload?.url) {
      console.log(
        JSON.stringify({
          level: "debug",
          msg: "photo_received",
          reqId,
          psidHash: anonymizePsid(psid).slice(0, 12),
          hasAttachments: !!message.attachments,
          attachmentHostname: getAttachmentHostname(imageAttachment.payload.url),
        })
      );

      const state = await getOrCreateState(psid);
      logUserState(psid, userId, state, reqId, "image_received");
      const preselectedStyle = normalizeStyle(state.preselectedStyle ?? "");
      await setPendingImage(psid, imageAttachment.payload.url);

      if (preselectedStyle) {
        await setPreselectedStyle(psid, null);
        await setChosenStyle(psid, preselectedStyle);
        await runStyleGeneration(psid, userId, preselectedStyle, reqId, lang);
        return;
      }

      await setFlowState(psid, "AWAITING_STYLE");
      await sendPhotoReceivedPrompt(psid, lang, reqId);
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
      logUserState(psid, userId, state, reqId, "greeting");
      if (!state.hasSeenIntro && state.stage === "IDLE") {
        await sendIntro(psid, lang, reqId);
        await markIntroSeen(psid);
        return;
      }

      const response = getGreetingResponse(state.stage, lang);
      if (response.mode === "text") {
        await sendLoggedText(psid, response.text, reqId);
      } else {
        await sendStateQuickReplies(psid, response.state, response.text, reqId);
      }
      return;
    }

    const state = await getOrCreateState(psid);
    logUserState(psid, userId, state, reqId, "text_message");
    if (!state.lastPhotoUrl) {
      await setFlowState(psid, "AWAITING_PHOTO");
      await sendLoggedText(psid, t(lang, "textWithoutPhoto"), reqId);
      return;
    }

    await sendLoggedText(psid, t(lang, "flowExplanation"), reqId);
  }

  async function handleEvent(event: FacebookWebhookEvent, entryId?: string): Promise<void> {
    const psid = event.sender?.id;
    if (!psid) return;

    const userId = toUserKey(psid);
    const reqId = `${psid}-${Date.now()}`;
    const localeLang = normalizeLang(event.sender?.locale);
    const state = await getOrCreateState(psid);
    logIncomingMessage(psid, userId, event, reqId);
    logUserState(psid, userId, state, reqId, "handle_event");
    const lang = state.preferredLang || localeLang || defaultLang;

    if (localeLang && localeLang !== state.preferredLang) {
      await setPreferredLang(psid, localeLang);
    }

    const dedupeKey = getEventDedupeKey(event, userId, entryId);
    if (dedupeKey) {
      const claimed = await claimWebhookReplayKey(dedupeKey);
      if (!claimed) {
        safeLog("webhook_replay_ignored", {
          user: toLogUser(userId),
          eventId: dedupeKey,
        });
        return;
      }
    }

    const referralStyle = parseReferralStyle(
      event.postback?.referral?.ref ?? event.referral?.ref
    );
    if (referralStyle) {
      await clearPendingImageState(psid);
      await setPreselectedStyle(psid, referralStyle);
      await setFlowState(psid, "AWAITING_PHOTO");
      return sendReferralPhotoPrompt(psid, referralStyle, lang, reqId);
    }

    if (event.postback?.payload) {
      await handlePayload(psid, userId, event.postback.payload, reqId, lang);
      return;
    }

    await handleMessage(psid, userId, event, reqId, lang);
  }

  async function processFacebookWebhookPayload(
    payload: unknown
  ): Promise<void> {
    const entries = (payload as any)?.entry || [];
    for (const entry of entries as FacebookWebhookEntry[]) {
      const events = entry?.messaging || [];
      for (const event of events) {
        await handleEvent(event, entry?.id);
      }
    }
  }

  return { processFacebookWebhookPayload };
}
