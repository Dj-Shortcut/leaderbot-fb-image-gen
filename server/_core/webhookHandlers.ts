import {
  sendButtonTemplate,
  sendGenericTemplate,
  sendImage,
  sendQuickReplies,
  sendText,
  safeLog,
} from "./messengerApi";
import {
  getGenerationMetrics,
} from "./imageService";
import { executeGenerationFlow } from "./generationFlow";
import {
  clearPendingImageState,
  declineFaceMemory,
  getOrCreateState,
  rememberFaceSourceImage,
  setFaceMemoryConsentGiven,
  setChosenStyle,
  setFlowState,
  setLastGenerated,
  setLastGenerationContext,
  setLastEntryIntent,
  setLastUserMessageAt,
  setPendingStoredImage,
  setPreselectedStyle,
  setPreferredLang,
  setSelectedStyleCategory,
  setActiveExperience,
  markIntroSeen,
  anonymizePsid,
  type ConversationState,
} from "./messengerState";
import {
  FACE_MEMORY_CONSENT_NO,
  FACE_MEMORY_CONSENT_YES,
  deleteFaceMemoryForUser,
  isFaceMemoryEnabled,
  updateConsentedFaceMemorySource,
} from "./faceMemory";
import { normalizeLang, t, type Lang } from "./i18n";
import { toLogUser, toUserKey } from "./privacy";
import {
  getStoredMessengerImageDecision,
  normalizeMessengerInboundImage,
} from "./messengerImageIngress";
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
  parseReferralStyle,
  STYLE_CATEGORY_LABELS,
  STYLE_LABELS,
  toMessengerReplies,
  toMessengerStyleReplies,
} from "./webhookHelpers";
import { hasInFlightGeneration, runGuardedGeneration } from "./generationGuard";
import { canGenerate, increment } from "./messengerQuota";
import { isDebugLogEnabled } from "./logLevel";
import { getBotFeatures } from "./bot/features";
import { ensureDefaultBotFeaturesRegistered } from "./bot/defaultFeatures";
import { handleSharedTextMessage } from "./sharedTextHandler";
import type { NormalizedInboundMessage } from "./normalizedInboundMessage";
import { sendMessengerBotResponse } from "./botResponseAdapters";
import {
  parseMessengerEntryIntent,
  routeMessengerActiveExperience,
  routeMessengerEntryIntent,
} from "./messengerExperienceRouting";
import { handleMessengerPayload } from "./messengerPayloadRouting";
import type { EntryIntent } from "./entryIntent";
import type { ActiveExperience } from "./activeExperience";
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

type FacebookWebhookMessage = NonNullable<FacebookWebhookEvent["message"]>;
type FeatureContextBase = Omit<
  BotPayloadContext,
  "payload"
>;
type MessengerState = Awaited<ReturnType<typeof getOrCreateState>>;

type HandlerContext = {
  defaultLang: Lang;
  claimEventReplayOrLog: (
    event: FacebookWebhookEvent,
    entryId: string | undefined,
    userId: string
  ) => Promise<boolean>;
  handlePayload: (
    psid: string,
    userId: string,
    payload: string,
    reqId: string,
    lang: Lang
  ) => Promise<void>;
  handleReferralStyleEvent: (
    psid: string,
    referralRef: string | undefined,
    lang: Lang,
    reqId: string
  ) => Promise<boolean>;
  handleTextMessage: (input: {
    psid: string;
    userId: string;
    reqId: string;
    lang: Lang;
    text: string;
    timestamp: number;
  }) => Promise<void>;
  logIncomingMessage: (
    psid: string,
    userId: string,
    event: FacebookWebhookEvent,
    reqId: string
  ) => void;
  logUserState: (
    psid: string,
    userId: string,
    state: MessengerState,
    reqId: string,
    context: string
  ) => void;
  maybeSendInFlightMessage: (psid: string, reqId: string) => Promise<boolean>;
  sendLoggedImage: (
    psid: string,
    imageUrl: string,
    reqId: string
  ) => Promise<void>;
  sendLoggedQuickReplies: (
    psid: string,
    text: string,
    quickReplies: Array<{
      content_type: "text";
      title: string;
      payload: string;
    }>,
    reqId: string
  ) => Promise<void>;
  sendLoggedText: (
    psid: string,
    text: string,
    reqId: string
  ) => Promise<void>;
  sendStateQuickReplies: (
    psid: string,
    stateName: ConversationState,
    text: string,
    reqId: string
  ) => Promise<void>;
  tryHandleImageMessage: (input: {
    psid: string;
    userId: string;
    reqId: string;
    lang: Lang;
    attachments: FacebookWebhookMessage["attachments"];
  }) => Promise<boolean>;
};

