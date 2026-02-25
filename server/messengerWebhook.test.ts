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
import { resetStateStore } from "./_core/messengerState";

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
  });



  it("sends photo confirmation once and then style quick replies", async () => {
    const payload = {
      entry: [
        {
          messaging: [
            {
              sender: { id: "psid-photo" },
              message: {
                mid: "m_photo_1",
                attachments: [{ type: "image", payload: { url: "https://img.example/c.jpg" } }],
              },
            },
          ],
        },
      ],
    };

    await processFacebookWebhookPayload(payload);

    expect(sendTextMock).toHaveBeenCalledWith("psid-photo", "Photo received ✅");
    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      "psid-photo",
      "What style should I use?",
      expect.arrayContaining([
        expect.objectContaining({ title: "Disco", payload: "STYLE_DISCO" }),
        expect.objectContaining({ title: "Gold", payload: "STYLE_GOLD" }),
      ]),
    );
  });

  it('handles IDLE quick reply payloads for help and starting photo flow', async () => {
    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "psid-help" },
              message: {
                quick_reply: { payload: "WHAT_IS_THIS" },
              },
            },
          ],
        },
      ],
    });

    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      "psid-help",
      "I turn photos into stylized images. Send me a picture to start.",
      expect.arrayContaining([
        expect.objectContaining({ title: "Send photo", payload: "START_PHOTO" }),
        expect.objectContaining({ title: "What is this?", payload: "WHAT_IS_THIS" }),
      ]),
    );

    sendQuickRepliesMock.mockClear();

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "psid-help" },
              message: {
                quick_reply: { payload: "START_PHOTO" },
              },
            },
          ],
        },
      ],
    });

    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      "psid-help",
      "Send a photo when you’re ready 📸",
      [{ content_type: "text", title: "Send photo", payload: "SEND_PHOTO" }],
    );
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
