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
import { hasInFlightGeneration, runGuardedGeneration } from "./generationGuard";
import { canGenerate, increment } from "./messengerQuota";
import { isDebugLogEnabled } from "./logLevel";
import { createLogger } from "./logger";

type HandlerDeps = {
  defaultLang: Lang;
  privacyPolicyUrl: string;
};

type MessengerEventContext = {
  psid: string;
  userId: string;
  reqId: string;
  lang: Lang;
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

const IN_FLIGHT_MESSAGE = "\u23F3 even geduld, ik ben nog bezig met jouw restyle";
const inFlightNoticeSent = new Set<string>();

export function createWebhookHandlers({ defaultLang, privacyPolicyUrl }: HandlerDeps) {
  function createMessengerSender(reqId: string) {
    return {
      sendText: async (psid: string, text: string) => sendLoggedText(psid, text, reqId),
      sendStylePicker: async (psid: string, lang: Lang) => sendStylePicker(psid, lang, reqId),
    };
  }

  function debugWebhookLog(message: Record<string, unknown>): void {
    if (!isDebugLogEnabled()) {
      return;
    }
function getAttachmentHostname(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function createMessengerSender(reqId: string) {
  const logger = createLogger({ reqId, debugEnabled: isDebugLogEnabled() });

  async function sendLoggedText(psid: string, text: string): Promise<void> {
    logger.debug({
      msg: "outgoing_message",
      kind: "text",
      psidHash: anonymizePsid(psid).slice(0, 12),
      text,
    });
    await sendText(psid, text);
  }

  async function sendLoggedQuickReplies(
    psid: string,
    text: string,
    replies: Parameters<typeof sendQuickReplies>[2],
  ): Promise<void> {
    logger.debug({
      msg: "outgoing_message",
      kind: "quick_replies",
      psidHash: anonymizePsid(psid).slice(0, 12),
      text,
      quickReplies: replies.map(reply => ({
        title: reply.title,
        payload: reply.payload,
      })),
    });
    await sendQuickReplies(psid, text, replies);
  }

  async function sendLoggedImage(psid: string, imageUrl: string): Promise<void> {
    logger.debug({
      msg: "outgoing_message",
      kind: "image",
      psidHash: anonymizePsid(psid).slice(0, 12),
      imageUrl,
    });
    await sendImage(psid, imageUrl);
  }

  async function sendStateQuickReplies(
    psid: string,
    state: ConversationState,
    text: string,
  ): Promise<void> {
    const replies = toMessengerReplies(state);
    if (replies.length === 0) {
      await sendLoggedText(psid, text);
      return;
    }

    await sendLoggedQuickReplies(psid, text, replies);
  }

  return {
    sendLoggedText,
    sendLoggedQuickReplies,
    sendLoggedImage,
    sendStateQuickReplies,
  };
}

function createEventLogger(reqId: string) {
  const logger = createLogger({ reqId, debugEnabled: isDebugLogEnabled() });

  return {
    logIncomingMessage(psid: string, userId: string, event: FacebookWebhookEvent): void {
      logger.debug({
        msg: "incoming_message",
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
      });
    },
    logUserState(
      psid: string,
      userId: string,
      state: Awaited<ReturnType<typeof getOrCreateState>>,
      context: string,
    ): void {
      logger.debug({
        msg: "user_state",
        context,
        user: toLogUser(userId),
        psidHash: anonymizePsid(psid).slice(0, 12),
        stage: state.stage,
        hasSeenIntro: state.hasSeenIntro,
        hasLastPhoto: Boolean(state.lastPhotoUrl),
        selectedStyle: state.selectedStyle ?? null,
        preselectedStyle: state.preselectedStyle ?? null,
        preferredLang: state.preferredLang ?? null,
      });
    },
    logPhotoReceived(psid: string, imageUrl: string): void {
      logger.debug({
        msg: "photo_received",
        psidHash: anonymizePsid(psid).slice(0, 12),
        hasAttachments: true,
        attachmentHostname: getAttachmentHostname(imageUrl),
      });
    },
    logQuotaDecision(psid: string, count: number, allowed: boolean, bypassApplied: boolean): void {
      logger.info({
        msg: "quota_decision",
        action: "check",
        psidHash: anonymizePsid(psid).slice(0, 12),
        count,
        limit: 2,
        bypassApplied,
        allowed,
      });
    },
    logGenerationSummary(psid: string, style: Style, mode: string, metrics: Record<string, number>): void {
      logger.info({
        msg: "generation_summary",
        psidHash: anonymizePsid(psid).slice(0, 12),
        mode,
        style,
        ok: true,
        fb_image_fetch_ms: metrics.fbImageFetchMs,
        openai_ms: metrics.openAiMs,
        upload_or_serve_ms: metrics.uploadOrServeMs,
        total_ms: metrics.totalMs,
      });
    },
    logProof(fields: Record<string, unknown>): void {
      logger.info({ msg: "proof_summary", ...fields });
    },
    logGenerationError(psid: string, error: unknown): void {
      logger.error({
        msg: "openai_call_error",
        psidHash: anonymizePsid(psid).slice(0, 12),
        error: error instanceof Error ? error.message : undefined,
      });
    },
  };
}

export function createWebhookHandlers({ defaultLang, privacyPolicyUrl }: HandlerDeps) {
  async function maybeSendInFlightMessage(ctx: MessengerEventContext): Promise<boolean> {
    if (!(await hasInFlightGeneration(ctx.psid))) {
      inFlightNoticeSent.delete(ctx.psid);
      return false;
    }

    if (inFlightNoticeSent.has(ctx.psid)) {
      return true;
    }

    const sender = createMessengerSender(ctx.reqId);
    inFlightNoticeSent.add(ctx.psid);
    await sender.sendLoggedText(ctx.psid, IN_FLIGHT_MESSAGE);
    return true;
  }

  async function sendStylePicker(ctx: MessengerEventContext): Promise<void> {
    const sender = createMessengerSender(ctx.reqId);
    await sender.sendStateQuickReplies(ctx.psid, "AWAITING_STYLE", t(ctx.lang, "stylePicker"));
  }

  async function sendIntro(ctx: MessengerEventContext): Promise<void> {
    const sender = createMessengerSender(ctx.reqId);
    await sender.sendStateQuickReplies(ctx.psid, "IDLE", t(ctx.lang, "flowExplanation"));
  }

  async function sendReferralPhotoPrompt(ctx: MessengerEventContext, style: Style): Promise<void> {
    const sender = createMessengerSender(ctx.reqId);
    const styleLabel = STYLE_LABELS[style];
    const text =
      ctx.lang === "en"
        ? `You came in via ${styleLabel}. Send a photo to start `
        : `Je bent binnengekomen via ${styleLabel}. Stuur een foto om te starten `;
    await sender.sendLoggedText(ctx.psid, text);
  }

  async function runStyleGeneration(ctx: MessengerEventContext, style: Style): Promise<void> {
    const sender = createMessengerSender(ctx.reqId);
    const eventLogger = createEventLogger(ctx.reqId);

    const didRun = await runGuardedGeneration(ctx.psid, async () => {
      const { mode, generator } = createImageGenerator();
      const allowed = await canGenerate(ctx.psid);
      const quotaState = await getOrCreateState(ctx.psid);
      const bypassRaw = process.env.MESSENGER_QUOTA_BYPASS_IDS ?? "";
      const bypassApplied = bypassRaw.includes(ctx.psid) || bypassRaw.includes(quotaState.userKey);
      eventLogger.logQuotaDecision(ctx.psid, quotaState.quota.count, allowed, bypassApplied);

      if (!allowed) {
        await sender.sendLoggedText(
          ctx.psid,
          ctx.lang === "en"
            ? "You used your free credits for today. Come back tomorrow."
            : "Je hebt je gratis credits voor vandaag opgebruikt. Kom morgen terug.",
        );
        await setFlowState(ctx.psid, "AWAITING_STYLE");
        return;
      }

      await setFlowState(ctx.psid, "PROCESSING");
      await sender.sendLoggedText(ctx.psid, t(ctx.lang, "generatingPrompt", { styleLabel: STYLE_LABELS[style] }));

      const state = await getOrCreateState(ctx.psid);

      try {
        const { imageUrl, proof, metrics } = await generator.generate({
          style,
          sourceImageUrl: state.lastPhotoUrl ?? undefined,
          userKey: ctx.userId,
          reqId: ctx.reqId,
        });

        eventLogger.logGenerationSummary(ctx.psid, style, mode, metrics as Record<string, number>);
        eventLogger.logProof({
          style,
          incomingLen: proof.incomingLen,
          incomingSha256: proof.incomingSha256,
          openaiInputLen: proof.openaiInputLen,
          openaiInputSha256: proof.openaiInputSha256,
          outputUrl: imageUrl,
          totalMs: metrics.totalMs,
          ok: true,
          psidHash: anonymizePsid(ctx.psid).slice(0, 12),
        });

        await sender.sendLoggedImage(ctx.psid, imageUrl);
        await increment(ctx.psid);
        await setLastGenerated(ctx.psid, imageUrl);
        await sender.sendStateQuickReplies(ctx.psid, "RESULT_READY", t(ctx.lang, "success"));
        await setFlowState(ctx.psid, "IDLE");
      } catch (error) {
        eventLogger.logGenerationError(ctx.psid, error);

        const errorClass = error instanceof Error ? error.constructor.name : "UnknownError";
        const metrics = getGenerationMetrics(error) ?? { totalMs: 0 };

        eventLogger.logProof({
          style,
          ok: false,
          errorCode: errorClass,
          totalMs: metrics.totalMs,
          psidHash: anonymizePsid(ctx.psid).slice(0, 12),
        });

        let failureText = t(ctx.lang, "generationGenericFailure");
        if (error instanceof MissingInputImageError) {
          await sender.sendLoggedText(ctx.psid, t(ctx.lang, "missingInputImage"));
          await setFlowState(ctx.psid, "AWAITING_PHOTO");
          return;
        }

        if (error instanceof MissingOpenAiApiKeyError || error instanceof MissingAppBaseUrlError) {
          failureText = t(ctx.lang, "generationUnavailable");
        } else if (error instanceof GenerationTimeoutError) {
          failureText = t(ctx.lang, "generationTimeout");
        }

        await sender.sendLoggedText(ctx.psid, t(ctx.lang, "failure"));
        await setFlowState(ctx.psid, "FAILURE");
        await sender.sendLoggedQuickReplies(ctx.psid, failureText, [
          {
            content_type: "text",
            title: t(ctx.lang, "retryThisStyle"),
            payload: `RETRY_STYLE_${style}`,
          },
          {
            content_type: "text",
            title: t(ctx.lang, "otherStyle"),
            payload: "CHOOSE_STYLE",
          },
        ]);
      }
    });

    if (didRun === null) {
      await maybeSendInFlightMessage(ctx);
      return;
    }

    inFlightNoticeSent.delete(ctx.psid);
  }

  async function handleStyleSelection(ctx: MessengerEventContext, selectedStyle: Style): Promise<void> {
    const sender = createMessengerSender(ctx.reqId);
    const state = await getOrCreateState(ctx.psid);
    if (state.stage === "PROCESSING") {
      await maybeSendInFlightMessage(ctx);
      return;
    }

    await setChosenStyle(ctx.psid, selectedStyle);
    if (!state.lastPhotoUrl) {
      await setFlowState(ctx.psid, "AWAITING_PHOTO");
      await sender.sendLoggedText(ctx.psid, t(ctx.lang, "styleWithoutPhoto"));
      return;
    }

    await runStyleGeneration(ctx, selectedStyle);
  }

  async function handlePayload(ctx: MessengerEventContext, payload: string): Promise<void> {
    const sender = createMessengerSender(ctx.reqId);

    if (await maybeSendInFlightMessage(ctx)) {
      return;
    }

    if (payload.startsWith("RETRY_STYLE_")) {
      const retryStyle = normalizeStyle(payload.slice("RETRY_STYLE_".length));
      if (retryStyle) {
        await runStyleGeneration(ctx, retryStyle);
        return;
      }
    }

    const selectedStyle = stylePayloadToStyle(payload);
    if (selectedStyle) {
      await handleStyleSelection(ctx, selectedStyle);
      return;
    }

    if (payload === "CHOOSE_STYLE") {
      await setPreselectedStyle(ctx.psid, null);
      await setFlowState(ctx.psid, "AWAITING_STYLE");
      await sendStylePicker(ctx);
      return;
    }

    if (payload === "RETRY_STYLE") {
      const chosenStyle = (await getOrCreateState(ctx.psid)).selectedStyle;
      const retryStyle = chosenStyle ? parseStyle(chosenStyle) : undefined;

      if (retryStyle) {
        await handleStyleSelection(ctx, retryStyle);
        return;
      }

      await setFlowState(ctx.psid, "AWAITING_STYLE");
      await sendStylePicker(ctx);
      return;
    }

    if (payload === "WHAT_IS_THIS") {
      await sender.sendLoggedText(ctx.psid, t(ctx.lang, "flowExplanation"));
      return;
    }

    if (payload === "PRIVACY_INFO") {
      await sender.sendLoggedText(ctx.psid, t(ctx.lang, "privacy", { link: privacyPolicyUrl }));
      return;
    }

    safeLog("unknown_payload", { user: toLogUser(ctx.userId) });
  }

  async function handleMessage(ctx: MessengerEventContext, event: FacebookWebhookEvent): Promise<void> {
    const sender = createMessengerSender(ctx.reqId);
    const eventLogger = createEventLogger(ctx.reqId);
    const message = event.message;
    if (!message || message.is_echo) return;
    await setLastUserMessageAt(ctx.psid, event.timestamp ?? Date.now());

    if (await maybeSendInFlightMessage(ctx)) {
      return;
    }

    const quickPayload = message.quick_reply?.payload;
    if (quickPayload) {
      await handlePayload(ctx, quickPayload);
      return;
    }

    const imageAttachment = message.attachments?.find(att => att.type === "image" && att.payload?.url);
    if (imageAttachment?.payload?.url) {
      eventLogger.logPhotoReceived(ctx.psid, imageAttachment.payload.url);
      const state = await getOrCreateState(ctx.psid);
      eventLogger.logUserState(ctx.psid, ctx.userId, state, "image_received");
      const preselectedStyle = normalizeStyle(state.preselectedStyle ?? "");
      await setPendingImage(ctx.psid, imageAttachment.payload.url);

      if (preselectedStyle) {
        await setPreselectedStyle(ctx.psid, null);
        await setChosenStyle(ctx.psid, preselectedStyle);
        await runStyleGeneration(ctx, preselectedStyle);
        return;
      }

      await setFlowState(ctx.psid, "AWAITING_STYLE");
      await sendStylePicker(ctx);
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
      const state = await getOrCreateState(ctx.psid);
      eventLogger.logUserState(ctx.psid, ctx.userId, state, "greeting");
      if (!state.hasSeenIntro && state.stage === "IDLE") {
        await sendIntro(ctx);
        await markIntroSeen(ctx.psid);
        return;
      }

      const response = getGreetingResponse(state.stage, ctx.lang);
      if (response.mode === "text") {
        await sender.sendLoggedText(ctx.psid, response.text);
      } else {
        await sender.sendStateQuickReplies(ctx.psid, response.state, response.text);
      }
      return;
    }

    if (normalizedText === "nieuwe stijl" || normalizedText === "new style") {
      const quickState = await getOrCreateState(ctx.psid);
      if (quickState.lastPhotoUrl) {
        await setFlowState(ctx.psid, "AWAITING_STYLE");
        await sendStylePicker(ctx);
        return;
      }
    }

    const state = await getOrCreateState(ctx.psid);
    eventLogger.logUserState(ctx.psid, ctx.userId, state, "text_message");
    if (!state.lastPhotoUrl) {
      await setFlowState(ctx.psid, "AWAITING_PHOTO");
      await sender.sendLoggedText(ctx.psid, t(ctx.lang, "textWithoutPhoto"));
      return;
    }

    await sender.sendLoggedText(ctx.psid, t(ctx.lang, "flowExplanation"));
  }

  async function handleEvent(event: FacebookWebhookEvent, entryId?: string): Promise<void> {
    const psid = event.sender?.id;
    if (!psid) return;

    const userId = toUserKey(psid);
    const reqId = `${psid}-${Date.now()}`;
    const eventLogger = createEventLogger(reqId);
    const localeLang = normalizeLang(event.sender?.locale);
    const state = await getOrCreateState(psid);
    eventLogger.logIncomingMessage(psid, userId, event);
    eventLogger.logUserState(psid, userId, state, "handle_event");
    const lang = state.preferredLang || localeLang || defaultLang;
    const ctx: MessengerEventContext = { psid, userId, reqId, lang };

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

    const referralStyle = parseReferralStyle(event.postback?.referral?.ref ?? event.referral?.ref);
    if (referralStyle) {
      await clearPendingImageState(psid);
      await setPreselectedStyle(psid, referralStyle);
      await setFlowState(psid, "AWAITING_PHOTO");
      await sendReferralPhotoPrompt(ctx, referralStyle);
      return;
    }

    if (event.postback?.payload) {
      await handlePayload(ctx, event.postback.payload);
      return;
    }

    await handleMessage(ctx, event);
  }

  async function processFacebookWebhookPayload(payload: unknown): Promise<void> {
    const entries = Array.isArray((payload as { entry?: unknown[] } | null | undefined)?.entry)
      ? ((payload as { entry: FacebookWebhookEntry[] }).entry ?? [])
      : [];

    for (const entry of entries) {
      const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
      for (const event of events) {
        await handleEvent(event, entry?.id);
      }
    }
  }

  return { processFacebookWebhookPayload };
}
