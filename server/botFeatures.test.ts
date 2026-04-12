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

import { t } from "./_core/i18n";
import {
  processFacebookWebhookPayload,
  resetMessengerEventDedupe,
} from "./_core/messengerWebhook";
import { anonymizePsid, getState, resetStateStore } from "./_core/messengerState";

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
      ([event]) => event === "messenger_chat_engine_decision"
    );
    expect(chatEngineDecisions).toHaveLength(10);
  });

  it("lets remix text fall back to normal assistant handling", async () => {
    const psid = "remix-fallback-user";

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

    expect(sendTextMock).toHaveBeenCalledWith(psid, t("nl", "textWithoutPhoto"));
    expect(generateMessengerReplyMock).not.toHaveBeenCalled();
  });

  it("handles help command via bot feature without calling chat engine", async () => {
    const psid = "help-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              message: { mid: "mid-help", text: "help" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenCalledWith(
      psid,
      t("nl", "textWithoutPhoto")
    );
    expect(generateMessengerReplyMock).not.toHaveBeenCalled();
  });

  it("keeps surprise-without-photo users in awaiting-photo state", async () => {
    const psid = "surprise-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              message: { mid: "mid-surprise", text: "surprise me" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenCalledWith(psid, t("nl", "textWithoutPhoto"));
    expect(getState(anonymizePsid(psid))?.stage).toBe("AWAITING_PHOTO");
    expect(generateMessengerReplyMock).not.toHaveBeenCalled();
  });
});
