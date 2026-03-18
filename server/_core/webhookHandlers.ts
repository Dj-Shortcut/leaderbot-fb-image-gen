import {
  sendGenericTemplate,
  sendImage,
  sendQuickReplies,
  sendText,
  safeLog,
} from "./messengerApi";
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
  setLastGenerationContext,
  setLastUserMessageAt,
  setPendingImage,
  setPreselectedStyle,
  setPreferredLang,
  setSelectedStyleCategory,
  markIntroSeen,
  anonymizePsid,
  type ConversationState,
} from "./messengerState";
import { normalizeLang, t, type Lang } from "./i18n";
import { toLogUser, toUserKey } from "./privacy";
import {
  getStylesForCategory,
  type Style,
  type StyleCategory,
} from "./messengerStyles";
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
  STYLE_CATEGORY_LABELS,
  STYLE_LABELS,
  styleCategoryPayloadToCategory,
  stylePayloadToStyle,
  toMessengerReplies,
  toMessengerStyleReplies,
} from "./webhookHelpers";
import { hasInFlightGeneration, runGuardedGeneration } from "./generationGuard";
import { canGenerate, increment } from "./messengerQuota";
import { isDebugLogEnabled } from "./logLevel";
import { getChatRolloutDecision } from "./chatRollout";
import { generateMessengerReply } from "./messengerResponsesService";
import { getBotFeatures } from "./bot/features";
import { ensureDefaultBotFeaturesRegistered } from "./bot/defaultFeatures";
import {
  getTodayRuntimeStats,
  recordActiveUserToday,
  recordGenerationError,
  recordGenerationSuccess,
} from "./botRuntimeStats";
import type {
  BotLogger,
  BotPayloadContext,
  BotTextContext,
  BotImageContext,
} from "./botContext";

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

const IN_FLIGHT_MESSAGE = "\u23F3 even geduld, ik ben nog bezig met jouw restyle";
const inFlightNoticeSent = new Set();