type MessageEventInput = {
  psid: string;
  userId: string;
  event: FacebookWebhookEvent;
  reqId: string;
  lang: Lang;
};

type PostbackEventInput = {
  psid: string;
  userId: string;
  event: FacebookWebhookEvent;
  reqId: string;
  lang: Lang;
};

const IN_FLIGHT_MESSAGE =
  "\u23F3 even geduld, ik ben nog bezig met jouw restyle";
const inFlightNoticeSent = new Set();
const MESSENGER_CAPABILITIES = Object.freeze({
  quickReplies: true,
  richTemplates: true,
});

async function handleEntry(
  ctx: HandlerContext,
  entry: FacebookWebhookEntry
): Promise<void> {
  const events = Array.isArray(entry?.messaging) ? entry.messaging : [];
  for (const event of events) {
    await handleEvent(ctx, event, entry?.id);
  }
}

async function handleEvent(
  ctx: HandlerContext,
  event: FacebookWebhookEvent,
  entryId?: string
): Promise<void> {
  const psid = event.sender?.id;
  if (!psid) return;

  const userId = toUserKey(psid);
  const reqId = `${psid}-${Date.now()}`;

  if (!(await ctx.claimEventReplayOrLog(event, entryId, userId))) {
    return;
  }

  recordActiveUserToday(userId);
  const senderLocale = event.sender?.locale?.trim();
  const localeLang = senderLocale
    ? normalizeLang(senderLocale)
    : ctx.defaultLang;
  const state = await getOrCreateState(psid);
  ctx.logIncomingMessage(psid, userId, event, reqId);
  ctx.logUserState(psid, userId, state, reqId, "handle_event");
  const lang = state.preferredLang || localeLang || ctx.defaultLang;

  if (senderLocale && localeLang !== state.preferredLang) {
    await setPreferredLang(psid, localeLang);
  }

  const routeDeps = {
    psid,
    userId,
    reqId,
    sendText: (text: string) => ctx.sendLoggedText(psid, text, reqId),
    sendStateText: (stateName: ConversationState, text: string) =>
      ctx.sendStateQuickReplies(psid, stateName, text, reqId),
    sendOptionsPrompt: async (
      prompt: string,
      options: Array<{ id: string; title: string }>,
      _fallbackLogName: string | undefined,
      _fallbackText: string | undefined
    ) => {
      await ctx.sendLoggedQuickReplies(
        psid,
        prompt,
        options.map(option => ({
          content_type: "text",
          title: option.title,
          payload: option.id,
        })),
        reqId
      );
    },
    sendImage: (imageUrl: string) => ctx.sendLoggedImage(psid, imageUrl, reqId),
    safeLog,
    setLastEntryIntent: (nextEntryIntent: EntryIntent | null) =>
      Promise.resolve(setLastEntryIntent(psid, nextEntryIntent)),
    setActiveExperience: (nextActiveExperience: ActiveExperience | null) =>
      Promise.resolve(setActiveExperience(psid, nextActiveExperience)),
  };
  const { referralRef, entryIntent } = parseMessengerEntryIntent({
    event,
    reqId,
    userId,
    localeLang,
    safeLog,
  });
  if (
    await routeMessengerEntryIntent({
      deps: routeDeps,
      state,
      entryIntent,
    })
  ) {
    return;
  }

  if (
    await routeMessengerActiveExperience({
      deps: routeDeps,
      state,
      event,
    })
  ) {
    return;
  }

  if (await ctx.handleReferralStyleEvent(psid, referralRef, lang, reqId)) {
    return;
  }

  if (
    await handlePostbackEvent(ctx, {
      psid,
      userId,
      event,
      reqId,
      lang,
    })
  ) {
    return;
  }

  await handleMessageEvent(ctx, { psid, userId, event, reqId, lang });
}

