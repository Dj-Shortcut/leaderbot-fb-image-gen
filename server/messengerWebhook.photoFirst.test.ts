import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  sendButtonTemplateMock,
  sendGenericTemplateMock,
  sendImageMock,
  sendQuickRepliesMock,
  sendTextMock,
  safeLogMock,
} = vi.hoisted(() => ({
  sendButtonTemplateMock: vi.fn(async () => undefined),
  sendGenericTemplateMock: vi.fn(async () => undefined),
  sendImageMock: vi.fn(async () => undefined),
  sendQuickRepliesMock: vi.fn(async () => undefined),
  sendTextMock: vi.fn(async () => undefined),
  safeLogMock: vi.fn(),
}));

vi.mock("./_core/messengerApi", () => ({
  sendButtonTemplate: sendButtonTemplateMock,
  sendGenericTemplate: sendGenericTemplateMock,
  sendImage: sendImageMock,
  sendQuickReplies: sendQuickRepliesMock,
  sendText: sendTextMock,
  safeLog: safeLogMock,
}));

import { processFacebookWebhookPayload, resetMessengerEventDedupe } from "./_core/messengerWebhook";
import { anonymizePsid, getState, resetStateStore } from "./_core/messengerState";
import { setSourceImageDnsLookupForTests } from "./_core/image-generation/sourceImageFetcher";

const TEST_PEPPER = "ci-test-pepper";
const originalPrivacyPepper = process.env.PRIVACY_PEPPER;

describe("photo-first onboarding", () => {
  beforeAll(() => {
    process.env.PRIVACY_PEPPER = TEST_PEPPER;
  });

  beforeEach(() => {
    setSourceImageDnsLookupForTests(async () => [
      { address: "93.184.216.34", family: 4 },
    ]);
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS =
      "img.example,lookaside.fbsbx.com,leaderbot-fb-image-gen.fly.dev";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    sendImageMock.mockClear();
    sendButtonTemplateMock.mockClear();
    sendGenericTemplateMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
    const sourceImage = Buffer.alloc(6000, 7);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlString = typeof url === "string" ? url : url.toString();
        if (
          urlString.startsWith("https://img.example/") ||
          urlString.startsWith("https://leaderbot-fb-image-gen.fly.dev/generated/")
        ) {
          return {
            ok: true,
            headers: new Headers({ "content-type": "image/jpeg" }),
            arrayBuffer: async () => sourceImage,
          } as Response;
        }

        throw new Error(`Unexpected fetch in messengerWebhook.photoFirst.test: ${urlString}`);
      })
    );
    resetStateStore();
    resetMessengerEventDedupe();
  });

  afterEach(() => {
    setSourceImageDnsLookupForTests(null);
    vi.unstubAllGlobals();
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
    expect(userState?.lastPhotoUrl).toMatch(
      /^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/[0-9a-f-]+\.jpg$/
    );
    expect(userState?.lastPhotoSource).toBe("stored");
    expect(userState?.stage).toBe("AWAITING_STYLE");
    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      psid,
      "Kies eerst een stijlgroep 👇",
      expect.arrayContaining([
        expect.objectContaining({ payload: "STYLE_CATEGORY_ILLUSTRATED" }),
      ]),
    );
    expect(sendGenericTemplateMock).not.toHaveBeenCalled();
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("shows intro once and moves user to AWAITING_PHOTO", async () => {
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
    expect(userState?.hasSeenIntro).toBe(true);
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      psid,
      "Stuur een foto en ik maak er een speciale versie van in een andere stijl — het is gratis.",
      expect.any(Array),
    );
  });


  it("does not re-send intro on later greetings", async () => {
    const psid = "repeat-hi-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              message: { mid: "mid-repeat-1", text: "Hi" },
            },
          ],
        },
      ],
    });

    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              message: { mid: "mid-repeat-2", text: "hi" },
            },
          ],
        },
      ],
    });

    expect(sendQuickRepliesMock).not.toHaveBeenCalled();
    expect(sendTextMock).toHaveBeenCalledWith(psid, "Stuur gerust een foto, dan kan ik een stijl voor je maken.");
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
    expect(userState?.hasSeenIntro).toBe(false);
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(sendQuickRepliesMock).not.toHaveBeenCalled();
    expect(safeLogMock).toHaveBeenCalledWith("unknown_payload", expect.any(Object));
  });

  it("returns privacy explanation on PRIVACY_INFO postback", async () => {
    const psid = "privacy-user";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

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

    expect(sendButtonTemplateMock).toHaveBeenCalledWith(
      psid,
      [
        "Je foto wordt enkel gebruikt om de afbeelding te maken.",
        "Ze wordt daarna niet bewaard.",
        "Privacybeleid: https://leaderbot-fb-image-gen.fly.dev/privacy",
      ].join("\n"),
      [
        {
          type: "web_url",
          title: "Privacybeleid",
          url: "https://leaderbot-fb-image-gen.fly.dev/privacy",
        },
      ],
    );
    expect(sendTextMock).not.toHaveBeenCalled();
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
    sendButtonTemplateMock.mockClear();

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

    expect(sendButtonTemplateMock).toHaveBeenLastCalledWith(
      psid,
      [
        "Your photo is only used to make the image.",
        "It is not stored afterwards.",
        "Privacy policy: https://leaderbot-fb-image-gen.fly.dev/privacy",
      ].join("\n"),
      [
        {
          type: "web_url",
          title: "Privacy Policy",
          url: "https://leaderbot-fb-image-gen.fly.dev/privacy",
        },
      ],
    );
  });

});
