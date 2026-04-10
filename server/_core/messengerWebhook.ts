import express from "express";
import rateLimit from "express-rate-limit";
import { createHash } from "node:crypto";
import { z, ZodError } from "zod";
import { normalizeLang, t, type Lang } from "./i18n";
import { createWebhookHandlers } from "./webhookHandlers";
import { routeActiveExperience, routeEntryIntent } from "./experienceRouter";
import { resetWebhookReplayProtection } from "./webhookReplayProtection";
import {
  normalizeStyle,
  parseStyle,
  styleCategoryPayloadToCategory,
  stylePayloadToStyle,
  STYLE_CATEGORY_LABELS,
  STYLE_LABELS,
} from "./webhookHelpers";
import { facebookWebhookPayloadSchema } from "./webhookSchemas";
import {
  downloadWhatsAppMedia,
  sendWhatsAppButtons,
  sendWhatsAppImage,
  sendWhatsAppList,
  sendWhatsAppText,
} from "./whatsappApi";
import { toUserKey, toLogUser } from "./privacy";
import { handleSharedTextMessage } from "./sharedTextHandler";
import {
  clearPendingImageState,
  getOrCreateState,
  markIntroSeen,
  setChosenStyle,
  setLastGenerated,
  setLastGenerationContext,
  setLastEntryIntent,
  setLastUserMessageAt,
  setPendingImage,
  setPreselectedStyle,
  setSelectedStyleCategory,
  setActiveExperience,
  setFlowState,
  type ConversationState,
  type MessengerUserState,
} from "./messengerState";
import type { NormalizedInboundMessage } from "./normalizedInboundMessage";
import type { BotResponse } from "./botResponse";
import { sendWhatsAppBotResponse } from "./botResponseAdapters";
import {
  createImageGenerator,
  GenerationTimeoutError,
  getGenerationMetrics,
  InvalidSourceImageUrlError,
  MissingAppBaseUrlError,
  MissingInputImageError,
  MissingObjectStorageConfigError,
  MissingOpenAiApiKeyError,
  OpenAiBudgetExceededError,
} from "./imageService";
import {
  getStylesForCategory,
  type Style,
  type StyleCategory,
} from "./messengerStyles";
import { canGenerate, increment } from "./messengerQuota";
import { storeInboundSourceImage } from "./sourceImageStore";
import {
  buildStateResponseText,
  resolveStateReplyPayload,
} from "./stateResponseText";
import { getBotFeatures } from "./bot/features";
import type { BotLogger, BotTextContext } from "./botContext";
import { getTodayRuntimeStats } from "./botRuntimeStats";
import type { QuickReply } from "./messengerApi";

const PRIVACY_POLICY_URL = process.env.PRIVACY_POLICY_URL?.trim() || "<link>";
const DEFAULT_LANG = normalizeLang(process.env.DEFAULT_MESSENGER_LANG);

const webhookVerificationQuerySchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string().min(1),
  "hub.challenge": z.string().min(1),
});

const handlers = createWebhookHandlers({
  defaultLang: DEFAULT_LANG,
  privacyPolicyUrl: PRIVACY_POLICY_URL,
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

export function resetMessengerEventDedupe(): void {
  resetWebhookReplayProtection();
}

function summarizeSensitiveUrl(url: string): {
  host: string;
  shortHash: string;
} {
  const shortHash = createHash("sha256").update(url).digest("hex").slice(0, 12);

  try {
    return {
      host: new URL(url).host || "invalid-url",
      shortHash,
    };
  } catch {
    return {
      host: "invalid-url",
      shortHash,
    };
  }
}

function getMetaVerifyToken(): string {
  return (
    process.env.META_VERIFY_TOKEN?.trim() ||
    process.env.FB_VERIFY_TOKEN?.trim() ||
    ""
  );
}

function isWhatsAppWebhookPayload(
  payload: unknown
): payload is { object: "whatsapp_business_account" } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { object?: unknown }).object === "whatsapp_business_account"
  );
}