async function handleMessageEvent(
  ctx: HandlerContext,
  input: MessageEventInput
): Promise<void> {
  const message = input.event.message;
  if (!message || message.is_echo) return;
  await setLastUserMessageAt(input.psid, input.event.timestamp ?? Date.now());

  if (await ctx.maybeSendInFlightMessage(input.psid, input.reqId)) {
    return;
  }

  const quickPayload = message.quick_reply?.payload;
  if (quickPayload) {
    await ctx.handlePayload(
      input.psid,
      input.userId,
      quickPayload,
      input.reqId,
      input.lang
    );
    return;
  }

  if (
    await ctx.tryHandleImageMessage({
      psid: input.psid,
      userId: input.userId,
      reqId: input.reqId,
      lang: input.lang,
      attachments: message.attachments,
    })
  ) {
    return;
  }

  const text = message.text;
  const trimmedText = text?.trim();
  if (!trimmedText) {
    return;
  }

  const normalizedDeleteText = trimmedText.toLocaleLowerCase("nl-BE");
  if (
    normalizedDeleteText === "verwijder mijn data" ||
    normalizedDeleteText === "delete my data"
  ) {
    await deleteFaceMemoryForUser(input.psid);
    await ctx.sendLoggedText(
      input.psid,
      input.lang === "en"
        ? "Your retained photo and face-memory data have been deleted."
        : "Je bewaarde foto en face-memory data zijn gewist.",
      input.reqId
    );
    return;
  }

  await ctx.handleTextMessage({
    psid: input.psid,
    userId: input.userId,
    reqId: input.reqId,
    lang: input.lang,
    text: trimmedText,
    timestamp: input.event.timestamp ?? Date.now(),
  });
}

async function handlePostbackEvent(
  ctx: HandlerContext,
  input: PostbackEventInput
): Promise<boolean> {
  if (input.event.postback?.payload) {
    await ctx.handlePayload(
      input.psid,
      input.userId,
      input.event.postback.payload,
      input.reqId,
      input.lang
    );
    return true;
  }

  return false;
}

