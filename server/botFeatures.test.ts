import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  sendImageMock,
  sendQuickRepliesMock,
  sendTextMock,
  safeLogMock,
  generateMessengerReplyMock,
} = vi.hoisted(() => ({
  sendImageMock: vi.fn(async () => undefined),
  sendQuickRepliesMock: vi.fn(async () => undefined),
  sendTextMock: vi.fn(async () => undefined),
  safeLogMock: vi.fn(),
  generateMessengerReplyMock: vi.fn(async () => ({
    text: "fallback",
    source: "fallback",
  })),
}));

vi.mock("./_core/messengerApi", () => ({
  sendImage: sendImageMock,
  sendQuickReplies: sendQuickRepliesMock,
  sendText: sendTextMock,
  safeLog: safeLogMock,
}));

vi.mock("./_core/messengerResponsesService", () => ({
  generateMessengerReply: generateMessengerReplyMock,
}));

import { processFacebookWebhookPayload, resetMessengerEventDedupe } from "./_core/messengerWebhook";
import { resetStateStore } from "./_core/messengerState";

describe("bot features", () => {
  beforeEach(() => {
    process.env.PRIVACY_PEPPER = "ci-test-pepper";
    resetStateStore();
    resetMessengerEventDedupe();
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
    generateMessengerReplyMock.mockClear();
  });

  it("rate limits inbound text spam after 10 messages", async () => {
    const psid = "rate-user";

    for (let index = 0; index < 11; index += 1) {
      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: psid },
                message: { mid: `mid-${index}`, text: `msg-${index}` },
              },
            ],
          },
        ],
      });
    }

    expect(sendTextMock).toHaveBeenCalledWith(psid, "⏳ Slow down a bit.");
    const chatEngineDecisions = safeLogMock.mock.calls.filter(
      ([event]) => event === "messenger_chat_engine_decision",
    );
    expect(chatEngineDecisions).toHaveLength(10);
  });

  it("stops further processing when remix has no prior generation", async () => {
    const psid = "remix-empty-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              message: { mid: "mid-remix", text: "remix: neon rain" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenCalledWith(
      psid,
      "I can't remix yet—send a photo and generate one first.",
    );
    expect(generateMessengerReplyMock).not.toHaveBeenCalled();
  });
});
