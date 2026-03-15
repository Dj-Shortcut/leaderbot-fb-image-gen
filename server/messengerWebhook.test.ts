import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendImageMock, sendQuickRepliesMock, sendTextMock, safeLogMock, generateMessengerReplyMock } = vi.hoisted(() => ({
  sendImageMock: vi.fn(async () => undefined),
  sendQuickRepliesMock: vi.fn(async () => undefined),
  sendTextMock: vi.fn(async () => undefined),
  safeLogMock: vi.fn(),
  generateMessengerReplyMock: vi.fn(async () => ({
    text: "Stuur gerust een foto, dan kan ik een stijl voor je maken.",
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

import {
  detectAck,
  processFacebookWebhookPayload,
  resetMessengerEventDedupe,
  summarizeWebhook,
} from "./_core/messengerWebhook";
import { anonymizePsid, getState, resetStateStore, setFlowState } from "./_core/messengerState";
import { getEventDedupeKey } from "./_core/webhookHelpers";
import { getBotFeatures } from "./_core/bot/features";

const TEST_PEPPER = "ci-test-pepper";
const originalPrivacyPepper = process.env.PRIVACY_PEPPER;

function toUrlString(url: string | URL): string {
  return typeof url === "string" ? url : url.toString();
}

beforeAll(() => {
  process.env.PRIVACY_PEPPER = TEST_PEPPER;
});

afterAll(() => {
  if (originalPrivacyPepper === undefined) {
    delete process.env.PRIVACY_PEPPER;
    return;
  }

  process.env.PRIVACY_PEPPER = originalPrivacyPepper;
});

beforeEach(() => {
  delete process.env.MESSENGER_CHAT_ENGINE;
  delete process.env.MESSENGER_CHAT_CANARY_PERCENT;

  generateMessengerReplyMock.mockReset();
  generateMessengerReplyMock.mockResolvedValue({
    text: "Stuur gerust een foto, dan kan ik een stijl voor je maken.",
    source: "fallback",
  });
});

describe("webhook summary logging", () => {
  it("summarizes event types and flags without including message contents", () => {
    const summary = summarizeWebhook({
      object: "page",
      entry: [
        {
          messaging: [
            {
              sender: { id: "user-123" },
              recipient: { id: "page-456" },
              message: {
                text: "super secret text",
                is_echo: true,
                attachments: [{ type: "image" }, { type: "audio" }, { payload: { url: "https://a" } }],
              },
            },
            {
              postback: { payload: "disco" },
            },
            {
              read: { watermark: 1 },
            },
            {
              delivery: { mids: ["mid-1"] },
            },
          ],
        },
      ],
    });

    expect(summary).toEqual({
      object: "page",
      entryCount: 1,
      events: [
        {
          type: "message",
          hasText: true,
          attachmentTypes: ["image", "audio"],
          isEcho: true,
          hasRead: false,
          hasDelivery: false,
          hasPostback: false,
        },
        {
          type: "postback",
          hasText: false,
          attachmentTypes: [],
          isEcho: false,
          hasRead: false,
          hasDelivery: false,
          hasPostback: true,
        },
        {
          type: "read",
          hasText: false,
          attachmentTypes: [],
          isEcho: false,
          hasRead: true,
          hasDelivery: false,
          hasPostback: false,
        },
        {
          type: "delivery",
          hasText: false,
          attachmentTypes: [],
          isEcho: false,
          hasRead: false,
          hasDelivery: true,
          hasPostback: false,
        },
      ],
    });

    expect(JSON.stringify(summary)).not.toContain("super secret text");
    expect(JSON.stringify(summary)).not.toContain("user-123");
    expect(JSON.stringify(summary)).not.toContain("page-456");
  });
});

describe("messenger webhook dedupe", () => {
  beforeEach(() => {
    process.env.MOCK_MODE = "true";
    process.env.GENERATOR_MODE = "mock";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";
    delete process.env.OPENAI_API_KEY;
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
    resetStateStore();
    resetMessengerEventDedupe();
  });

  it("registers built-in bot features", () => {
    expect(getBotFeatures().map(feature => feature.name)).toContain("rateLimit");
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
    expect(sendTextMock).not.toHaveBeenCalled();
  });

  it("dedupes on mid before the real message arrives when an echo already used it", async () => {
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

    expect(sendQuickRepliesMock).not.toHaveBeenCalled();
    expect(sendTextMock).not.toHaveBeenCalled();
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

  it("does not collide fallback keys for different events with identical timestamps", () => {
    const timestamp = 1730000000002;

    const imageEventKey = getEventDedupeKey(
      {
        sender: { id: "psid-same-ts" },
        timestamp,
        message: {
          attachments: [{ type: "image", payload: { url: "https://img.example/a.jpg" } }],
        },
      },
      "psid-same-ts",
    );

    const textEventKey = getEventDedupeKey(
      {
        sender: { id: "psid-same-ts" },
        timestamp,
        message: {
          text: "hello",
        },
      },
      "psid-same-ts",
    );

    expect(imageEventKey).toBeDefined();
    expect(textEventKey).toBeDefined();
    expect(imageEventKey).not.toBe(textEventKey);
  });

  it("keeps fallback key deterministic for true duplicates without mid", () => {
    const duplicateEvent = {
      sender: { id: "psid-dup-ts" },
      timestamp: 1730000000003,
      postback: { payload: "STYLE_DISCO" },
    };

    const first = getEventDedupeKey(duplicateEvent, "psid-dup-ts", "entry-dup");
    const second = getEventDedupeKey(duplicateEvent, "psid-dup-ts", "entry-dup");

    expect(first).toBe(second);
    expect(first).toContain("entry:entry-dup");
    expect(first).toMatch(/postback:[a-f0-9]{12}/);
  });

  it("does not include raw sender id or payload text in fallback key", () => {
    const key = getEventDedupeKey(
      {
        sender: { id: "psid-sensitive" },
        timestamp: 1730000000005,
        postback: { payload: "VERY_SENSITIVE_PAYLOAD" },
        message: {
          quick_reply: { payload: "ANOTHER_SECRET" },
        },
      },
      "anonymized-user-key",
      "entry-sensitive",
    );

    expect(key).toBeDefined();
    expect(key).toContain("entry:entry-sensitive");
    expect(key).toContain("user:anonymized-user-key");
    expect(key).not.toContain("psid-sensitive");
    expect(key).not.toContain("VERY_SENSITIVE_PAYLOAD");
    expect(key).not.toContain("ANOTHER_SECRET");
    expect(key).toMatch(/postback:[a-f0-9]{12}/);
    expect(key).toMatch(/quickReply:[a-f0-9]{12}/);
  });

  it("still blocks duplicate fallback events in replay protection", async () => {
    const duplicatePayload = {
      entry: [
        {
          messaging: [
            {
              sender: { id: "psid-replay" },
              timestamp: 1730000000004,
              message: {
                attachments: [{ type: "image", payload: { url: "https://img.example/replay.jpg" } }],
              },
            },
          ],
        },
      ],
    };

    await processFacebookWebhookPayload(duplicatePayload);
    await processFacebookWebhookPayload(duplicatePayload);

    expect(sendQuickRepliesMock).toHaveBeenCalledTimes(1);
  });

  it("uses entry.id plus timestamp as replay key when mid is missing", async () => {
    const payload = {
      entry: [
        {
          id: "entry-123",
          messaging: [
            {
              sender: { id: "psid-entry-fallback" },
              timestamp: 1730000000001,
              message: {
                attachments: [{ type: "image", payload: { url: "https://img.example/c.jpg" } }],
              },
            },
          ],
        },
      ],
    };

    await processFacebookWebhookPayload(payload);
    await processFacebookWebhookPayload(payload);

    expect(sendQuickRepliesMock).toHaveBeenCalledTimes(1);
    expect(safeLogMock).toHaveBeenCalledWith("webhook_replay_ignored", {
      user: expect.any(String),
      eventId: expect.stringContaining("entry:entry-123:"),
    });
  });

  it("does not emit photo debug logs when debug logging is disabled", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const expectedPsidHash = anonymizePsid("psid-host-log").slice(0, 12);
      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "psid-host-log" },
                message: {
                  mid: "mid-host-log",
                  attachments: [
                    {
                      type: "image",
                      payload: {
                        url: "https://lookaside.fbsbx.com/path/to/file.jpg?token=secret",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      const photoReceivedCall = consoleLogSpy.mock.calls
        .map(args => args[0])
        .find(
          value =>
            typeof value === "string" &&
            value.includes("\"msg\":\"photo_received\"")
        );

      expect(photoReceivedCall).toBeUndefined();
      expect(expectedPsidHash).toMatch(/[a-f0-9]{12}/);
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("updates lastUserMessageAt only for inbound user messages", async () => {
    const psid = "window-user";
    const userId = anonymizePsid(psid);

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              timestamp: 1730000000000,
              read: { watermark: 1730000000000 },
            },
            {
              sender: { id: psid },
              timestamp: 1730000000001,
              delivery: { mids: ["mid-delivery"] },
            },
          ],
        },
      ],
    });

    expect(getState(userId)?.lastUserMessageAt).toBeUndefined();

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              timestamp: 1730000000123,
              message: { mid: "mid-window-1", text: "Hi" },
            },
          ],
        },
      ],
    });

    expect(getState(userId)?.lastUserMessageAt).toBe(1730000000123);

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              timestamp: 1730000000999,
              message: { mid: "mid-window-echo", is_echo: true, text: "echo" },
            },
          ],
        },
      ],
    });

    expect(getState(userId)?.lastUserMessageAt).toBe(1730000000123);
  });



  it("returns local demo images for all canonical styles in MOCK_MODE", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    try {
      const styles: Array<[string, string]> = [
        ["caricature", "01-caricature.png"],
        ["petals", "02-petals.png"],
        ["gold", "03-gold.png"],
        ["cinematic", "04-crayon.png"],
        ["disco", "05-paparazzi.png"],
        ["clouds", "06-clouds.png"],
      ];

      for (const [style, filename] of styles) {
        sendImageMock.mockClear();
        sendQuickRepliesMock.mockClear();
        sendTextMock.mockClear();
        resetStateStore();
        resetMessengerEventDedupe();

        const processing = processFacebookWebhookPayload({
          entry: [
            {
              messaging: [
                {
                  sender: { id: `style-user-${style}` },
                  message: {
                    mid: `mid-photo-${style}`,
                    attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
                  },
                },
                {
                  sender: { id: `style-user-${style}` },
                  message: { mid: `mid-style-${style}`, quick_reply: { payload: style } },
                },
              ],
            },
          ],
        });

        await vi.advanceTimersByTimeAsync(2000);
        await processing;

        const [[, imageUrl]] = sendImageMock.mock.calls as [[string, string]];
        expect(imageUrl).toBe(`http://localhost:3000/demo/${filename}`);
      }
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });


  it("uses canonical quick-reply payload and APP_BASE_URL for image attachments", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

    try {
      const processing = processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "canonical-payload-user" },
                message: {
                  mid: "mid-photo-canonical",
                  attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
                },
              },
              {
                sender: { id: "canonical-payload-user" },
                message: {
                  mid: "mid-style-canonical",
                  quick_reply: { payload: "disco" },
                },
              },
            ],
          },
        ],
      });

      await vi.advanceTimersByTimeAsync(2000);
      await processing;

      expect(sendImageMock).toHaveBeenCalledWith(
        "canonical-payload-user",
        "https://leaderbot-fb-image-gen.fly.dev/demo/05-paparazzi.png",
      );
    } finally {
      delete process.env.APP_BASE_URL;
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("returns a mock image attachment and follow-up after style selection", async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    try {
      const processing = processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "mock-image-user" },
                message: {
                  mid: "mid-photo-1",
                  attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
                },
              },
              {
                sender: { id: "mock-image-user" },
                message: { mid: "mid-style-1", quick_reply: { payload: "disco" } },
              },
            ],
          },
        ],
      });

      await vi.advanceTimersByTimeAsync(2000);
      await processing;

      expect(sendImageMock).toHaveBeenCalledWith(
        "mock-image-user",
        "http://localhost:3000/demo/05-paparazzi.png",
      );
      expect(sendQuickRepliesMock).toHaveBeenLastCalledWith(
        "mock-image-user",
        "Klaar ✅",
        [
          { content_type: "text", title: "Remix", payload: "REMIX_LAST" },
          { content_type: "text", title: "Nieuwe stijl", payload: "CHOOSE_STYLE" },
          { content_type: "text", title: "Privacy", payload: "PRIVACY_INFO" },
        ],
      );
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("shows friendly message when GENERATOR_MODE=openai and OPENAI_API_KEY is missing", async () => {
    process.env.GENERATOR_MODE = "openai";
    delete process.env.OPENAI_API_KEY;

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "openai-missing-key-user" },
              message: {
                mid: "mid-photo-openai-missing",
                attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
              },
            },
            {
              sender: { id: "openai-missing-key-user" },
              message: { mid: "mid-style-openai-missing", quick_reply: { payload: "disco" } },
            },
          ],
        },
      ],
    });

    expect(sendQuickRepliesMock).toHaveBeenLastCalledWith("openai-missing-key-user", "AI generation isn’t enabled yet.", [
      { content_type: "text", title: "Opnieuw", payload: "RETRY_STYLE_disco" },
      { content_type: "text", title: "Andere", payload: "CHOOSE_STYLE" },
    ]);
    expect(sendImageMock).not.toHaveBeenCalled();
    expect(sendTextMock).toHaveBeenCalledTimes(2);
    expect(sendTextMock).toHaveBeenNthCalledWith(1, "openai-missing-key-user", "Ik maak nu je Disco-stijl.");
    expect(sendTextMock).toHaveBeenNthCalledWith(2, "openai-missing-key-user", "Oeps. Probeer nog een stijl.");
  });

  it("reaches OpenAI generator path with GENERATOR_MODE=openai and API key", async () => {
    process.env.GENERATOR_MODE = "openai";
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

    const sourceImage = Buffer.alloc(6000, 7);
    const generatedImageBytes = Buffer.from("fake-png").toString("base64");
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => sourceImage,
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: generatedImageBytes }] }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    try {
      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "openai-success-user" },
                message: {
                  mid: "mid-photo-openai-success",
                  attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
                },
              },
              {
                sender: { id: "openai-success-user" },
                message: { mid: "mid-style-openai-success", quick_reply: { payload: "gold" } },
              },
            ],
          },
        ],
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sendImageMock).toHaveBeenCalledWith(
      "openai-success-user",
      expect.stringMatching(/^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/[0-9a-f-]+\.jpg$/),
    );
  });




  it("keeps failure context and retries selected style with prior photo", async () => {
    process.env.GENERATOR_MODE = "openai";
    delete process.env.OPENAI_API_KEY;

    const psid = "retry-failure-user";
    const userId = anonymizePsid(psid);

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              message: {
                mid: "mid-photo-retry-failure",
                attachments: [{ type: "image", payload: { url: "https://img.example/retry.jpg" } }],
              },
            },
            {
              sender: { id: psid },
              message: { mid: "mid-style-retry-failure", quick_reply: { payload: "gold" } },
            },
          ],
        },
      ],
    });

    const failedState = getState(userId);
    expect(failedState?.stage).toBe("FAILURE");
    expect(failedState?.lastPhoto).toBe("https://img.example/retry.jpg");
    expect(failedState?.selectedStyle).toBe("gold");

    sendTextMock.mockClear();
    sendQuickRepliesMock.mockClear();

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              postback: { payload: "RETRY_STYLE_gold" },
            },
          ],
        },
      ],
    });

    const retriedState = getState(userId);
    expect(retriedState?.stage).toBe("FAILURE");
    expect(retriedState?.lastPhoto).toBe("https://img.example/retry.jpg");
    expect(retriedState?.selectedStyle).toBe("gold");
    expect(sendQuickRepliesMock).not.toHaveBeenCalledWith(
      psid,
      "What style should I use?",
      expect.anything(),
    );
    expect(sendQuickRepliesMock).not.toHaveBeenCalledWith(
      psid,
      "Pick a style using the buttons below 🙂",
      expect.anything(),
    );
    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      psid,
      "AI generation isn’t enabled yet.",
      [
        { content_type: "text", title: "Opnieuw", payload: "RETRY_STYLE_gold" },
        { content_type: "text", title: "Andere", payload: "CHOOSE_STYLE" },
      ],
    );
  });
  it("shows timeout message when OpenAI generation exceeds timeout", async () => {
    process.env.GENERATOR_MODE = "openai";
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

    const timeoutError = new Error("aborted");
    timeoutError.name = "AbortError";
    const sourceImage = Buffer.alloc(6000, 7);
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => sourceImage,
        } as Response;
      }

      throw timeoutError;
    });

    vi.stubGlobal("fetch", fetchMock);

    try {
      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "openai-timeout-user" },
                message: {
                  mid: "mid-photo-openai-timeout",
                  attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
                },
              },
              {
                sender: { id: "openai-timeout-user" },
                message: { mid: "mid-style-openai-timeout", quick_reply: { payload: "clouds" } },
              },
            ],
          },
        ],
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(sendQuickRepliesMock).toHaveBeenLastCalledWith("openai-timeout-user", "This took too long.", [
      { content_type: "text", title: "Opnieuw", payload: "RETRY_STYLE_clouds" },
      { content_type: "text", title: "Andere", payload: "CHOOSE_STYLE" },
    ]);
  });

  it("style click during generation does not start a second run", async () => {
    process.env.GENERATOR_MODE = "openai";
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

    let resolveFetch: ((value: { ok: boolean; json: () => Promise<{ data: Array<{ b64_json: string }> }> }) => void) | undefined;
    const sourceImage = Buffer.alloc(6000, 7);
    const fetchMock = vi.fn((url: string | URL) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => sourceImage,
        } as Response);
      }

      return new Promise<{ ok: boolean; json: () => Promise<{ data: Array<{ b64_json: string }> }> }>(resolve => {
        resolveFetch = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "busy-user" },
                message: {
                  mid: "mid-photo-busy",
                  attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
                },
              },
            ],
          },
        ],
      });

      const firstRun = processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "busy-user" },
                message: { mid: "mid-style-busy-1", quick_reply: { payload: "disco" } },
              },
            ],
          },
        ],
      });

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(resolveFetch).toBeTypeOf("function");
      });

      sendImageMock.mockClear();
      sendQuickRepliesMock.mockClear();
      sendTextMock.mockClear();
      safeLogMock.mockClear();

      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "busy-user" },
                message: { mid: "mid-style-busy-2", quick_reply: { payload: "gold" } },
              },
            ],
          },
        ],
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sendTextMock).toHaveBeenCalledWith("busy-user", "⏳ even geduld, ik ben nog bezig met jouw restyle");

      const generatedImageBytes = Buffer.from("fake-png").toString("base64");
      resolveFetch?.({
        ok: true,
        json: async () => ({ data: [{ b64_json: generatedImageBytes }] }),
      });
      await firstRun;
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns only in-progress status message for style changes while generating", async () => {
    process.env.GENERATOR_MODE = "openai";
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

    let resolveFetch: ((value: { ok: boolean; json: () => Promise<{ data: Array<{ b64_json: string }> }> }) => void) | undefined;
    const sourceImage = Buffer.alloc(6000, 7);
    const fetchMock = vi.fn((url: string | URL) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => sourceImage,
        } as Response);
      }

      return new Promise<{ ok: boolean; json: () => Promise<{ data: Array<{ b64_json: string }> }> }>(resolve => {
        resolveFetch = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "busy-user-text" },
                message: {
                  mid: "mid-photo-busy-text",
                  attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
                },
              },
            ],
          },
        ],
      });

      const firstRun = processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "busy-user-text" },
                message: { mid: "mid-style-busy-text-1", quick_reply: { payload: "disco" } },
              },
            ],
          },
        ],
      });

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(resolveFetch).toBeTypeOf("function");
      });

      sendImageMock.mockClear();
      sendQuickRepliesMock.mockClear();
      sendTextMock.mockClear();

      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "busy-user-text" },
                message: { mid: "mid-style-busy-text-2", quick_reply: { payload: "gold" } },
              },
            ],
          },
        ],
      });

      expect(sendTextMock.mock.calls).toEqual([
        ["busy-user-text", "⏳ even geduld, ik ben nog bezig met jouw restyle"],
      ]);
      expect(sendImageMock).not.toHaveBeenCalled();
      expect(sendQuickRepliesMock).not.toHaveBeenCalled();

      const generatedImageBytes = Buffer.from("fake-png").toString("base64");
      resolveFetch?.({
        ok: true,
        json: async () => ({ data: [{ b64_json: generatedImageBytes }] }),
      });
      await firstRun;
    } finally {
      vi.unstubAllGlobals();
    }
  });

});