export function createWebhookHandlers({
  defaultLang,
  privacyPolicyUrl,
}: HandlerDeps) {
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

  async function sendLoggedText(
    psid: string,
    text: string,
    reqId: string
  ): Promise<void> {
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

  async function sendLoggedImage(
    psid: string,
    imageUrl: string,
    reqId: string
  ): Promise<void> {
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

  function resolvePrivacyPolicyUrl(): string | undefined {
    const trimmed = privacyPolicyUrl.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    const appBaseUrl = resolveAppBaseUrl();
    if (appBaseUrl) {
      return `${appBaseUrl}/privacy`;
    }

    return undefined;
  }

  function resolveAppBaseUrl(): string | undefined {
    const appBaseUrl =
      process.env.APP_BASE_URL?.trim() ?? process.env.BASE_URL?.trim();
    if (appBaseUrl && /^https?:\/\//i.test(appBaseUrl)) {
      return appBaseUrl.replace(/\/$/, "");
    }

    return undefined;
  }

  function resolveStylePreviewUrl(style: Style): string | undefined {
    const appBaseUrl = resolveAppBaseUrl();
    if (!appBaseUrl) {
      return undefined;
    }

    return `${appBaseUrl}/style-previews/${style}.png`;
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
        imageUrl: element.image_url,
        buttons: element.buttons?.map(button => {
          if (button.type === "web_url") {
            return {
              type: button.type,
              title: button.title,
            };
          }

          return {
            type: button.type,
            title: button.title,
            payload: button.payload,
          };
        }),
      })),
    });
    await sendGenericTemplate(psid, elements);
  }

  async function sendLoggedButtonTemplate(
    psid: string,
    text: string,
    buttons: Parameters<typeof sendButtonTemplate>[2],
    reqId: string
  ): Promise<void> {
    debugWebhookLog({
      level: "debug",
      msg: "outgoing_message",
      kind: "button_template",
      reqId,
      psidHash: anonymizePsid(psid).slice(0, 12),
      text,
      buttons: buttons.map(button => {
        if (button.type === "web_url") {
          return { type: button.type, title: button.title };
        }

        return {
          type: button.type,
          title: button.title,
          payload: button.payload,
        };
      }),
    });
    await sendButtonTemplate(psid, text, buttons);
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

  function createFeatureContextBase(
    psid: string,
    userId: string,
    reqId: string,
    lang: Lang,
    state: Awaited<ReturnType<typeof getOrCreateState>>
  ): FeatureContextBase {
    return {
      channel: "messenger",
      capabilities: MESSENGER_CAPABILITIES,
      senderId: psid,
      userId,
      reqId,
      lang,
      state,
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
      chooseStyle: style =>
        handleStyleSelection(psid, userId, style, reqId, lang),
      runStyleGeneration: (style, sourceImageUrl, promptHint) =>
        runStyleGeneration(
          psid,
          userId,
          style,
          reqId,
          lang,
          sourceImageUrl,
          promptHint
        ),
      getRuntimeStats: () => getTodayRuntimeStats(),
      logger: createFeatureLogger(userId),
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
      ...createFeatureContextBase(psid, userId, reqId, lang, state),
      payload,
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
      ...createFeatureContextBase(psid, userId, reqId, lang, state),
      imageUrl,
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
      ...createFeatureContextBase(psid, userId, reqId, lang, state),
      messageText,
      normalizedText,
      hasPhoto,
    };
  }

  function logImageFlowDecision(input: {
    psid: string;
    userId: string;
    reqId: string;
    stage: string;
    hadPreviousPhoto: boolean;
    incomingImageUrl: string;
    selectedStyle: string | null;
    preselectedStyle: string | null;
    action: "show_style_picker" | "auto_run_preselected_style";
  }): void {
    safeLog("messenger_image_flow_decision", {
      reqId: input.reqId,
      user: toLogUser(input.userId),
      psidHash: anonymizePsid(input.psid).slice(0, 12),
      stage: input.stage,
      hadPreviousPhoto: input.hadPreviousPhoto,
      incomingImageHost: getAttachmentHostname(input.incomingImageUrl),
      selectedStyle: input.selectedStyle,
      preselectedStyle: input.preselectedStyle,
      action: input.action,
    });
  }

  async function sendStylePicker(
    psid: string,
    lang: Lang,
    reqId: string
  ): Promise<void> {
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
    const introText = t(lang, "styleCategoryCarouselIntro", {
      styleLabel: categoryLabel.toLowerCase(),
    });

    try {
      await sendLoggedText(psid, introText, reqId);
      await sendLoggedGenericTemplate(
        psid,
        styles.map(style => ({
          title: STYLE_LABELS[style.style],
          subtitle:
            lang === "en" ? `${categoryLabel} style` : `${categoryLabel}-stijl`,
          image_url: resolveStylePreviewUrl(style.style),
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
      return;
    } catch (error) {
      safeLog("style_category_carousel_failed", {
        user: toLogUser(psid),
        category,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }

    await sendLoggedQuickReplies(
      psid,
      introText,
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

  async function sendFaceMemoryConsentPrompt(
    psid: string,
    lang: Lang,
    reqId: string
  ): Promise<void> {
    await sendLoggedQuickReplies(
      psid,
      lang === "en"
        ? "May I keep your photo for 30 days? Then you do not have to upload it again every time. You can delete it any time with \"delete my data\"."
        : "Mag ik je foto 30 dagen bewaren? Dan hoef je niet steeds opnieuw te uploaden. Je kan dit altijd wissen met \"verwijder mijn data\".",
      [
        {
          content_type: "text",
          title: lang === "en" ? "Yes, 30 days" : "Ja, 30 dagen",
          payload: FACE_MEMORY_CONSENT_YES,
        },
        {
          content_type: "text",
          title: lang === "en" ? "No" : "Nee",
          payload: FACE_MEMORY_CONSENT_NO,
        },
      ],
      reqId
    );
  }

  async function sendIntro(
    psid: string,
    lang: Lang,
    reqId: string
  ): Promise<void> {
    await sendStateQuickReplies(
      psid,
      "IDLE",
      t(lang, "flowExplanation"),
      reqId
    );
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
      const allowed = await canGenerate(psid);
      const quotaState = await getOrCreateState(psid);
      const bypassRaw = process.env.MESSENGER_QUOTA_BYPASS_IDS ?? "";
      const bypassApplied =
        bypassRaw.includes(psid) || bypassRaw.includes(quotaState.userKey);
      console.log(
        JSON.stringify({
          level: "info",
          msg: "quota_decision",
          action: "check",
          psidHash: anonymizePsid(psid).slice(0, 12),
          count: quotaState.quota.count,
          limit: 3,
          bypassApplied,
          allowed,
        })
      );
      if (!allowed) {
        await sendLoggedText(
          psid,
          lang === "en"
            ? "You used your free credits for today. Come back tomorrow."
            : "Je hebt je gratis credits voor vandaag opgebruikt. Kom morgen terug.",
          reqId
        );
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
      const generationResult = await executeGenerationFlow({
        style,
        userId,
        reqId,
        promptHint,
        sourceImageUrl,
        lastPhotoUrl: state.lastPhotoUrl,
        lastPhotoSource: state.lastPhotoSource,
      });

      if (generationResult.kind === "success") {
        const { imageUrl, metrics, mode, proof } = generationResult;
        console.info(
          JSON.stringify({
            level: "info",
            msg: "messenger_send_image_url",
            reqId,
            psidHash: anonymizePsid(psid).slice(0, 12),
            style,
            imageUrl,
          })
        );

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
        await sendStateQuickReplies(
          psid,
          "RESULT_READY",
          t(lang, "success"),
          reqId
        );
        await setFlowState(psid, "IDLE");
        return;
      }

      const error = generationResult.error;
      console.error("OPENAI_CALL_ERROR", {
        psidHash: anonymizePsid(psid).slice(0, 12),
        error: error instanceof Error ? error.message : undefined,
      });

      const errorClass =
        error instanceof Error ? error.constructor.name : "UnknownError";
      const metrics =
        generationResult.metrics ?? getGenerationMetrics(error) ?? { totalMs: 0 };

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
      if (generationResult.errorKind === "missing_source_image") {
        await sendLoggedText(psid, t(lang, "styleWithoutPhoto"), reqId);
        await setFlowState(psid, "AWAITING_PHOTO");
        return;
      } else if (
        generationResult.errorKind === "missing_input_image" ||
        generationResult.errorKind === "invalid_source_image"
      ) {
        await sendLoggedText(psid, t(lang, "missingInputImage"), reqId);
        await setFlowState(psid, "AWAITING_PHOTO");
        return;
      } else if (generationResult.errorKind === "generation_unavailable") {
        failureText = t(lang, "generationUnavailable");
      } else if (generationResult.errorKind === "generation_timeout") {
        failureText = t(lang, "generationTimeout");
      } else if (generationResult.errorKind === "generation_budget_reached") {
        await sendLoggedText(psid, t(lang, "generationBudgetReached"), reqId);
        await setFlowState(psid, "AWAITING_STYLE");
        return;
      }

      await sendLoggedText(psid, t(lang, "failure"), reqId);
      await setFlowState(psid, "FAILURE");

      await sendLoggedQuickReplies(
        psid,
        failureText,
        [
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
        ],
        reqId
      );
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

  async function sendPrivacyInfo(
    psid: string,
    lang: Lang,
    reqId: string
  ): Promise<void> {
    const resolvedPrivacyUrl = resolvePrivacyPolicyUrl();
    const privacyText = t(lang, "privacy", { link: resolvedPrivacyUrl });

    if (!resolvedPrivacyUrl) {
      await sendLoggedText(psid, privacyText, reqId);
      return;
    }

    await sendLoggedButtonTemplate(
      psid,
      privacyText,
      [
        {
          type: "web_url",
          title: t(lang, "privacyButtonLabel"),
          url: resolvedPrivacyUrl,
        },
      ],
      reqId
    );
  }

  async function handlePayload(
    psid: string,
    userId: string,
    payload: string,
    reqId: string,
    lang: Lang
  ): Promise<void> {
    if (
      (payload === FACE_MEMORY_CONSENT_YES ||
        payload === FACE_MEMORY_CONSENT_NO) &&
      !isFaceMemoryEnabled()
    ) {
      await sendPhotoReceivedPrompt(psid, lang, reqId);
      return;
    }

    if (payload === FACE_MEMORY_CONSENT_YES) {
      const state = await getOrCreateState(psid);
      const sourceImageUrl = state.pendingImageUrl ?? state.lastPhotoUrl;
      if (sourceImageUrl) {
        await rememberFaceSourceImage(psid, sourceImageUrl);
      } else {
        await setFaceMemoryConsentGiven(psid);
      }
      await sendPhotoReceivedPrompt(psid, lang, reqId);
      return;
    }

    if (payload === FACE_MEMORY_CONSENT_NO) {
      await declineFaceMemory(psid);
      await sendPhotoReceivedPrompt(psid, lang, reqId);
      return;
    }

    await handleMessengerPayload({
      psid,
      userId,
      payload,
      reqId,
      lang,
      maybeSendInFlightMessage,
      getState: userPsid => Promise.resolve(getOrCreateState(userPsid)),
      getFeatures: getBotFeatures,
      createFeaturePayloadContext,
      runStyleGeneration,
      handleStyleSelection,
      showStylePicker: async (userPsid, userLang, requestId) => {
        await setPreselectedStyle(userPsid, null);
        await setSelectedStyleCategory(userPsid, null);
        await setFlowState(userPsid, "AWAITING_STYLE");
        await sendStylePicker(userPsid, userLang, requestId);
      },
      showStyleCategory: async (userPsid, category, userLang, requestId) => {
        await setSelectedStyleCategory(userPsid, category);
        await setFlowState(userPsid, "AWAITING_STYLE");
        await sendStyleOptionsForCategory(
          userPsid,
          category,
          userLang,
          requestId
        );
      },
      sendFlowExplanation: (userPsid, userLang, requestId) =>
        sendLoggedText(userPsid, t(userLang, "flowExplanation"), requestId),
      sendPrivacyInfo,
      sendUnknownPayloadLog: unknownUserId => {
        safeLog("unknown_payload", { user: toLogUser(unknownUserId) });
      },
    });
  }

  async function tryHandleImageMessage(input: {
    psid: string;
    userId: string;
    reqId: string;
    lang: Lang;
    attachments: FacebookWebhookMessage["attachments"];
  }): Promise<boolean> {
    const imageAttachment = input.attachments?.find(
      att => att.type === "image" && att.payload?.url
    );
    if (!imageAttachment?.payload?.url) {
      return false;
    }

    const inboundImageUrl = imageAttachment.payload.url;
    debugWebhookLog({
      level: "debug",
      msg: "photo_received",
      reqId: input.reqId,
      psidHash: anonymizePsid(input.psid).slice(0, 12),
      hasAttachments: !!input.attachments,
      attachmentHostname: getAttachmentHostname(inboundImageUrl),
    });

    const storedSourceImageUrl = await normalizeMessengerInboundImage({
      inboundImageUrl,
      psidHash: anonymizePsid(input.psid).slice(0, 12),
      reqId: input.reqId,
    });
    if (!storedSourceImageUrl) {
      await clearPendingImageState(input.psid);
      await setFlowState(input.psid, "AWAITING_PHOTO");
      await sendLoggedText(
        input.psid,
        t(input.lang, "missingInputImage"),
        input.reqId
      );
      return true;
    }

    const state = await getOrCreateState(input.psid);
    for (const feature of getBotFeatures()) {
      const result = await feature.onImage?.(
        createFeatureImageContext(
          input.psid,
          input.userId,
          input.reqId,
          input.lang,
          state,
          storedSourceImageUrl
        )
      );
      if (result?.handled) {
        return true;
      }
    }

    logUserState(input.psid, input.userId, state, input.reqId, "image_received");
    const imageDecision = getStoredMessengerImageDecision({
      lastPhotoUrl: state.lastPhotoUrl,
      preselectedStyle: state.preselectedStyle,
      storedSourceImageUrl,
    });
    await setPendingStoredImage(input.psid, storedSourceImageUrl);
    if (isFaceMemoryEnabled()) {
      if (state.faceMemoryConsent?.given) {
        await updateConsentedFaceMemorySource(input.psid, storedSourceImageUrl);
      } else if (!state.faceMemoryConsent) {
        await sendFaceMemoryConsentPrompt(input.psid, input.lang, input.reqId);
        return true;
      }
    }

    logImageFlowDecision({
      psid: input.psid,
      userId: input.userId,
      reqId: input.reqId,
      stage: state.stage,
      hadPreviousPhoto: imageDecision.hadPreviousPhoto,
      incomingImageUrl: imageDecision.incomingImageUrl,
      selectedStyle: state.selectedStyle,
      preselectedStyle: imageDecision.preselectedStyle,
      action: imageDecision.action,
    });

    if (imageDecision.action === "auto_run_preselected_style") {
      await setPreselectedStyle(input.psid, null);
      await setChosenStyle(input.psid, imageDecision.preselectedStyle);
      await runStyleGeneration(
        input.psid,
        input.userId,
        imageDecision.preselectedStyle,
        input.reqId,
        input.lang
      );
      return true;
    }

    await setFlowState(input.psid, "AWAITING_STYLE");
    await sendPhotoReceivedPrompt(input.psid, input.lang, input.reqId);
    return true;
  }

  async function handleTextMessage(input: {
    psid: string;
    userId: string;
    reqId: string;
    lang: Lang;
    text: string;
    timestamp?: number;
  }): Promise<void> {
    const normalizedMessage: NormalizedInboundMessage = {
      channel: "messenger",
      senderId: input.psid,
      userId: input.userId,
      messageType: "text",
      textBody: input.text,
      timestamp: input.timestamp ?? Date.now(),
    };
    console.log("[messenger webhook] normalized event handoff", {
      channel: normalizedMessage.channel,
      reqId: input.reqId,
      user: toLogUser(input.userId),
      messageType: normalizedMessage.messageType,
    });

    const result = await handleSharedTextMessage({
      message: normalizedMessage,
      reqId: input.reqId,
      lang: input.lang,
      getState: () => Promise.resolve(getOrCreateState(input.psid)),
      setFlowState: nextState =>
        Promise.resolve(setFlowState(input.psid, nextState)),
      runTextFeatures: async ({
        state,
        messageText,
        normalizedText,
        hasPhoto,
      }) => {
        for (const feature of getBotFeatures()) {
          const result = await feature.onText?.(
            createFeatureTextContext(
              input.psid,
              input.userId,
              input.reqId,
              input.lang,
              state,
              messageText,
              normalizedText,
              hasPhoto
            )
          );
          if (result?.handled) {
            return true;
          }
        }

        return false;
      },
      logState: (state, context) => {
        logUserState(input.psid, input.userId, state, input.reqId, context);
      },
      logAckIgnored: ack => {
        safeLog("ack_ignored", { ack });
      },
      logRolloutDecision: rolloutDecision => {
        safeLog("messenger_chat_engine_decision", {
          user: toLogUser(input.userId),
          engine: rolloutDecision.engine,
          canaryPercent: rolloutDecision.canaryPercent,
          bucket: rolloutDecision.bucket,
          selected: rolloutDecision.useResponses ? "responses" : "legacy",
        });
      },
      logEngineResult: ({ source, errorCode }) => {
        safeLog("messenger_chat_engine_result", {
          user: toLogUser(input.userId),
          source,
          ...(errorCode ? { errorCode } : {}),
        });
      },
    });
    await sendMessengerBotResponse(result.response, {
      replyState: result.replyState,
      sendText: text => sendLoggedText(input.psid, text, input.reqId),
      sendStateText: (stateName, text) =>
        sendStateQuickReplies(input.psid, stateName, text, input.reqId),
    });
    if (result.afterSend === "markIntroSeen") {
      await Promise.resolve(markIntroSeen(input.psid));
    }
  }

  async function claimEventReplayOrLog(
    event: FacebookWebhookEvent,
    entryId: string | undefined,
    userId: string
  ): Promise<boolean> {
    const dedupeKey = getEventDedupeKey(event, userId, entryId);
    if (!dedupeKey) {
      return true;
    }

    const claimed = await claimWebhookReplayKey(dedupeKey);
    if (claimed) {
      return true;
    }

    safeLog("webhook_replay_ignored", {
      user: toLogUser(userId),
      eventId: dedupeKey,
    });
    return false;
  }

  async function handleReferralStyleEvent(
    psid: string,
    referralRef: string | undefined,
    lang: Lang,
    reqId: string
  ): Promise<boolean> {
    const referralStyle = parseReferralStyle(referralRef);
    if (!referralStyle) {
      return false;
    }

    await clearPendingImageState(psid);
    await setPreselectedStyle(psid, referralStyle);
    await setFlowState(psid, "AWAITING_PHOTO");
    await sendReferralPhotoPrompt(psid, referralStyle, lang, reqId);
    return true;
  }

  const ctx: HandlerContext = {
    defaultLang,
    claimEventReplayOrLog,
    handlePayload,
    handleReferralStyleEvent,
    handleTextMessage,
    logIncomingMessage,
    logUserState,
    maybeSendInFlightMessage,
    sendLoggedImage,
    sendLoggedQuickReplies,
    sendLoggedText,
    sendStateQuickReplies,
    tryHandleImageMessage,
  };

  async function processFacebookWebhookPayload(
    payload: unknown
  ): Promise<void> {
    const entries = Array.isArray(
      (payload as { entry?: unknown[] } | null | undefined)?.entry
    )
      ? ((payload as { entry: FacebookWebhookEntry[] }).entry ?? [])
      : [];

    for (const entry of entries) {
      await handleEntry(ctx, entry);
    }
  }

  return { processFacebookWebhookPayload };
}