function logWhatsAppWebhookPayload(payload: unknown): void {
  const serializedBody = JSON.stringify(payload, null, 2);
  console.log("[whatsapp webhook] inbound payload");
  console.log(serializedBody);
}

function extractWhatsAppEvents(payload: unknown): NormalizedInboundMessage[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const entries = Array.isArray((payload as { entry?: unknown[] }).entry)
    ? (payload as { entry: unknown[] }).entry
    : [];

  return entries.flatMap(entry => {
    const changes = Array.isArray(
      (entry as { changes?: unknown[] } | null)?.changes
    )
      ? ((entry as { changes: unknown[] }).changes ?? [])
      : [];

    return changes.flatMap(change => {
      const value =
        typeof change === "object" && change !== null
          ? ((change as { value?: unknown }).value ?? null)
          : null;
      const messages = Array.isArray(
        (value as { messages?: unknown[] } | null)?.messages
      )
        ? ((value as { messages: unknown[] }).messages ?? [])
        : [];

      return messages.flatMap(message => {
        if (typeof message !== "object" || message === null) {
          return [];
        }

        const from =
          typeof (message as { from?: unknown }).from === "string"
            ? (message as { from: string }).from
            : "";
        const messageType =
          typeof (message as { type?: unknown }).type === "string"
            ? (message as { type: string }).type
            : "unknown";
        const textBody =
          typeof (message as { text?: { body?: unknown } }).text?.body ===
          "string"
            ? (message as { text: { body: string } }).text.body
            : null;
        const interactiveReplyId =
          typeof (message as {
            interactive?: {
              button_reply?: { id?: unknown };
              list_reply?: { id?: unknown };
            };
          }).interactive?.button_reply?.id === "string"
            ? (message as {
                interactive: { button_reply: { id: string } };
              }).interactive.button_reply.id
            : typeof (message as {
                  interactive?: { list_reply?: { id?: unknown } };
                }).interactive?.list_reply?.id === "string"
              ? (message as {
                  interactive: { list_reply: { id: string } };
                }).interactive.list_reply.id
              : null;
        const interactiveReplyTitle =
          typeof (message as {
            interactive?: {
              button_reply?: { title?: unknown };
              list_reply?: { title?: unknown };
            };
          }).interactive?.button_reply?.title === "string"
            ? (message as {
                interactive: { button_reply: { title: string } };
              }).interactive.button_reply.title
            : typeof (message as {
                  interactive?: { list_reply?: { title?: unknown } };
                }).interactive?.list_reply?.title === "string"
              ? (message as {
                  interactive: { list_reply: { title: string } };
                }).interactive.list_reply.title
              : null;
        const imageId =
          typeof (message as { image?: { id?: unknown } }).image?.id ===
          "string"
            ? (message as { image: { id: string } }).image.id
            : null;
        const timestampRaw =
          typeof (message as { timestamp?: unknown }).timestamp === "string"
            ? Number((message as { timestamp: string }).timestamp)
            : null;

        if (!from) {
          return [];
        }

        return [
          {
            channel: "whatsapp",
            senderId: from,
            userId: toUserKey(from),
            channelCapabilities: {
              quickReplies: false,
              richTemplates: false,
            },
            rawMessageType: messageType,
            messageType:
              messageType === "text" || messageType === "interactive"
                ? "text"
                : messageType === "image"
                  ? "image"
                  : "unknown",
            textBody:
              interactiveReplyId ??
              interactiveReplyTitle ??
              textBody ??
              undefined,
            imageId: imageId ?? undefined,
            timestamp: Number.isFinite(timestampRaw) ? timestampRaw! * 1000 : undefined,
            rawEventMeta: {
              interactiveReplyId: interactiveReplyId ?? undefined,
              interactiveReplyTitle: interactiveReplyTitle ?? undefined,
            },
          },
        ];
      });
    });
  });
}

const WHATSAPP_CATEGORY_CHOICES = [
  { key: "1", category: "illustrated" as const },
  { key: "2", category: "atmosphere" as const },
  { key: "3", category: "bold" as const },
];

