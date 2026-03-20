import type { ConversationState } from "./messengerState";
import type { BotResponse } from "./botResponse";

function assertNever(_value: never): void {}

export async function sendMessengerBotResponse(
  response: BotResponse | null,
  options: {
    replyState?: ConversationState;
    sendText: (text: string) => Promise<void>;
    sendStateText: (state: ConversationState, text: string) => Promise<void>;
  }
): Promise<void> {
  if (!response) {
    return;
  }

  switch (response.kind) {
    case "text":
      if (!response.text) {
        return;
      }

      if (options.replyState) {
        await options.sendStateText(options.replyState, response.text);
        return;
      }

      await options.sendText(response.text);
      return;
    case "ack":
    case "typing":
      return;
    default:
      assertNever(response.kind);
  }
}

export async function sendWhatsAppBotResponse(
  response: BotResponse | null,
  options: {
    sendText: (text: string) => Promise<void>;
  }
): Promise<void> {
  if (!response) {
    return;
  }

  switch (response.kind) {
    case "text":
      if (!response.text) {
        return;
      }

      await options.sendText(response.text);
      return;
    case "ack":
    case "typing":
      return;
    default:
      assertNever(response.kind);
  }
}
