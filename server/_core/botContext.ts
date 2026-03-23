import type { Lang } from "./i18n";
import type { BotChannel } from "./normalizedInboundMessage";
import type {
  ConversationState,
  MessengerUserState,
} from "./messengerState";
import type { QuickReply } from "./messengerApi";
import type { Style } from "./messengerStyles";
import type { GenerationStatsSnapshot } from "./botRuntimeStats";

export type FeatureResult = { handled: true } | { handled: false };

export type BotLogger = {
  info(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error(event: string, details?: Record<string, unknown>): void;
};

export type BotChannelCapabilities = {
  quickReplies: boolean;
  richTemplates: boolean;
};

type BotContextBase = {
  channel: BotChannel;
  capabilities: BotChannelCapabilities;
  senderId: string;
  userId: string;
  reqId: string;
  lang: Lang;
  state: MessengerUserState;
  sendText(text: string): Promise<void>;
  sendImage(url: string): Promise<void>;
  sendQuickReplies(text: string, replies: QuickReply[]): Promise<void>;
  sendStateQuickReplies(
    state: ConversationState,
    text: string
  ): Promise<void>;
  setFlowState(state: ConversationState): Promise<void>;
  preselectStyle(style: Style | null): Promise<void>;
  chooseStyle(style: Style): Promise<void>;
  runStyleGeneration(
    style: Style,
    sourceImageUrl?: string,
    promptHint?: string
  ): Promise<void>;
  getRuntimeStats(): GenerationStatsSnapshot;
  logger: BotLogger;
};

export type BotTextContext = BotContextBase & {
  messageText: string;
  normalizedText: string;
  hasPhoto: boolean;
};

export type BotPayloadContext = BotContextBase & {
  payload: string;
};

export type BotImageContext = BotContextBase & {
  imageUrl: string;
};

export type BotErrorContext = BotContextBase & {
  error: unknown;
};