function parseWhatsAppCategorySelection(
  text: string
): StyleCategory | undefined {
  const normalizedText = text.trim().toLowerCase();
  if (normalizedText === "wa_illustrated") {
    return "illustrated";
  }

  if (normalizedText === "wa_atmosphere") {
    return "atmosphere";
  }

  if (normalizedText === "wa_bold") {
    return "bold";
  }

  const numbered = WHATSAPP_CATEGORY_CHOICES.find(
    choice => choice.key === normalizedText
  );
  if (numbered) {
    return numbered.category;
  }

  if (normalizedText.includes("illustr")) {
    return "illustrated";
  }

  if (normalizedText.includes("atmos")) {
    return "atmosphere";
  }

  if (normalizedText.includes("bold")) {
    return "bold";
  }

  return styleCategoryPayloadToCategory(normalizedText.toUpperCase());
}

function parseWhatsAppStyleSelection(
  text: string,
  category: StyleCategory | null | undefined
): Style | undefined {
  const normalizedText = text.trim().toLowerCase();

  if (category) {
    const numericIndex = Number.parseInt(normalizedText, 10);
    if (Number.isFinite(numericIndex) && numericIndex > 0) {
      return getStylesForCategory(category)[numericIndex - 1]?.style;
    }
  }

  return stylePayloadToStyle(text) ?? parseStyle(text) ?? normalizeStyle(text);
}

async function sendWhatsAppStyleCategoryPrompt(
  senderId: string,
  lang: Lang
): Promise<void> {
  await sendWhatsAppButtons(
    senderId,
    lang === "en"
      ? "Choose a style group to continue."
      : "Kies een stijlgroep om verder te gaan.",
    WHATSAPP_CATEGORY_CHOICES.map(choice => ({
      id: `WA_${choice.category.toUpperCase()}`,
      title: STYLE_CATEGORY_LABELS[choice.category],
    }))
  );
}

async function sendWhatsAppStyleOptions(
  senderId: string,
  category: StyleCategory,
  lang: Lang
): Promise<void> {
  await setSelectedStyleCategory(senderId, category);
  await setFlowState(senderId, "AWAITING_STYLE");
  await sendWhatsAppList(
    senderId,
    lang === "en"
      ? `Pick a ${STYLE_CATEGORY_LABELS[category].toLowerCase()} style.`
      : `Kies een ${STYLE_CATEGORY_LABELS[category].toLowerCase()}-stijl.`,
    lang === "en" ? "Choose style" : "Kies stijl",
    getStylesForCategory(category).map(style => ({
      id: style.payload,
      title: STYLE_LABELS[style.style],
      description:
        lang === "en"
          ? `${STYLE_CATEGORY_LABELS[category]} style`
          : `${STYLE_CATEGORY_LABELS[category]}-stijl`,
    })),
    STYLE_CATEGORY_LABELS[category]
  );
}

function buildWhatsAppReplyListText(text: string, replies: QuickReply[]): string {
  if (replies.length === 0) {
    return text;
  }

  return [
    text,
    "",
    ...replies.map((reply, index) => `${index + 1}. ${reply.title}`),
  ].join("\n");
}

async function sendWhatsAppStateText(
  senderId: string,
  state: ConversationState,
  text: string,
  lang: Lang
): Promise<void> {
  await sendWhatsAppText(senderId, buildStateResponseText(state, text, lang));
}

function resolveWhatsAppPrivacyPolicyUrl(): string | undefined {
  const configured = process.env.PRIVACY_POLICY_URL?.trim();
  if (configured && /^https?:\/\//i.test(configured)) {
    return configured;
  }

  const appBaseUrl =
    process.env.APP_BASE_URL?.trim() ?? process.env.BASE_URL?.trim();
  if (appBaseUrl && /^https?:\/\//i.test(appBaseUrl)) {
    return `${appBaseUrl.replace(/\/$/, "")}/privacy`;
  }

  return undefined;
}

