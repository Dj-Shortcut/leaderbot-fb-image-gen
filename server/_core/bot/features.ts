import type { Lang } from "../i18n";
import type {
  ConversationState,
  MessengerUserState,
} from "../messengerState";

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
  sendStateQuickReplies(
    psid: string,
    state: ConversationState,
    text: string,
    reqId: string
  ): Promise<void>;
};

export type BotFeature = {
  name: string;
  onText?(
    input: BotFeatureTextInput,
    deps: BotFeatureDeps
  ): Promise<boolean> | boolean;
  onPayload?(
    input: BotFeaturePayloadInput,
    deps: BotFeatureDeps
  ): Promise<boolean> | boolean;
  onImage?(
    input: BotFeatureImageInput,
    deps: BotFeatureDeps
  ): Promise<boolean> | boolean;
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