describe("messenger text brain rollout", () => {
  beforeEach(() => {
    process.env.GENERATOR_MODE = "mock";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
    resetStateStore();
    resetMessengerEventDedupe();
  });

  it("keeps legacy free-text behavior when engine is legacy", async () => {
    process.env.MESSENGER_CHAT_ENGINE = "legacy";
    process.env.MESSENGER_CHAT_CANARY_PERCENT = "100";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "legacy-user" },
              message: {
                mid: "mid-legacy-photo",
                attachments: [{ type: "image", payload: { url: "https://img.example/legacy.jpg" } }],
              },
            },
            {
              sender: { id: "legacy-user" },
              message: { mid: "mid-legacy-text", text: "Wat kan ik nu doen?" },
            },
          ],
        },
      ],
    });

    expect(generateMessengerReplyMock).not.toHaveBeenCalled();
    expect(sendTextMock).toHaveBeenLastCalledWith(
      "legacy-user",
      "Stuur een foto en ik maak er een speciale versie van in een andere stijl — het is gratis.",
    );
  });

  it("uses responses engine on canary hit and passes userKey instead of raw psid", async () => {
    process.env.MESSENGER_CHAT_ENGINE = "responses";
    process.env.MESSENGER_CHAT_CANARY_PERCENT = "100";
    generateMessengerReplyMock.mockResolvedValue({
      text: "Kies een stijl via de knoppen hieronder.",
      source: "responses",
    });

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "responses-user" },
              message: {
                mid: "mid-responses-photo",
                attachments: [{ type: "image", payload: { url: "https://img.example/responses.jpg" } }],
              },
            },
            {
              sender: { id: "responses-user" },
              message: { mid: "mid-responses-text", text: "Wat kan ik nu doen?" },
            },
          ],
        },
      ],
    });

    expect(generateMessengerReplyMock).toHaveBeenCalledTimes(1);
    expect(generateMessengerReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        psid: "responses-user",
        userKey: anonymizePsid("responses-user"),
        hasPhoto: true,
        stage: "AWAITING_STYLE",
        text: "Wat kan ik nu doen?",
      }),
    );
    expect(generateMessengerReplyMock.mock.calls[0]?.[0]?.userKey).not.toBe("responses-user");
    expect(sendTextMock).toHaveBeenLastCalledWith(
      "responses-user",
      "Kies een stijl via de knoppen hieronder.",
    );
  });

  it("falls back to legacy response when canary misses", async () => {
    process.env.MESSENGER_CHAT_ENGINE = "responses";
    process.env.MESSENGER_CHAT_CANARY_PERCENT = "0";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "canary-miss-user" },
              message: {
                mid: "mid-canary-photo",
                attachments: [{ type: "image", payload: { url: "https://img.example/canary.jpg" } }],
              },
            },
            {
              sender: { id: "canary-miss-user" },
              message: { mid: "mid-canary-text", text: "Wat kan ik nu doen?" },
            },
          ],
        },
      ],
    });

    expect(generateMessengerReplyMock).not.toHaveBeenCalled();
    expect(sendTextMock).toHaveBeenLastCalledWith(
      "canary-miss-user",
      "Stuur een foto en ik maak er een speciale versie van in een andere stijl — het is gratis.",
    );
  });

  it("uses deterministic fallback text and keeps stage stable when responses falls back", async () => {
    process.env.MESSENGER_CHAT_ENGINE = "responses";
    process.env.MESSENGER_CHAT_CANARY_PERCENT = "100";
    generateMessengerReplyMock.mockResolvedValue({
      text: "Stuur gerust een foto, dan kan ik een stijl voor je maken.",
      source: "fallback",
    });

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "responses-fallback-user" },
              message: { mid: "mid-fallback-text", text: "Wie ben jij?" },
            },
          ],
        },
      ],
    });

    expect(generateMessengerReplyMock).toHaveBeenCalledTimes(1);
    expect(sendTextMock).toHaveBeenLastCalledWith(
      "responses-fallback-user",
      "Stuur gerust een foto, dan kan ik een stijl voor je maken.",
    );
    expect(getState(anonymizePsid("responses-fallback-user"))?.stage).toBe("AWAITING_PHOTO");
  });

  it("falls back to deterministic text when responses service throws", async () => {
    process.env.MESSENGER_CHAT_ENGINE = "responses";
    process.env.MESSENGER_CHAT_CANARY_PERCENT = "100";
    generateMessengerReplyMock.mockRejectedValue(new Error("boom"));

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "responses-error-user" },
              message: { mid: "mid-fallback-error", text: "Wie ben jij?" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenLastCalledWith(
      "responses-error-user",
      "Stuur gerust een foto, dan kan ik een stijl voor je maken.",
    );
    expect(getState(anonymizePsid("responses-error-user"))?.stage).toBe("AWAITING_PHOTO");
  });

  it("does not affect attachment/style/image generation path when responses engine is enabled", async () => {
    process.env.MESSENGER_CHAT_ENGINE = "responses";
    process.env.MESSENGER_CHAT_CANARY_PERCENT = "100";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "responses-image-user" },
              message: {
                mid: "mid-responses-image-photo",
                attachments: [{ type: "image", payload: { url: "https://img.example/image-path.jpg" } }],
              },
            },
            {
              sender: { id: "responses-image-user" },
              message: { mid: "mid-responses-image-style", quick_reply: { payload: "disco" } },
            },
          ],
        },
      ],
    });

    expect(generateMessengerReplyMock).not.toHaveBeenCalled();
    expect(sendImageMock).toHaveBeenCalledTimes(1);
  });
});