async function handleWhatsAppPayloadSelection(
  payload: string,
  event: NormalizedInboundMessage,
  reqId: string,
  lang: Lang
): Promise<boolean> {
  if (payload === "WHAT_IS_THIS") {
    await sendWhatsAppText(event.senderId, t(lang, "flowExplanation"));
    return true;
  }

  if (payload === "PRIVACY_INFO") {
    const privacyUrl = resolveWhatsAppPrivacyPolicyUrl();
    await sendWhatsAppText(
      event.senderId,
      t(lang, "privacy", { link: privacyUrl })
    );
    return true;
  }

  if (payload === "CHOOSE_STYLE") {
    await setPreselectedStyle(event.senderId, null);
    await setSelectedStyleCategory(event.senderId, null);
    await setFlowState(event.senderId, "AWAITING_STYLE");
    await sendWhatsAppStyleCategoryPrompt(event.senderId, lang);
    return true;
  }

  if (payload === "RETRY_STYLE") {
    const currentState = await Promise.resolve(getOrCreateState(event.senderId));
    const retryStyle = currentState.selectedStyle
      ? parseStyle(currentState.selectedStyle)
      : undefined;

    if (retryStyle) {
      await runWhatsAppStyleGeneration(
        event.senderId,
        event.userId,
        retryStyle,
        reqId,
        lang
      );
      return true;
    }

    await setFlowState(event.senderId, "AWAITING_STYLE");
    await sendWhatsAppStyleCategoryPrompt(event.senderId, lang);
    return true;
  }

  return false;
}

function createWhatsAppFeatureLogger(userId: string): BotLogger {
  return {
    info(event, details = {}) {
      console.info("[whatsapp feature]", event, {
        user: toLogUser(userId),
        ...details,
      });
    },
    warn(event, details = {}) {
      console.warn("[whatsapp feature]", event, {
        user: toLogUser(userId),
        ...details,
      });
    },
    error(event, details = {}) {
      console.error("[whatsapp feature]", event, {
        user: toLogUser(userId),
        ...details,
      });
    },
  };
}

function createWhatsAppTextContext(
  event: NormalizedInboundMessage,
  reqId: string,
  lang: Lang,
  state: Awaited<ReturnType<typeof getOrCreateState>>,
  messageText: string,
  normalizedText: string,
  hasPhoto: boolean
): BotTextContext {
  return {
    channel: "whatsapp",
    capabilities: {
      quickReplies: false,
      richTemplates: false,
    },
    senderId: event.senderId,
    userId: event.userId,
    reqId,
    lang,
    state,
    messageText,
    normalizedText,
    hasPhoto,
    sendText: text => sendWhatsAppText(event.senderId, text),
    sendImage: imageUrl => sendWhatsAppImage(event.senderId, imageUrl),
    sendQuickReplies: (text, replies) =>
      sendWhatsAppText(event.senderId, buildWhatsAppReplyListText(text, replies)),
    sendStateQuickReplies: (nextState, text) =>
      sendWhatsAppStateText(event.senderId, nextState, text, lang),
    setFlowState: nextState =>
      Promise.resolve(setFlowState(event.senderId, nextState)),
    preselectStyle: style =>
      Promise.resolve(setPreselectedStyle(event.senderId, style)).then(
        () => undefined
      ),
    chooseStyle: style =>
      runWhatsAppStyleGeneration(event.senderId, event.userId, style, reqId, lang),
    runStyleGeneration: (style, sourceImageUrl, promptHint) =>
      runWhatsAppStyleGeneration(
        event.senderId,
        event.userId,
        style,
        reqId,
        lang,
        sourceImageUrl,
        promptHint
      ),
    getRuntimeStats: () => getTodayRuntimeStats(),
    logger: createWhatsAppFeatureLogger(event.userId),
  };
}

