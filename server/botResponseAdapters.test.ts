import { describe, expect, it, vi } from "vitest";
import {
  sendMessengerBotResponse,
  sendWhatsAppBotResponse,
} from "./_core/botResponseAdapters";

describe("botResponseAdapters", () => {
  it("maps a Messenger text response with replyState to state text sending", async () => {
    const sendText = vi.fn(async () => {});
    const sendStateText = vi.fn(async () => {});

    await sendMessengerBotResponse(
      { kind: "text", text: "hello" },
      {
        replyState: "IDLE",
        sendText,
        sendStateText,
      }
    );

    expect(sendStateText).toHaveBeenCalledWith("IDLE", "hello");
    expect(sendText).not.toHaveBeenCalled();
  });

  it("maps a WhatsApp text response to plain text sending", async () => {
    const sendText = vi.fn(async () => {});

    await sendWhatsAppBotResponse(
      { kind: "text", text: "hello" },
      {
        sendText,
      }
    );

    expect(sendText).toHaveBeenCalledWith("hello");
  });
});
