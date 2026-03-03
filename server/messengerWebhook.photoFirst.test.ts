import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

const TEST_PEPPER = "ci-test-pepper";
const originalPrivacyPepper = process.env.PRIVACY_PEPPER;

describe("photo-first onboarding", () => {
  beforeAll(() => {
    process.env.PRIVACY_PEPPER = TEST_PEPPER;
  });

  beforeEach(() => {
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
    resetStateStore();
    resetMessengerEventDedupe();
  });

  afterAll(() => {
    if (originalPrivacyPepper === undefined) {
      delete process.env.PRIVACY_PEPPER;
      return;
    }

    process.env.PRIVACY_PEPPER = originalPrivacyPepper;
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
      "Kies je stijl 👇",
      expect.arrayContaining([
        expect.objectContaining({ payload: "STYLE_CARICATURE" }),
      ]),
    );
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("routes text-only greeting into IDLE with quick replies", async () => {
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
    expect(userState?.stage).toBe("IDLE");
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      psid,
      "Stuur een foto en ik maak er een speciale versie van in een andere stijl — het is gratis.",
      expect.any(Array),
    );
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
    expect(sendTextMock).toHaveBeenCalledWith(psid, "Stuur eerst een foto, dan maak ik die stijl voor je.");
    expect(sendQuickRepliesMock).not.toHaveBeenCalled();
  });

  it("ignores unknown DOWNLOAD_HD payload without mutating state", async () => {
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
    expect(userState?.stage).toBe("IDLE");
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(sendQuickRepliesMock).not.toHaveBeenCalled();
    expect(safeLogMock).toHaveBeenCalledWith("unknown_payload", expect.any(Object));
  });

  it("returns privacy explanation on PRIVACY_INFO postback", async () => {
    const psid = "privacy-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              postback: { payload: "PRIVACY_INFO" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenCalledWith(
      psid,
      [
        "Je foto wordt enkel gebruikt om de afbeelding te maken.",
        "Ze wordt daarna niet bewaard.",
        "Hier kan je het volledige privacybeleid lezen: <link>",
      ].join("\n"),
    );
  });

  it("routes free-form user text without photo into the photo prompt", async () => {
    const psid = "about-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              message: { mid: "mid-about", text: "Wie zit hierachter?" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenCalledWith(
      psid,
      "Stuur gerust een foto, dan kan ik een stijl voor je maken.",
    );
  });

  it("uses sender locale when provided and reuses it for later events", async () => {
    const psid = "locale-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid, locale: "en_US" },
              message: { mid: "mid-locale-1", text: "Hi" },
            },
          ],
        },
      ],
    });

    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      psid,
      "Stuur een foto en ik maak er een speciale versie van in een andere stijl — het is gratis.",
      expect.any(Array),
    );

    sendQuickRepliesMock.mockClear();

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              postback: { payload: "PRIVACY_INFO" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenLastCalledWith(
      psid,
      [
        "Your photo is only used to make the image.",
        "It is not stored afterwards.",
        "You can read the full privacy policy here: <link>",
      ].join("\n"),
    );
  });

});