async function runWhatsAppStyleGeneration(
  senderId: string,
  userId: string,
  style: Style,
  reqId: string,
  lang: Lang,
  sourceImageUrl?: string,
  promptHint?: string
): Promise<void> {
  const allowed = await canGenerate(senderId);
  if (!allowed) {
    await sendWhatsAppText(
      senderId,
      lang === "en"
        ? "You used your free credits for today. Come back tomorrow."
        : "Je hebt je gratis credits voor vandaag opgebruikt. Kom morgen terug."
    );
    await setFlowState(senderId, "AWAITING_STYLE");
    return;
  }

  const state = await Promise.resolve(getOrCreateState(senderId));
  const resolvedSourceImageUrl = sourceImageUrl ?? state.lastPhotoUrl ?? undefined;
  const trustedSourceImageUrl =
    resolvedSourceImageUrl !== undefined &&
    resolvedSourceImageUrl === state.lastPhotoUrl &&
    state.lastPhotoSource === "stored";
  if (!resolvedSourceImageUrl) {
    await setFlowState(senderId, "AWAITING_PHOTO");
    await sendWhatsAppText(senderId, t(lang, "styleWithoutPhoto"));
    return;
  }

  console.info("[whatsapp webhook] generation requested", {
    user: toLogUser(userId),
    style,
    hasPromptHint: Boolean(promptHint?.trim()),
    sourceImageUrlHost: (() => {
      try {
        return new URL(resolvedSourceImageUrl).hostname.toLowerCase();
      } catch {
        return undefined;
      }
    })(),
    trustedSourceImageUrl,
  });

  await setChosenStyle(senderId, style);
  await setFlowState(senderId, "PROCESSING");
  await sendWhatsAppText(
    senderId,
    t(lang, "generatingPrompt", { styleLabel: STYLE_LABELS[style] })
  );

  const { generator } = createImageGenerator();

  try {
    const { imageUrl, metrics } = await generator.generate({
      style,
      sourceImageUrl: resolvedSourceImageUrl,
      trustedSourceImageUrl,
      sourceImageProvenance: trustedSourceImageUrl ? "storeInbound" : undefined,
      promptHint,
      userKey: userId,
      reqId,
    });

    await sendWhatsAppImage(senderId, imageUrl);
    await increment(senderId);
    await setLastGenerated(senderId, imageUrl);
    await setLastGenerationContext(senderId, { style, prompt: promptHint });
    await setFlowState(senderId, "RESULT_READY");
    await sendWhatsAppText(
      senderId,
      `${t(lang, "success")}\n${
        lang === "en"
          ? "Reply with 'new style' if you want another version."
          : "Antwoord met 'nieuwe stijl' als je nog een versie wilt."
      }`
    );
    console.info("[whatsapp webhook] generation success", {
      user: toLogUser(userId),
      totalMs: metrics.totalMs,
      style,
    });
  } catch (error) {
    const failureMetrics = getGenerationMetrics(error);
    console.error("[whatsapp webhook] generation failed", {
      user: toLogUser(userId),
      style,
      totalMs: failureMetrics?.totalMs,
      error: error instanceof Error ? error.message : String(error),
    });

    let failureText = t(lang, "generationGenericFailure");
    if (error instanceof InvalidSourceImageUrlError) {
      failureText = t(lang, "missingInputImage");
      if (!sourceImageUrl || resolvedSourceImageUrl === state.lastPhotoUrl) {
        await clearPendingImageState(senderId);
      }
      await setFlowState(senderId, "AWAITING_PHOTO");
      console.error("[whatsapp webhook] source image rejected", {
        user: toLogUser(userId),
        style,
        sourceImageUrl: summarizeSensitiveUrl(resolvedSourceImageUrl),
      });
    } else if (error instanceof MissingInputImageError) {
      failureText = t(lang, "missingInputImage");
      await setFlowState(senderId, "AWAITING_PHOTO");
    } else if (
      error instanceof MissingOpenAiApiKeyError ||
      error instanceof MissingAppBaseUrlError ||
      error instanceof MissingObjectStorageConfigError
    ) {
      failureText = t(lang, "generationUnavailable");
      await setFlowState(senderId, "AWAITING_STYLE");
    } else if (error instanceof GenerationTimeoutError) {
      failureText = t(lang, "generationTimeout");
      await setFlowState(senderId, "AWAITING_STYLE");
    } else if (error instanceof OpenAiBudgetExceededError) {
      failureText = t(lang, "generationBudgetReached");
      await setFlowState(senderId, "AWAITING_STYLE");
    } else {
      await setFlowState(senderId, "FAILURE");
    }

    await sendWhatsAppText(senderId, failureText);
  }
}

