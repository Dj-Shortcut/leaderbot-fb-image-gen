import type { Lang } from "../i18n";
import type {
  ConversationState,
  MessengerUserState,
} from "../messengerState";
import type { Style } from "../messengerStyles";
import type { GenerationStatsSnapshot } from "../botRuntimeStats";

export type BotFeatureTextInput = {
  psid: string;
  userId: string;
  reqId: string;
  lang: Lang;
  state: MessengerUserState;
  text: string;
  hasPhoto: boolean;
};

export type BotFeaturePayloadInput = {
  psid: string;
  userId: string;
  reqId: string;
  lang: Lang;
  state: MessengerUserState;
  payload: string;
};

export type BotFeatureImageInput = {
  psid: string;
  userId: string;
  reqId: string;
  lang: Lang;
  state: MessengerUserState;
  imageUrl: string;
};

export type BotFeatureDeps = {
  sendText(psid: string, text: string, reqId: string): Promise<void>;
  sendImage(psid: string, imageUrl: string, reqId: string): Promise<void>;
  sendStateQuickReplies(
    psid: string,
    state: ConversationState,
    text: string,
    reqId: string
  ): Promise<void>;
  runStyleGeneration(
    psid: string,
    userId: string,
    style: Style,
    reqId: string,
    lang: Lang,
    sourceImageUrl?: string,
    promptHint?: string
  ): Promise<void>;
  getRuntimeStats(): GenerationStatsSnapshot;
  logger: Pick<typeof console, "info" | "warn" | "error" | "log">;
};

export type BotFeatureContext = {
  psid: string;
  userId: string;
  reqId: string;
  lang: Lang;
  state: MessengerUserState;
  text?: string;
  payload?: string;
  imageUrl?: string;
  hasPhoto?: boolean;
  sendText(text: string): Promise<void>;
  sendImage(imageUrl: string): Promise<void>;
  sendStateQuickReplies(state: ConversationState, text: string): Promise<void>;
  runStyleGeneration(style: Style, sourceImageUrl?: string, promptHint?: string): Promise<void>;
  getRuntimeStats(): GenerationStatsSnapshot;
  logger: Pick<typeof console, "info" | "warn" | "error" | "log">;
};

export type BotFeature = {
  name: string;
  onText?(context: BotFeatureContext): Promise<boolean> | boolean;
  onPayload?(context: BotFeatureContext): Promise<boolean> | boolean;
  onImage?(context: BotFeatureContext): Promise<boolean> | boolean;
};

const botFeatures: BotFeature[] = [];

export function getBotFeatures(): readonly BotFeature[] {
  return botFeatures;
}

export function registerBotFeature(feature: BotFeature): void {
  if (botFeatures.some(existing => existing.name === feature.name)) {
    throw new Error(`Bot feature "${feature.name}" is already registered`);
  }

  botFeatures.push(feature);
}

export function hasBotFeature(name: string): boolean {
  return botFeatures.some(feature => feature.name === name);
}

export function createBotFeatureContext(
  input: BotFeatureTextInput | BotFeaturePayloadInput | BotFeatureImageInput,
  deps: BotFeatureDeps
): BotFeatureContext {
  return {
    ...input,
    sendText: text => deps.sendText(input.psid, text, input.reqId),
    sendImage: imageUrl => deps.sendImage(input.psid, imageUrl, input.reqId),
    sendStateQuickReplies: (state, text) =>
      deps.sendStateQuickReplies(input.psid, state, text, input.reqId),
    runStyleGeneration: (style, sourceImageUrl, promptHint) =>
      deps.runStyleGeneration(
        input.psid,
        input.userId,
        style,
        input.reqId,
        input.lang,
        sourceImageUrl,
        promptHint
      ),
    getRuntimeStats: deps.getRuntimeStats,
    logger: deps.logger,
  };
}
