import type { Lang } from "./i18n";
import type {
  ConversationState,
  MessengerUserState,
} from "./messengerState";
import type { QuickReply } from "./messengerApi";

export type FeatureResult = { handled: true } | { handled: false };

export type BotLogger = {
  info(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error(event: string, details?: Record<string, unknown>): void;
};

type BotContextBase = {
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