async function handleWhatsAppTextEvent(
  event: NormalizedInboundMessage,
  reqId: string,
  lang: Lang
): Promise<void> {
  const state = await Promise.resolve(getOrCreateState(event.senderId));
  const textBody = event.textBody?.trim() ?? "";
  const normalizedText = textBody.toLowerCase();
  const selectedCategory = state.selectedStyleCategory ?? null;

  if (
    state.lastPhotoUrl &&
    (normalizedText === "nieuwe stijl" || normalizedText === "new style")
  ) {
    console.info("[whatsapp webhook] reopening style picker", {
      user: toLogUser(event.userId),
    });
    await setFlowState(event.senderId, "AWAITING_STYLE");
    await sendWhatsAppStyleCategoryPrompt(event.senderId, lang);
    return;
  }

  if (textBody) {
    const selectedPayload = resolveStateReplyPayload(
      state.stage,
      textBody,
      lang
    );
    if (
      selectedPayload &&
      (await handleWhatsAppPayloadSelection(
        selectedPayload,
        event,
        reqId,
        lang
      ))
    ) {
      return;
    }

    const selectedStyle = parseWhatsAppStyleSelection(textBody, selectedCategory);
    if (selectedStyle && state.lastPhotoUrl) {
      console.info("[whatsapp webhook] style selected", {
        user: toLogUser(event.userId),
        style: selectedStyle,
        selectedCategory,
        textBody,
      });
      await runWhatsAppStyleGeneration(
        event.senderId,
        event.userId,
        selectedStyle,
        reqId,
        lang
      );
      return;
    }

    const selectedStyleCategory = parseWhatsAppCategorySelection(textBody);
    if (selectedStyleCategory && state.lastPhotoUrl) {
      console.info("[whatsapp webhook] style category selected", {
        user: toLogUser(event.userId),
        category: selectedStyleCategory,
        textBody,
      });
      await sendWhatsAppStyleOptions(event.senderId, selectedStyleCategory, lang);
      return;
    }
  }

  const result = await handleSharedTextMessage({
    message: event,
    reqId,
    lang,
    getState: () => Promise.resolve(getOrCreateState(event.senderId)),
    setFlowState: (nextState: ConversationState) =>
      Promise.resolve(setFlowState(event.senderId, nextState)),
    runTextFeatures: async ({
      state: currentState,
      messageText,
      normalizedText: currentNormalizedText,
      hasPhoto,
    }) => {
      for (const feature of getBotFeatures()) {
        const result = await feature.onText?.(
          createWhatsAppTextContext(
            event,
            reqId,
            lang,
            currentState,
            messageText,
            currentNormalizedText,
            hasPhoto
          )
        );
        if (result?.handled) {
          return true;
        }
      }

      return false;
    },
    logState: (currentState, context) => {
      console.log("[whatsapp webhook] shared state", {
        context,
        user: toLogUser(event.userId),
        stage: currentState.stage,
        hasPhoto: Boolean(currentState.lastPhotoUrl),
      });
    },
  });

  await sendWhatsAppBotResponse(result.response, {
    sendText: text => sendWhatsAppText(event.senderId, text),
    replyState: result.replyState,
    sendStateText: (stateName, text) =>
      sendWhatsAppStateText(event.senderId, stateName, text, lang),
  });
  if (result.afterSend === "markIntroSeen") {
    await Promise.resolve(markIntroSeen(event.senderId));
  }
}

