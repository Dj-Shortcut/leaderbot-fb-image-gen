import { t, type Lang } from "./i18n";
import type { ConversationState, MessengerUserState } from "./messengerState";
import { getChatRolloutDecision } from "./chatRollout";
import { generateMessengerReply } from "./messengerResponsesService";
import { safeLog } from "./messengerApi";
import { detectAck, getGreetingResponse } from "./webhookHelpers";
import { toLogUser } from "./privacy";
import type { NormalizedInboundMessage } from "./normalizedInboundMessage";
import type { BotResponse } from "./botResponse";

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

type SharedTextHandlerInput = {
  message: NormalizedInboundMessage;
  reqId: string;
  lang: Lang;
  getState: () => Promise<MessengerUserState>;
  setFlowState: (state: ConversationState) => Promise<void>;
  runTextFeatures?: (args: {
    state: MessengerUserState;
    messageText: string;
    normalizedText: string;
    hasPhoto: boolean;
  }) => Promise<boolean>;
  logState?: (state: MessengerUserState, context: string) => void;
  logAckIgnored?: (ack: string) => void;
  logRolloutDecision?: (
    decision: ReturnType<typeof getChatRolloutDecision>
  ) => void;
  logEngineResult?: (details: { source: string; errorCode?: string }) => void;
};

/**
 * Shared text handling currently only covers normalized text messages.
 * Channel adapters remain responsible for media-specific flows and any
 * post-send side effects returned via this result contract.
 */
export type SharedTextHandlerResult = {
  response: BotResponse | null;
  replyState?: ConversationState;
  afterSend?: "markIntroSeen";
};

export async function handleSharedTextMessage(
  input: SharedTextHandlerInput
): Promise<SharedTextHandlerResult> {
  if (input.message.messageType !== "text") {
    return { response: null };
  }

  const trimmedText = input.message.textBody?.trim();
  const normalizedText = trimmedText?.toLowerCase();
  if (!trimmedText || !normalizedText) {
    return { response: null };
  }

  console.log("[shared text] executing", {
    channel: input.message.channel,
    reqId: input.reqId,
    user: toLogUser(input.message.userId),
    messageType: input.message.messageType,
  });

  const ack = detectAck(trimmedText);
  if (ack) {
    if (input.logAckIgnored) {
      input.logAckIgnored(ack);
    } else {
      safeLog("ack_ignored", { ack, channel: input.message.channel });
    }
    return { response: null };
  }

  if (GREETINGS.has(normalizedText) || SMALLTALK.has(normalizedText)) {
    const state = await input.getState();
    input.logState?.(state, "greeting");
    if (!state.hasSeenIntro && state.stage === "IDLE") {
      return {
        response: { kind: "text", text: t(input.lang, "flowExplanation") },
        replyState: "IDLE",
        afterSend: "markIntroSeen",
      };
    }

    const response = getGreetingResponse(state.stage, input.lang);
    if (response.mode === "text") {
      return { response: { kind: "text", text: response.text } };
    }

    return {
      response: { kind: "text", text: response.text },
      replyState: response.state,
    };
  }

  if (normalizedText === "nieuwe stijl" || normalizedText === "new style") {
    const state = await input.getState();
    if (state.lastPhotoUrl) {
      await input.setFlowState("AWAITING_STYLE");
      return {
        response: { kind: "text", text: t(input.lang, "styleCategoryPicker") },
        replyState: "AWAITING_STYLE",
      };
    }
  }

  const state = await input.getState();
  const hasPhoto = Boolean(state.lastPhotoUrl);
  if (
    input.runTextFeatures &&
    (await input.runTextFeatures({
      state,
      messageText: trimmedText,
      normalizedText,
      hasPhoto,
    }))
  ) {
    return { response: null };
  }

  input.logState?.(state, "text_message");
  if (!hasPhoto) {
    await input.setFlowState("AWAITING_PHOTO");
  }

  const rolloutDecision = getChatRolloutDecision(input.message.userId);
  if (input.logRolloutDecision) {
    input.logRolloutDecision(rolloutDecision);
  } else {
    console.log("[shared text] rollout decision", {
      channel: input.message.channel,
      user: toLogUser(input.message.userId),
      engine: rolloutDecision.engine,
      selected: rolloutDecision.useResponses ? "responses" : "legacy",
    });
  }

  if (rolloutDecision.useResponses) {
    try {
      const reply = await generateMessengerReply({
        psid: input.message.senderId,
        userKey: input.message.userId,
        lang: input.lang,
        stage: state.stage,
        text: trimmedText,
        hasPhoto,
      });

      if (input.logEngineResult) {
        input.logEngineResult({ source: reply.source });
      } else {
        safeLog("shared_text_engine_result", {
          channel: input.message.channel,
          user: toLogUser(input.message.userId),
          source: reply.source,
        });
      }
      return { response: { kind: "text", text: reply.text } };
    } catch (error) {
      if (input.logEngineResult) {
        input.logEngineResult({
          source: "fallback",
          errorCode: error instanceof Error ? error.name : "unknown_error",
        });
      } else {
        safeLog("shared_text_engine_result", {
          channel: input.message.channel,
          user: toLogUser(input.message.userId),
          source: "fallback",
          errorCode: error instanceof Error ? error.name : "unknown_error",
        });
      }
      return {
        response: {
          kind: "text",
          text: hasPhoto
            ? t(input.lang, "flowExplanation")
            : t(input.lang, "textWithoutPhoto"),
        },
      };
    }
  }

  return {
    response: {
      kind: "text",
      text: hasPhoto
        ? t(input.lang, "flowExplanation")
        : t(input.lang, "textWithoutPhoto"),
    },
  };
}
