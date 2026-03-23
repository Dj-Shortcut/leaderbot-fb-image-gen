import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  downloadWhatsAppMediaMock,
  sendWhatsAppImageMock,
  sendWhatsAppTextMock,
} = vi.hoisted(() => ({
  downloadWhatsAppMediaMock: vi.fn(),
  sendWhatsAppImageMock: vi.fn(async () => undefined),
  sendWhatsAppTextMock: vi.fn(async () => undefined),
}));

vi.mock("./_core/whatsappApi", () => ({
  downloadWhatsAppMedia: downloadWhatsAppMediaMock,
  sendWhatsAppImage: sendWhatsAppImageMock,
  sendWhatsAppText: sendWhatsAppTextMock,
}));

import { clearGeneratedImageStore } from "./_core/generatedImageStore";
import {
  processWhatsAppWebhookPayload,
  resetMessengerEventDedupe,
} from "./_core/messengerWebhook";
import { anonymizePsid, getState, resetStateStore } from "./_core/messengerState";

const TEST_PEPPER = "ci-test-pepper";
const originalPrivacyPepper = process.env.PRIVACY_PEPPER;
const originalAppBaseUrl = process.env.APP_BASE_URL;
const originalAllowedHosts = process.env.SOURCE_IMAGE_ALLOWED_HOSTS;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