async function handleWhatsAppImageEvent(
  event: NormalizedInboundMessage,
  reqId: string,
  lang: Lang
): Promise<void> {
  if (!event.imageId) {
    console.warn("[whatsapp webhook] image event missing image id", {
      user: toLogUser(event.userId),
    });
    return;
  }

  const media = await downloadWhatsAppMedia(event.imageId);
  console.info("[whatsapp webhook] image downloaded", {
    user: toLogUser(event.userId),
    imageId: event.imageId,
    contentType: media.contentType,
    byteLength: media.buffer.length,
  });
  const persistedImageUrl = await storeInboundSourceImage(
    media.buffer,
    media.contentType,
    reqId
  );
  console.info("[whatsapp webhook] image persisted", {
    user: toLogUser(event.userId),
    imageId: event.imageId,
    persistedImageUrl,
  });

  const state = await Promise.resolve(getOrCreateState(event.senderId));
  const preselectedStyle = normalizeStyle(state.preselectedStyle ?? "");
  await setPendingImage(
    event.senderId,
    persistedImageUrl,
    Date.now(),
    "stored"
  );

  if (preselectedStyle) {
    await setPreselectedStyle(event.senderId, null);
    await runWhatsAppStyleGeneration(
      event.senderId,
      event.userId,
      preselectedStyle,
      reqId,
      lang,
      persistedImageUrl
    );
    return;
  }

  await sendWhatsAppStyleCategoryPrompt(event.senderId, lang);
}

function createWhatsAppRouteResponseSender(senderId: string) {
  return {
    sendText: (text: string) => sendWhatsAppText(senderId, text),
    sendOptionsPrompt: (
      prompt: string,
      options: Array<{ id: string; title: string }>,
      fallbackText?: string
    ) =>
      sendWhatsAppText(
        senderId,
        fallbackText ?? [prompt, ...options.map(option => option.title)].join("\n")
      ),
    sendImage: (imageUrl: string, caption?: string) => {
      if (caption) {
        return sendWhatsAppText(senderId, caption).then(() =>
          sendWhatsAppImage(senderId, imageUrl)
        );
      }

      return sendWhatsAppImage(senderId, imageUrl);
    },
  };
}

async function sendWhatsAppExperienceRouteResponse(
  senderId: string,
  route: {
    response?: BotResponse | null;
    afterSend?: (() => Promise<BotResponse | null>) | undefined;
  }
): Promise<void> {
  await sendWhatsAppBotResponse(
    route.response ?? null,
    createWhatsAppRouteResponseSender(senderId)
  );

  if (!route.afterSend) {
    return;
  }

  const followUpResponse = await route.afterSend();
  await sendWhatsAppBotResponse(
    followUpResponse,
    createWhatsAppRouteResponseSender(senderId)
  );
}

async function handleWhatsAppExperienceRouting(
  event: NormalizedInboundMessage
): Promise<boolean> {
  const currentState = await Promise.resolve(getOrCreateState(event.senderId));
  const routingInput = {
    state: currentState,
    setLastEntryIntent: (nextEntryIntent: MessengerUserState["lastEntryIntent"]) =>
      Promise.resolve(setLastEntryIntent(event.senderId, nextEntryIntent ?? null)),
    setActiveExperience: (nextActiveExperience: MessengerUserState["activeExperience"]) =>
      Promise.resolve(setActiveExperience(event.senderId, nextActiveExperience ?? null)),
  };

  const entryIntentRoute = await routeEntryIntent({
    ...routingInput,
    entryIntent: event.entryIntent ?? null,
  });
  if (entryIntentRoute.handled) {
    await sendWhatsAppExperienceRouteResponse(event.senderId, entryIntentRoute);
    return true;
  }

  const activeExperienceRoute = await routeActiveExperience({
    ...routingInput,
    action: event.textBody ?? null,
  });
  if (activeExperienceRoute.handled) {
    await sendWhatsAppExperienceRouteResponse(event.senderId, activeExperienceRoute);
    return true;
  }

  return false;
}