describe("messenger greeting behavior", () => {
  beforeEach(() => {
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
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
      "Stuur een foto en ik maak er een speciale versie van in een andere stijl — het is gratis.",
      expect.arrayContaining([
        { content_type: "text", title: "Wat doe ik?", payload: "WHAT_IS_THIS" },
        { content_type: "text", title: "Privacy", payload: "PRIVACY_INFO" },
      ]),
    );
  });

  it("ignores acknowledgement text after entering AWAITING_STYLE", async () => {
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

    expect(sendTextMock).not.toHaveBeenCalled();
    expect(sendQuickRepliesMock).toHaveBeenLastCalledWith(
      "style-user",
      "Kies je stijl 👇",
      [
        { content_type: "text", title: "🎨 Caricature", payload: "STYLE_CARICATURE" },
        { content_type: "text", title: "🌸 Petals", payload: "STYLE_PETALS" },
        { content_type: "text", title: "✨ Gold", payload: "STYLE_GOLD" },
        { content_type: "text", title: "🎬 Cinematic", payload: "STYLE_CINEMATIC" },
        { content_type: "text", title: "🪩 Disco Glow", payload: "STYLE_DISCO" },
        { content_type: "text", title: "☁️ Clouds", payload: "STYLE_CLOUDS" },
      ],
    );
  });

  it("emits one intentional response package per transition in order", async () => {
    process.env.MOCK_MODE = "true";
    process.env.GENERATOR_MODE = "mock";
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    try {
      const processing = processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "transition-order-user" },
                message: {
                  mid: "mid-transition-photo",
                  attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
                },
              },
              {
                sender: { id: "transition-order-user" },
                message: { mid: "mid-transition-style", quick_reply: { payload: "gold" } },
              },
            ],
          },
        ],
      });

      await vi.advanceTimersByTimeAsync(2000);
      await processing;

      expect(sendQuickRepliesMock).toHaveBeenNthCalledWith(
        1,
        "transition-order-user",
        "Kies je stijl 👇",
        expect.any(Array),
      );
      expect(sendTextMock).toHaveBeenCalledTimes(1);
      expect(sendTextMock).toHaveBeenCalledWith("transition-order-user", "Ik maak nu je Gold-stijl.");
      expect(sendImageMock).toHaveBeenCalledTimes(1);
      expect(sendQuickRepliesMock).toHaveBeenNthCalledWith(
        2,
        "transition-order-user",
        "Klaar ✅",
        [
          { content_type: "text", title: "Remix", payload: "REMIX_LAST" },
          { content_type: "text", title: "Nieuwe stijl", payload: "CHOOSE_STYLE" },
          { content_type: "text", title: "Privacy", payload: "PRIVACY_INFO" },
        ],
      );

      expect(sendQuickRepliesMock.mock.invocationCallOrder[0]).toBeLessThan(sendTextMock.mock.invocationCallOrder[0]);
      expect(sendTextMock.mock.invocationCallOrder[0]).toBeLessThan(sendImageMock.mock.invocationCallOrder[0]);
      expect(sendImageMock.mock.invocationCallOrder[0]).toBeLessThan(sendQuickRepliesMock.mock.invocationCallOrder[1]);
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
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
      "Klaar ✅",
      [
        { content_type: "text", title: "Remix", payload: "REMIX_LAST" },
        { content_type: "text", title: "Nieuwe stijl", payload: "CHOOSE_STYLE" },
        { content_type: "text", title: "Privacy", payload: "PRIVACY_INFO" },
      ],
    );
  });

  it("offers retry actions when state is FAILURE", async () => {
    const psid = "failure-user";
    const userId = anonymizePsid(psid);
    setFlowState(userId, "FAILURE");

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              message: { mid: "mid-failure-1", text: "Hey" },
            },
          ],
        },
      ],
    });

    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      psid,
      "Oeps. Probeer nog een stijl.",
      [
        { content_type: "text", title: "Probeer opnieuw", payload: "RETRY_STYLE" },
        { content_type: "text", title: "Andere stijl", payload: "CHOOSE_STYLE" },
      ],
    );
  });
});

