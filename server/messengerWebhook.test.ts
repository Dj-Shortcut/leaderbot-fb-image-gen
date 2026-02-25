import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendQuickRepliesMock, sendTextMock, safeLogMock } = vi.hoisted(() => ({
  sendQuickRepliesMock: vi.fn(async () => undefined),
  sendTextMock: vi.fn(async () => undefined),
  safeLogMock: vi.fn(),
}));

vi.mock("./_core/messengerApi", () => ({
  sendQuickReplies: sendQuickRepliesMock,
  sendText: sendTextMock,
  safeLog: safeLogMock,
}));

import { processFacebookWebhookPayload, resetMessengerEventDedupe } from "./_core/messengerWebhook";
import { anonymizePsid, resetStateStore, setFlowState } from "./_core/messengerState";

describe("messenger webhook dedupe", () => {
  beforeEach(() => {
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    resetStateStore();
    resetMessengerEventDedupe();
  });

  it("processes a message.mid only once", async () => {
    const payload = {
      entry: [
        {
          messaging: [
            {
              sender: { id: "psid-123" },
              message: {
                mid: "m_abc123",
                attachments: [{ type: "image", payload: { url: "https://img.example/a.jpg" } }],
              },
            },
          ],
        },
      ],
    };

    await processFacebookWebhookPayload(payload);
    await processFacebookWebhookPayload(payload);

    expect(sendQuickRepliesMock).toHaveBeenCalledTimes(1);
    expect(sendTextMock).toHaveBeenCalledTimes(1);
  });

  it("ignores echo messages without poisoning dedupe for the real message", async () => {
    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "echo-user" },
              message: {
                mid: "mid-shared",
                is_echo: true,
                attachments: [{ type: "image", payload: { url: "https://img.example/echo.jpg" } }],
              },
            },
          ],
        },
      ],
    });

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "echo-user" },
              message: {
                mid: "mid-shared",
                attachments: [{ type: "image", payload: { url: "https://img.example/real.jpg" } }],
              },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(sendTextMock).toHaveBeenCalledWith("echo-user", "Photo received ✅");
    expect(sendQuickRepliesMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to sender+timestamp dedupe when mid is missing", async () => {
    const payload = {
      entry: [
        {
          messaging: [
            {
              sender: { id: "psid-456" },
              timestamp: 1730000000000,
              message: {
                attachments: [{ type: "image", payload: { url: "https://img.example/b.jpg" } }],
              },
            },
          ],
        },
      ],
    };

    await processFacebookWebhookPayload(payload);
    await processFacebookWebhookPayload(payload);

    expect(sendQuickRepliesMock).toHaveBeenCalledTimes(1);
  });
});

describe("messenger greeting behavior", () => {
  beforeEach(() => {
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    resetStateStore();
    resetMessengerEventDedupe();
  });

  it("shows welcome quick start in IDLE", async () => {
    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "idle-user" },
              message: { mid: "mid-idle-1", text: "Hi" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).not.toHaveBeenCalled();
    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      "idle-user",
      "Welcome 👋 Pick a quick start.",
      expect.arrayContaining([
        { content_type: "text", title: "Send photo", payload: "START_PHOTO" },
        { content_type: "text", title: "What is this?", payload: "WHAT_IS_THIS" },
      ]),
    );
  });

  it("keeps users in AWAITING_STYLE when they send smalltalk", async () => {
    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "style-user" },
              message: {
                mid: "mid-style-1",
                attachments: [{ type: "image", payload: { url: "https://img.example/style.jpg" } }],
              },
            },
            {
              sender: { id: "style-user" },
              message: { mid: "mid-style-2", text: "thanks" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenCalledWith("style-user", "Photo received ✅");
    expect(sendQuickRepliesMock).toHaveBeenLastCalledWith(
      "style-user",
      "What style should I use?",
      [
        { content_type: "text", title: "Disco", payload: "STYLE_DISCO" },
        { content_type: "text", title: "Gold", payload: "STYLE_GOLD" },
        { content_type: "text", title: "Anime", payload: "STYLE_ANIME" },
        { content_type: "text", title: "Clouds", payload: "STYLE_CLOUDS" },
      ],
    );
  });

  it("offers follow-up quick actions when state is RESULT_READY", async () => {
    const psid = "result-user";
    const userId = anonymizePsid(psid);
    setFlowState(userId, "RESULT_READY");

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              message: { mid: "mid-result-1", text: "Hey" },
            },
          ],
        },
      ],
    });

    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      psid,
      "Yo 👋 Wil je nog een style proberen op dezelfde foto, of een nieuwe sturen?",
      [
        { content_type: "text", title: "Try another style", payload: "CHOOSE_STYLE" },
        { content_type: "text", title: "New photo", payload: "SEND_PHOTO" },
      ],
    );
  });
});
