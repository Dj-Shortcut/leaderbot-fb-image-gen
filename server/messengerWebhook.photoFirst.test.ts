import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendImageMock, sendQuickRepliesMock, sendTextMock, safeLogMock } = vi.hoisted(() => ({
  sendImageMock: vi.fn(async () => undefined),
  sendQuickRepliesMock: vi.fn(async () => undefined),
  sendTextMock: vi.fn(async () => undefined),
  safeLogMock: vi.fn(),
}));

vi.mock("./_core/messengerApi", () => ({
  sendImage: sendImageMock,
  sendQuickReplies: sendQuickRepliesMock,
  sendText: sendTextMock,
  safeLog: safeLogMock,
}));

import { processFacebookWebhookPayload, resetMessengerEventDedupe } from "./_core/messengerWebhook";
import { anonymizePsid, getState, resetStateStore } from "./_core/messengerState";

describe("photo-first onboarding", () => {
  beforeEach(() => {
    process.env.PRIVACY_PEPPER = "test-pepper";
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
    resetStateStore();
    resetMessengerEventDedupe();
  });

  it("handles inbound image attachment by setting pending image and sending style picker", async () => {
    const psid = "photo-first-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              message: {
                mid: "mid-photo-first",
                attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
              },
            },
          ],
        },
      ],
    });

    const userState = getState(anonymizePsid(psid));
    expect(userState?.lastPhoto).toBe("https://img.example/source.jpg");
    expect(userState?.stage).toBe("AWAITING_STYLE");
    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      psid,
      "🎨 Pick a style to transform your image:",
      expect.any(Array),
    );
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("routes text-only greeting into AWAITING_PHOTO with text-only prompt", async () => {
    const psid = "text-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              message: { mid: "mid-hi", text: "Hi" },
            },
          ],
        },
      ],
    });

    const userState = getState(anonymizePsid(psid));
    expect(userState?.stage).toBe("AWAITING_PHOTO");
    expect(sendTextMock).toHaveBeenCalledWith(psid, "Send a photo when you're ready 📷");
    expect(sendQuickRepliesMock).not.toHaveBeenCalled();
  });

  it("guards style payload without pending image", async () => {
    const psid = "guard-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              message: { mid: "mid-style", quick_reply: { payload: "disco" } },
            },
          ],
        },
      ],
    });

    const userState = getState(anonymizePsid(psid));
    expect(userState?.stage).toBe("AWAITING_PHOTO");
    expect(sendTextMock).toHaveBeenCalledWith(psid, "Send a photo first 📷");
    expect(sendQuickRepliesMock).not.toHaveBeenCalled();
  });

  it("handles DOWNLOAD_HD fallback without quick replies", async () => {
    const psid = "download-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              postback: { payload: "DOWNLOAD_HD" },
            },
          ],
        },
      ],
    });

    const userState = getState(anonymizePsid(psid));
    expect(userState?.stage).toBe("AWAITING_PHOTO");
    expect(sendTextMock.mock.calls).toEqual([
      [psid, "I can share HD downloads after I generate an image."],
      [psid, "Send a photo when you're ready 📷"],
    ]);
    expect(sendQuickRepliesMock).not.toHaveBeenCalled();
  });
});