describe("acknowledgement edgecases", () => {
  beforeEach(() => {
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
    resetStateStore();
    resetMessengerEventDedupe();
  });

  it("detects legacy like, short acknowledgements, and emoji", () => {
    expect(detectAck("(y)")).toBe("like");
    expect(detectAck("  jep ")).toBe("ok");
    expect(detectAck("Merci")).toBe("thanks");
    expect(detectAck("👍")).toBe("emoji");
    expect(detectAck("   ")).toBeNull();
    expect(detectAck("disco")).toBeNull();
  });

  it("ignores (y) without sending text or quick replies", async () => {
    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "ack-like-user" },
              message: { mid: "mid-ack-like", text: "(y)" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).not.toHaveBeenCalled();
    expect(sendQuickRepliesMock).not.toHaveBeenCalled();
    expect(safeLogMock).toHaveBeenCalledWith("ack_ignored", { ack: "like" });
  });

  it("ignores 👍 without sending text or quick replies", async () => {
    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "ack-emoji-user" },
              message: { mid: "mid-ack-emoji", text: "👍" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).not.toHaveBeenCalled();
    expect(sendQuickRepliesMock).not.toHaveBeenCalled();
    expect(safeLogMock).toHaveBeenCalledWith("ack_ignored", { ack: "emoji" });
  });
});