function createWhatsAppPayload(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

beforeAll(() => {
  process.env.PRIVACY_PEPPER = TEST_PEPPER;
});

afterAll(() => {
  if (originalPrivacyPepper === undefined) {
    delete process.env.PRIVACY_PEPPER;
  } else {
    process.env.PRIVACY_PEPPER = originalPrivacyPepper;
  }

  if (originalAppBaseUrl === undefined) {
    delete process.env.APP_BASE_URL;
  } else {
    process.env.APP_BASE_URL = originalAppBaseUrl;
  }

  if (originalAllowedHosts === undefined) {
    delete process.env.SOURCE_IMAGE_ALLOWED_HOSTS;
  } else {
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = originalAllowedHosts;
  }

  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearGeneratedImageStore();
});

describe("whatsapp webhook flow", () => {
  beforeEach(() => {
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "leaderbot-fb-image-gen.fly.dev";
    process.env.OPENAI_API_KEY = "dummy-key";
    downloadWhatsAppMediaMock.mockReset();
    sendWhatsAppImageMock.mockClear();
    sendWhatsAppTextMock.mockClear();
    resetStateStore();
    resetMessengerEventDedupe();
  });

  it("stores an inbound WhatsApp image and prompts for a style group", async () => {
    downloadWhatsAppMediaMock.mockResolvedValue({
      buffer: Buffer.alloc(6000, 7),
      contentType: "image/jpeg",
    });

    await processWhatsAppWebhookPayload(
      createWhatsAppPayload({
        from: "wa-user-1",
        timestamp: "1710000000",
        type: "image",
        image: { id: "wamid-image-1" },
      })
    );

    expect(downloadWhatsAppMediaMock).toHaveBeenCalledWith("wamid-image-1");
    expect(getState(anonymizePsid("wa-user-1"))?.lastPhotoUrl).toMatch(
      /^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/.+\.jpg$/
    );
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      "wa-user-1",
      expect.stringContaining("1. Illustrated")
    );
  });

  it("accepts a WhatsApp category reply and sends category-specific style options", async () => {
    downloadWhatsAppMediaMock.mockResolvedValue({
      buffer: Buffer.alloc(6000, 7),
      contentType: "image/jpeg",
    });

    await processWhatsAppWebhookPayload(
      createWhatsAppPayload({
        from: "wa-user-2",
        timestamp: "1710000001",
        type: "image",
        image: { id: "wamid-image-2" },
      })
    );

    sendWhatsAppTextMock.mockClear();

    await processWhatsAppWebhookPayload(
      createWhatsAppPayload({
        from: "wa-user-2",
        timestamp: "1710000002",
        type: "text",
        text: { body: "3" },
      })
    );

    expect(getState(anonymizePsid("wa-user-2"))?.selectedStyleCategory).toBe(
      "bold"
    );
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      "wa-user-2",
      expect.stringContaining("1. Afroman")
    );
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      "wa-user-2",
      expect.stringContaining("4. Disco")
    );
  });

  it("generates and returns a WhatsApp image after the user picks a style", async () => {
    downloadWhatsAppMediaMock.mockResolvedValue({
      buffer: Buffer.alloc(6000, 7),
      contentType: "image/jpeg",
    });

    const sourceImage = Buffer.alloc(6000, 9);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const resolved = typeof url === "string" ? url : url.toString();

        if (resolved.startsWith("https://leaderbot-fb-image-gen.fly.dev/generated/")) {
          return {
            ok: true,
            headers: new Headers({ "content-type": "image/jpeg" }),
            arrayBuffer: async () => sourceImage,
          } as Response;
        }

        if (resolved === "https://api.openai.com/v1/images/edits") {
          return {
            ok: true,
            json: async () => ({
              data: [{ b64_json: Buffer.from("generated-image").toString("base64") }],
            }),
          } as Response;
        }

        throw new Error(`Unexpected fetch url: ${resolved}`);
      })
    );

    await processWhatsAppWebhookPayload(
      createWhatsAppPayload({
        from: "wa-user-3",
        timestamp: "1710000003",
        type: "image",
        image: { id: "wamid-image-3" },
      })
    );

    await processWhatsAppWebhookPayload(
      createWhatsAppPayload({
        from: "wa-user-3",
        timestamp: "1710000004",
        type: "text",
        text: { body: "3" },
      })
    );

    sendWhatsAppTextMock.mockClear();
    sendWhatsAppImageMock.mockClear();

    await processWhatsAppWebhookPayload(
      createWhatsAppPayload({
        from: "wa-user-3",
        timestamp: "1710000005",
        type: "text",
        text: { body: "4" },
      })
    );

    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      "wa-user-3",
      "Ik maak nu je Disco-stijl."
    );
    expect(sendWhatsAppImageMock).toHaveBeenCalledWith(
      "wa-user-3",
      expect.stringMatching(
        /^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/.+\.jpg$/
      )
    );
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      "wa-user-3",
      expect.stringContaining("Klaar")
    );
    expect(getState(anonymizePsid("wa-user-3"))?.selectedStyle).toBe("disco");
  });

  it("reopens the WhatsApp category picker when the user asks for a new style", async () => {
    downloadWhatsAppMediaMock.mockResolvedValue({
      buffer: Buffer.alloc(6000, 7),
      contentType: "image/jpeg",
    });

    await processWhatsAppWebhookPayload(
      createWhatsAppPayload({
        from: "wa-user-4",
        timestamp: "1710000006",
        type: "image",
        image: { id: "wamid-image-4" },
      })
    );

    sendWhatsAppTextMock.mockClear();

    await processWhatsAppWebhookPayload(
      createWhatsAppPayload({
        from: "wa-user-4",
        timestamp: "1710000007",
        type: "text",
        text: { body: "nieuwe stijl" },
      })
    );

    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      "wa-user-4",
      expect.stringContaining("1. Illustrated")
    );
    expect(getState(anonymizePsid("wa-user-4"))?.stage).toBe("AWAITING_STYLE");
  });

  it("supports /style commands on WhatsApp before the user uploads a photo", async () => {
    downloadWhatsAppMediaMock.mockResolvedValue({
      buffer: Buffer.alloc(6000, 7),
      contentType: "image/jpeg",
    });

    const sourceImage = Buffer.alloc(6000, 9);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const resolved = typeof url === "string" ? url : url.toString();

        if (resolved.startsWith("https://leaderbot-fb-image-gen.fly.dev/generated/")) {
          return {
            ok: true,
            headers: new Headers({ "content-type": "image/jpeg" }),
            arrayBuffer: async () => sourceImage,
          } as Response;
        }

        if (resolved === "https://api.openai.com/v1/images/edits") {
          return {
            ok: true,
            json: async () => ({
              data: [{ b64_json: Buffer.from("generated-image-2").toString("base64") }],
            }),
          } as Response;
        }

        throw new Error(`Unexpected fetch url: ${resolved}`);
      })
    );

    await processWhatsAppWebhookPayload(
      createWhatsAppPayload({
        from: "wa-user-5",
        timestamp: "1710000008",
        type: "text",
        text: { body: "/style cyberpunk" },
      })
    );

    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      "wa-user-5",
      "✅ Stijl ingesteld op cyberpunk."
    );
    expect(getState(anonymizePsid("wa-user-5"))?.preselectedStyle).toBe(
      "cyberpunk"
    );

    sendWhatsAppTextMock.mockClear();
    sendWhatsAppImageMock.mockClear();

    await processWhatsAppWebhookPayload(
      createWhatsAppPayload({
        from: "wa-user-5",
        timestamp: "1710000009",
        type: "image",
        image: { id: "wamid-image-5" },
      })
    );

    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      "wa-user-5",
      "Ik maak nu je Cyberpunk-stijl."
    );
    expect(sendWhatsAppImageMock).toHaveBeenCalledWith(
      "wa-user-5",
      expect.stringMatching(
        /^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/.+\.jpg$/
      )
    );
    expect(getState(anonymizePsid("wa-user-5"))?.preselectedStyle).toBeNull();
    expect(getState(anonymizePsid("wa-user-5"))?.selectedStyle).toBe(
      "cyberpunk"
    );
  });

  it("runs shared help commands on WhatsApp with state-aware fallback options", async () => {
    downloadWhatsAppMediaMock.mockResolvedValue({
      buffer: Buffer.alloc(6000, 7),
      contentType: "image/jpeg",
    });

    await processWhatsAppWebhookPayload(
      createWhatsAppPayload({
        from: "wa-user-6",
        timestamp: "1710000010",
        type: "image",
        image: { id: "wamid-image-6" },
      })
    );

    sendWhatsAppTextMock.mockClear();

    await processWhatsAppWebhookPayload(
      createWhatsAppPayload({
        from: "wa-user-6",
        timestamp: "1710000011",
        type: "text",
        text: { body: "help" },
      })
    );

    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      "wa-user-6",
      expect.stringContaining("Quick actions")
    );
    expect(sendWhatsAppTextMock).toHaveBeenCalledWith(
      "wa-user-6",
      expect.stringContaining("1. ")
    );
  });
});
