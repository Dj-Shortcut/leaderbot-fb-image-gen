import type { ConversationState } from "./messengerState";
import type { BotResponse } from "./botResponse";

function assertNever(_value: never): void {}

export async function sendMessengerBotResponse(
  response: BotResponse | null,
  options: {
    replyState?: ConversationState;
    sendText: (text: string) => Promise<void>;
    sendStateText: (state: ConversationState, text: string) => Promise<void>;
    sendOptionsPrompt?: (
      prompt: string,
      options: Array<{ id: string; title: string }>,
      fallbackText?: string
    ) => Promise<void>;
    sendImage?: (imageUrl: string, caption?: string) => Promise<void>;
    sendResultCard?: (card: Extract<BotResponse, { kind: "result_card" }>) => Promise<void>;
  }
): Promise<void> {
  if (!response) {
    return;
  }

  switch (response.kind) {
    case "text":
      if (options.replyState) {
        await options.sendStateText(options.replyState, response.text);
        return;
      }

      await options.sendText(response.text);
      return;
    case "options_prompt":
      if (options.sendOptionsPrompt) {
        await options.sendOptionsPrompt(
          response.prompt,
          response.options,
          response.fallbackText
        );
        return;
      }

      await options.sendText(
        response.fallbackText ??
          [response.prompt, ...response.options.map(option => option.title)].join(
            "\n"
          )
      );
      return;
    case "result_card":
      if (options.sendResultCard) {
        await options.sendResultCard(response);
        return;
      }

      if (response.imageUrl && options.sendImage) {
        await options.sendImage(response.imageUrl, response.title);
      }
      await options.sendText([response.title, response.body].join("\n\n"));
      return;
    case "image":
      if (options.sendImage) {
        await options.sendImage(response.imageUrl, response.caption);
        return;
      }

      if (response.caption) {
        await options.sendText(response.caption);
      } else {
        await options.sendText("[Image not available]");
      }
      return;
    case "handoff_state":
      if (response.text) {
        await options.sendText(response.text);
      }
      return;
    case "error":
      await options.sendText(response.text);
      return;
    case "ack":
    case "typing":
      return;
    default:
      assertNever(response);
  }
}

export async function sendWhatsAppBotResponse(
  response: BotResponse | null,
  options: {
    sendText: (text: string) => Promise<void>;
    replyState?: ConversationState;
    sendStateText?: (state: ConversationState, text: string) => Promise<void>;
    sendOptionsPrompt?: (
      prompt: string,
      options: Array<{ id: string; title: string }>,
      fallbackText?: string
    ) => Promise<void>;
    sendImage?: (imageUrl: string, caption?: string) => Promise<void>;
    sendResultCard?: (card: Extract<BotResponse, { kind: "result_card" }>) => Promise<void>;
  }
): Promise<void> {
  if (!response) {
    return;
  }

  switch (response.kind) {
    case "text":
      if (options.replyState && options.sendStateText) {
        await options.sendStateText(options.replyState, response.text);
        return;
      }

      await options.sendText(response.text);
      return;
    case "options_prompt":
      if (options.sendOptionsPrompt) {
        await options.sendOptionsPrompt(
          response.prompt,
          response.options,
          response.fallbackText
        );
        return;
      }

      await options.sendText(
        response.fallbackText ??
          [response.prompt, ...response.options.map(option => option.title)].join(
            "\n"
          )
      );
      return;
    case "result_card":
      if (options.sendResultCard) {
        await options.sendResultCard(response);
        return;
      }

      if (response.imageUrl && options.sendImage) {
        await options.sendImage(response.imageUrl, response.title);
      }
      await options.sendText([response.title, response.body].join("\n\n"));
      return;
    case "image":
      if (options.sendImage) {
        await options.sendImage(response.imageUrl, response.caption);
        return;
      }

      if (response.caption) {
        await options.sendText(response.caption);
      } else {
        await options.sendText("[Image not available]");
      }
      return;
    case "handoff_state":
      if (response.text) {
        await options.sendText(response.text);
      }
      return;
    case "error":
      await options.sendText(response.text);
      return;
    case "ack":
    case "typing":
      return;
    default:
      assertNever(response);
  }
}