export async function processWhatsAppWebhookPayload(
  payload: unknown
): Promise<void> {
  logWhatsAppWebhookPayload(payload);

  const events = extractWhatsAppEvents(payload);
  if (events.length === 0) {
    console.log("[whatsapp webhook] no inbound messages found");
    return;
  }

  for (const event of events) {
    const reqId = `${event.senderId}-${Date.now()}`;
    const lang = DEFAULT_LANG;

    console.log("[whatsapp webhook] normalized inbound event", {
      channel: event.channel,
      user: toLogUser(event.userId),
      messageType: event.messageType,
      rawMessageType: event.rawMessageType,
    });

    await Promise.resolve(
      setLastUserMessageAt(event.senderId, event.timestamp ?? Date.now())
    );

    try {
      if (event.messageType === "image") {
        if (await handleWhatsAppExperienceRouting(event)) {
          continue;
        }

        await handleWhatsAppImageEvent(event, reqId, lang);
        continue;
      }

      if (event.messageType === "text") {
        if (await handleWhatsAppExperienceRouting(event)) {
          continue;
        }

        await handleWhatsAppTextEvent(event, reqId, lang);
        continue;
      }

      if (event.messageType === "unknown") {
        console.warn("[whatsapp webhook] unsupported inbound message type", {
          user: toLogUser(event.userId),
          rawMessageType: event.rawMessageType,
        });
        await sendWhatsAppText(event.senderId, t(lang, "unsupportedMedia"));
      }
    } catch (error) {
      console.error("[whatsapp webhook] reply failed", {
        to: event.senderId,
        error: error instanceof Error ? error.message : String(error),
      });
      await sendWhatsAppText(
        event.senderId,
        lang === "en"
          ? "Something went wrong on my side. Please try again."
          : "Er liep iets mis aan mijn kant. Probeer gerust opnieuw."
      ).catch(() => undefined);
    }
  }
}

export async function processFacebookWebhookPayload(
  payload: unknown
): Promise<void> {
  await handlers.processFacebookWebhookPayload(payload);
}

function processWhatsAppWebhookPayloadSafely(payload: unknown): void {
  void processWhatsAppWebhookPayload(payload).catch(error => {
    console.error("[whatsapp webhook] async processing failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function processFacebookWebhookPayloadSafely(payload: unknown): void {
  void processFacebookWebhookPayload(payload).catch(error => {
    console.error("[messenger webhook] async processing failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export function registerMetaWebhookRoutes(app: express.Express): void {
  const handleVerification: express.RequestHandler = (req, res) => {
    const configuredToken = getMetaVerifyToken();
    const parsedQuery = webhookVerificationQuerySchema.safeParse(req.query);
    const path = req.path;

    console.log("[meta webhook] GET verification request", { path });

    if (
      !configuredToken ||
      !parsedQuery.success ||
      parsedQuery.data["hub.verify_token"] !== configuredToken
    ) {
      console.warn("[meta webhook] GET verification rejected", {
        path,
        hasConfiguredToken: Boolean(configuredToken),
        hasMode: typeof req.query["hub.mode"] === "string",
        hasChallenge: typeof req.query["hub.challenge"] === "string",
      });
      return res.sendStatus(403);
    }

    console.log("[meta webhook] GET verification accepted", { path });
    return res
      .status(200)
      .type("text/plain")
      .send(parsedQuery.data["hub.challenge"]);
  };

  app.use("/webhook", webhookLimiter);
  app.get("/webhook", handleVerification);
  app.get("/webhook/facebook", handleVerification);

  const handleWebhookPost: express.RequestHandler = (req, res) => {
    if (isWhatsAppWebhookPayload(req.body)) {
      console.log("[whatsapp webhook] POST delivery received");
      res.sendStatus(200);
      setImmediate(() => {
        processWhatsAppWebhookPayloadSafely(req.body);
      });
      return;
    }

    try {
      facebookWebhookPayloadSchema.parse(req.body);
    } catch (error) {
      if (error instanceof ZodError) {
        console.warn(
          "[messenger webhook] POST rejected: invalid payload shape"
        );
        res.status(400).json({ error: "Invalid webhook payload" });
        return;
      }

      throw error;
    }

    console.log("[messenger webhook] POST delivery received");
    res.sendStatus(200);
    setImmediate(() => {
      processFacebookWebhookPayloadSafely(req.body);
    });
  };

  app.post("/webhook", handleWebhookPost);
  app.post("/webhook/facebook", handleWebhookPost);
}