export function createWebhookHandlers({ defaultLang, privacyPolicyUrl }: HandlerDeps) {
  ensureDefaultBotFeaturesRegistered();

  function debugWebhookLog(message: Record<string, unknown>): void {
    if (!isDebugLogEnabled()) {
      return;
    }

    console.log(JSON.stringify(message));
  }

  function getAttachmentHostname(url: string): string | null {
    try {
      return new URL(url).hostname || null;
    } catch {
      return null;
    }
  }

  async function maybeSendInFlightMessage(psid: string, reqId: string) {
    if (!(await hasInFlightGeneration(psid))) {
      inFlightNoticeSent.delete(psid);
      return false;
    }

    if (inFlightNoticeSent.has(psid)) {
      return true;
    }

    inFlightNoticeSent.add(psid);
    await sendLoggedText(psid, IN_FLIGHT_MESSAGE, reqId);
    return true;
  }

  function logIncomingMessage(
    psid: string,
    userId: string,
    event: FacebookWebhookEvent,
    reqId: string
  ): void {
    debugWebhookLog({
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
      });
  }

  function logUserState(
    psid: string,
    userId: string,
    state: Awaited<ReturnType<typeof getOrCreateState>>,
    reqId: string,
    context: string
  ): void {
    debugWebhookLog({
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
      });
  }

  async function sendLoggedText(psid: string, text: string, reqId: string): Promise<void> {
    debugWebhookLog({
        level: "debug",
        msg: "outgoing_message",
        kind: "text",
        reqId,
        psidHash: anonymizePsid(psid).slice(0, 12),
        text,
      });
    await sendText(psid, text);
  }

  async function sendLoggedQuickReplies(
    psid: string,
    text: string,
    replies: Parameters<typeof sendQuickReplies>[2],
    reqId: string
  ): Promise<void> {
    debugWebhookLog({
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
      });
    await sendQuickReplies(psid, text, replies);
  }

  async function sendLoggedImage(psid: string, imageUrl: string, reqId: string): Promise<void> {
    debugWebhookLog({
        level: "debug",
        msg: "outgoing_message",
        kind: "image",
        reqId,
        psidHash: anonymizePsid(psid).slice(0, 12),
        imageUrl,
      });
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

  async function sendLoggedGenericTemplate(
    psid: string,
    elements: Parameters<typeof sendGenericTemplate>[1],
    reqId: string
  ): Promise<void> {
    debugWebhookLog({
      level: "debug",
      msg: "outgoing_message",
      kind: "generic_template",
      reqId,
      psidHash: anonymizePsid(psid).slice(0, 12),
      elements: elements.map(element => ({
        title: element.title,
        subtitle: element.subtitle,
        buttons: element.buttons?.map(button => ({
          title: button.title,
          payload: button.payload,
        })),
      })),
    });
    await sendGenericTemplate(psid, elements);
  }

  function createFeatureLogger(userId: string): BotLogger {
    return {
      info(event, details = {}) {
        safeLog(event, { user: toLogUser(userId), ...details });
      },
      warn(event, details = {}) {
        safeLog(event, { level: "warn", user: toLogUser(userId), ...details });
      },
      error(event, details = {}) {
        safeLog(event, { level: "error", user: toLogUser(userId), ...details });
      },
    };
  }

  function createFeaturePayloadContext(
    psid: string,
    userId: string,
    reqId: string,
    lang: Lang,
    state: Awaited<ReturnType<typeof getOrCreateState>>,
    payload: string
  ): BotPayloadContext {
    return {
      senderId: psid,
      userId,
      reqId,
      lang,
      state,
      payload,
      sendText: text => sendLoggedText(psid, text, reqId),
      sendImage: imageUrl => sendLoggedImage(psid, imageUrl, reqId),
      sendQuickReplies: (text, replies) =>
        sendLoggedQuickReplies(psid, text, replies, reqId),
      sendStateQuickReplies: (nextState, text) =>
        sendStateQuickReplies(psid, nextState, text, reqId),
      setFlowState: async nextState => {
        await setFlowState(psid, nextState);
      },
      preselectStyle: async style => {
        await setPreselectedStyle(psid, style);
      },
      chooseStyle: style => handleStyleSelection(psid, userId, style, reqId, lang),
      runStyleGeneration: (style, sourceImageUrl, promptHint) =>
        runStyleGeneration(psid, userId, style, reqId, lang, sourceImageUrl, promptHint),
      getRuntimeStats: () => getTodayRuntimeStats(),
      logger: createFeatureLogger(userId),
    };
  }

  function createFeatureImageContext(
    psid: string,
    userId: string,
    reqId: string,
    lang: Lang,
    state: Awaited<ReturnType<typeof getOrCreateState>>,
    imageUrl: string
  ): BotImageContext {
    return {
      senderId: psid,
      userId,
      reqId,
      lang,
      state,
      imageUrl,
      sendText: text => sendLoggedText(psid, text, reqId),
      sendImage: nextImageUrl => sendLoggedImage(psid, nextImageUrl, reqId),
      sendQuickReplies: (text, replies) =>
        sendLoggedQuickReplies(psid, text, replies, reqId),
      sendStateQuickReplies: (nextState, text) =>
        sendStateQuickReplies(psid, nextState, text, reqId),
      setFlowState: async nextState => {
        await setFlowState(psid, nextState);
      },
      preselectStyle: async style => {
        await setPreselectedStyle(psid, style);
      },
      chooseStyle: style => handleStyleSelection(psid, userId, style, reqId, lang),
      runStyleGeneration: (style, sourceImageUrl, promptHint) =>
        runStyleGeneration(psid, userId, style, reqId, lang, sourceImageUrl, promptHint),
      getRuntimeStats: () => getTodayRuntimeStats(),
      logger: createFeatureLogger(userId),
    };
  }

  function createFeatureTextContext(
    psid: string,
    userId: string,
    reqId: string,
    lang: Lang,
    state: Awaited<ReturnType<typeof getOrCreateState>>,
    messageText: string,
    normalizedText: string,
    hasPhoto: boolean
  ): BotTextContext {
    return {
      senderId: psid,
      userId,
      reqId,
      lang,
      state,
      messageText,
      normalizedText,
      hasPhoto,
      sendText: text => sendLoggedText(psid, text, reqId),
      sendImage: imageUrl => sendLoggedImage(psid, imageUrl, reqId),
      sendQuickReplies: (text, replies) =>
        sendLoggedQuickReplies(psid, text, replies, reqId),
      sendStateQuickReplies: (nextState, text) =>
        sendStateQuickReplies(psid, nextState, text, reqId),
      setFlowState: async nextState => {
        await setFlowState(psid, nextState);
      },
      preselectStyle: async style => {
        await setPreselectedStyle(psid, style);
      },
      chooseStyle: style => handleStyleSelection(psid, userId, style, reqId, lang),
      runStyleGeneration: (style, sourceImageUrl, promptHint) =>
        runStyleGeneration(psid, userId, style, reqId, lang, sourceImageUrl, promptHint),
      getRuntimeStats: () => getTodayRuntimeStats(),
      logger: createFeatureLogger(userId),
    };
  }

  async function sendStylePicker(psid: string, lang: Lang, reqId: string): Promise<void> {
    await sendStateQuickReplies(
      psid,
      "AWAITING_STYLE",
      t(lang, "styleCategoryPicker"),
      reqId
    );
  }

  async function sendStyleOptionsForCategory(
    psid: string,
    category: StyleCategory,
    lang: Lang,
    reqId: string
  ): Promise<void> {
    const styles = getStylesForCategory(category);
    const categoryLabel = STYLE_CATEGORY_LABELS[category];

    try {
      await sendLoggedGenericTemplate(
        psid,
        styles.map(style => ({
          title: STYLE_LABELS[style.style],
          subtitle:
            lang === "en"
              ? `${categoryLabel} style`
              : `${categoryLabel}-stijl`,
          buttons: [
            {
              type: "postback",
              title: lang === "en" ? "Choose" : "Kies",
              payload: style.payload,
            },
          ],
        })),
        reqId
      );
    } catch (error) {
      safeLog("style_category_carousel_failed", {
        user: toLogUser(psid),
        category,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }

    await sendLoggedQuickReplies(
      psid,
      t(lang, "styleCategoryCarouselIntro", {
        styleLabel: categoryLabel.toLowerCase(),
      }),
      toMessengerStyleReplies(category, lang),
      reqId
    );
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
    lang: Lang,
    sourceImageUrl?: string,
    promptHint?: string
  ): Promise<void> {
    const didRun = await runGuardedGeneration(psid, async () => {
      const { mode, generator } = createImageGenerator();
      const allowed = await canGenerate(psid);
      const quotaState = await getOrCreateState(psid);
      const bypassRaw = process.env.MESSENGER_QUOTA_BYPASS_IDS ?? "";
      const bypassApplied = bypassRaw.includes(psid) || bypassRaw.includes(quotaState.userKey);
      console.log(JSON.stringify({ level: "info", msg: "quota_decision", action: "check", psidHash: anonymizePsid(psid).slice(0, 12), count: quotaState.quota.count, limit: 2, bypassApplied, allowed }));
      if (!allowed) {
        await sendLoggedText(psid, lang === "en" ? "You used your free credits for today. Come back tomorrow." : "Je hebt je gratis credits voor vandaag opgebruikt. Kom morgen terug.", reqId);
        await setFlowState(psid, "AWAITING_STYLE");
        return;
      }

      await setFlowState(psid, "PROCESSING");
      await sendLoggedText(
        psid,
        t(lang, "generatingPrompt", { styleLabel: STYLE_LABELS[style] }),
        reqId
      );

      const state = await getOrCreateState(psid);
      const lastImageUrl = sourceImageUrl ?? state.lastPhotoUrl;

      try {
        const { imageUrl, proof, metrics } = await generator.generate({
          style,
          sourceImageUrl: lastImageUrl ?? undefined,
          promptHint,
          userKey: userId,
          reqId,
        });

        console.info(
          JSON.stringify({
            level: "info",
            msg: "generation_summary",
            reqId,
            psidHash: anonymizePsid(psid).slice(0, 12),
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
        await increment(psid);
        await setLastGenerated(psid, imageUrl);
        await setLastGenerationContext(psid, { style, prompt: promptHint });
        recordGenerationSuccess(style, metrics.totalMs);
        await sendStateQuickReplies(psid, "RESULT_READY", t(lang, "success"), reqId);
        await setFlowState(psid, "IDLE");
      } catch (error) {
        console.error("OPENAI_CALL_ERROR", {
          psidHash: anonymizePsid(psid).slice(0, 12),
          error: error instanceof Error ? error.message : undefined,
        });

        const errorClass =
          error instanceof Error ? error.constructor.name : "UnknownError";
        const metrics = getGenerationMetrics(error) ?? { totalMs: 0 };

        console.log(
          "PROOF_SUMMARY",
          JSON.stringify({
            reqId,
            psidHash: anonymizePsid(psid).slice(0, 12),
            style,
            ok: false,
            errorCode: errorClass,
            totalMs: metrics.totalMs,
          })
        );
        recordGenerationError();

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
      await maybeSendInFlightMessage(psid, reqId);
      return;
    }
    inFlightNoticeSent.delete(psid);
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
      await maybeSendInFlightMessage(psid, reqId);
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
    if (await maybeSendInFlightMessage(psid, reqId)) {
      return;
    }

    const state = await getOrCreateState(psid);
    for (const feature of getBotFeatures()) {
      const result = await feature.onPayload?.(
        createFeaturePayloadContext(psid, userId, reqId, lang, state, payload)
      );
      if (result?.handled) {
        return;
      }
    }

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

    const selectedCategory = styleCategoryPayloadToCategory(payload);
    if (selectedCategory) {
      await setSelectedStyleCategory(psid, selectedCategory);
      await setFlowState(psid, "AWAITING_STYLE");
      await sendStyleOptionsForCategory(psid, selectedCategory, lang, reqId);
      return;
    }

    if (payload === "CHOOSE_STYLE") {
      await setPreselectedStyle(psid, null);
      await setSelectedStyleCategory(psid, null);
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

    if (await maybeSendInFlightMessage(psid, reqId)) {
      return;
    }

    const quickPayload = message.quick_reply?.payload;
    if (quickPayload) {
      await handlePayload(psid, userId, quickPayload, reqId, lang);
      return;
    }

    const imageAttachment = message.attachments?.find(
      att => att.type === "image" && att.payload?.url
    );
    if (imageAttachment?.payload?.url) {
      debugWebhookLog({
          level: "debug",
          msg: "photo_received",
          reqId,
          psidHash: anonymizePsid(psid).slice(0, 12),
          hasAttachments: !!message.attachments,
          attachmentHostname: getAttachmentHostname(imageAttachment.payload.url),
        });

      const state = await getOrCreateState(psid);
      for (const feature of getBotFeatures()) {
        const result = await feature.onImage?.(
          createFeatureImageContext(
            psid,
            userId,
            reqId,
            lang,
            state,
            imageAttachment.payload.url
          )
        );
        if (result?.handled) {
          return;
        }
      }
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

    if (normalizedText === "nieuwe stijl" || normalizedText === "new style") {
      const quickState = await getOrCreateState(psid);
      if (quickState.lastPhotoUrl) {
        await setFlowState(psid, "AWAITING_STYLE");
        await sendStylePicker(psid, lang, reqId);
        return;
      }
    }

    const state = await getOrCreateState(psid);
    const hasPhoto = Boolean(state.lastPhotoUrl);
    for (const feature of getBotFeatures()) {
      const result = await feature.onText?.(
        createFeatureTextContext(
          psid,
          userId,
          reqId,
          lang,
          state,
          trimmedText,
          normalizedText,
          hasPhoto
        )
      );
      if (result?.handled) {
        return;
      }
    }
    logUserState(psid, userId, state, reqId, "text_message");
    if (!hasPhoto) {
      await setFlowState(psid, "AWAITING_PHOTO");
    }

    const rolloutDecision = getChatRolloutDecision(userId);
    safeLog("messenger_chat_engine_decision", {
      user: toLogUser(userId),
      engine: rolloutDecision.engine,
      canaryPercent: rolloutDecision.canaryPercent,
      bucket: rolloutDecision.bucket,
      selected: rolloutDecision.useResponses ? "responses" : "legacy",
    });

    if (rolloutDecision.useResponses) {
      try {
        const reply = await generateMessengerReply({
          psid,
          userKey: userId,
          lang,
          stage: state.stage,
          text: trimmedText,
          hasPhoto,
        });

        safeLog("messenger_chat_engine_result", {
          user: toLogUser(userId),
          source: reply.source,
        });
        await sendLoggedText(psid, reply.text, reqId);
      } catch (error) {
        safeLog("messenger_chat_engine_result", {
          user: toLogUser(userId),
          source: "fallback",
          errorCode: error instanceof Error ? error.name : "unknown_error",
        });
        await sendLoggedText(
          psid,
          hasPhoto ? t(lang, "flowExplanation") : t(lang, "textWithoutPhoto"),
          reqId
        );
      }
      return;
    }

    await sendLoggedText(
      psid,
      hasPhoto ? t(lang, "flowExplanation") : t(lang, "textWithoutPhoto"),
      reqId
    );
  }

  async function handleEvent(event: FacebookWebhookEvent, entryId?: string): Promise<void> {
    const psid = event.sender?.id;
    if (!psid) return;

    const userId = toUserKey(psid);
    recordActiveUserToday(userId);
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