describe("bot rate limit feature", () => {
  beforeEach(() => {
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
    resetStateStore();
    resetMessengerEventDedupe();
  });

  it("blocks text spam after the configured in-memory threshold", async () => {
    const senderId = "rate-limit-user";

    for (let index = 0; index < 11; index += 1) {
      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: senderId },
                message: { mid: `mid-rate-${index}`, text: `random-${index}` },
              },
            ],
          },
        ],
      });
    }

    expect(sendTextMock).toHaveBeenLastCalledWith(
      senderId,
      "Slow down a bit before sending more messages.",
    );
  });
});

describe("bot remix feature", () => {
  beforeEach(() => {
    process.env.GENERATOR_MODE = "mock";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";
    delete process.env.APP_BASE_URL;
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
    resetStateStore();
    resetMessengerEventDedupe();
  });

  it("remixes the latest generated style when the user sends remix", async () => {
    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "remix-text-user" },
              message: {
                mid: "mid-remix-photo",
                attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
              },
            },
            {
              sender: { id: "remix-text-user" },
              message: { mid: "mid-remix-style", quick_reply: { payload: "disco" } },
            },
          ],
        },
      ],
    });

    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "remix-text-user" },
              message: { mid: "mid-remix-text-command", text: "remix" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenCalledWith(
      "remix-text-user",
      "Ik maak nu je Disco-stijl.",
    );
    expect(sendImageMock).toHaveBeenCalledWith(
      "remix-text-user",
      "http://localhost:3000/demo/05-paparazzi.png",
    );
  });

  it("supports remix with an explicit style override", async () => {
    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "remix-style-user" },
              message: {
                mid: "mid-remix-style-photo",
                attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
              },
            },
          ],
        },
      ],
    });

    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "remix-style-user" },
              message: { mid: "mid-remix-style-command", text: "remix: gold" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenCalledWith(
      "remix-style-user",
      "Ik maak nu je Gold-stijl.",
    );
    expect(sendImageMock).toHaveBeenCalledWith(
      "remix-style-user",
      "http://localhost:3000/demo/03-gold.png",
    );
  });

  it("handles the remix quick reply after a generated image", async () => {
    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "remix-payload-user" },
              message: {
                mid: "mid-remix-payload-photo",
                attachments: [{ type: "image", payload: { url: "https://img.example/source.jpg" } }],
              },
            },
            {
              sender: { id: "remix-payload-user" },
              message: { mid: "mid-remix-payload-style", quick_reply: { payload: "clouds" } },
            },
          ],
        },
      ],
    });

    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: "remix-payload-user" },
              message: { mid: "mid-remix-payload-command", quick_reply: { payload: "REMIX_LAST" } },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenCalledWith(
      "remix-payload-user",
      "Ik maak nu je Clouds-stijl.",
    );
    expect(sendImageMock).toHaveBeenCalledWith(
      "remix-payload-user",
      "http://localhost:3000/demo/06-clouds.png",
    );
  });
});
