import type { ConversationState } from "./messengerState";
import type { BotResponse } from "./botResponse";

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

  if (response.kind === "text" && response.text) {
    if (options.replyState) {
      await options.sendStateText(options.replyState, response.text);
      return;
    }

    await options.sendText(response.text);
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

  if (response.kind === "text" && response.text) {
    await options.sendText(response.text);
  }
}
