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

import {
  detectAck,
  processFacebookWebhookPayload,
  resetMessengerEventDedupe,
  summarizeWebhook,
} from "./_core/messengerWebhook";
import { anonymizePsid, getState, resetStateStore, setFlowState } from "./_core/messengerState";


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
    process.env.PRIVACY_PEPPER = "test-pepper";
    process.env.GENERATOR_MODE = "mock";
    delete process.env.OPENAI_API_KEY;
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
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
                  message: { mid: `mid-style-${style}`, text: style },
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
                message: { mid: "mid-style-1", text: "disco" },
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
        "Done. What do you want next?",
        [
          { content_type: "text", title: "Try another style", payload: "CHOOSE_STYLE" },
          { content_type: "text", title: "New photo", payload: "SEND_PHOTO" },
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
              message: { mid: "mid-style-openai-missing", text: "disco" },
            },
          ],
        },
      ],
    });

    expect(sendTextMock).toHaveBeenNthCalledWith(3, "openai-missing-key-user", "⚠️ I couldn’t generate this style right now.");
    expect(sendTextMock).toHaveBeenNthCalledWith(4, "openai-missing-key-user", "You can try again or pick a different style.");
    expect(sendQuickRepliesMock).toHaveBeenLastCalledWith(
      "openai-missing-key-user",
      "Choose an option:",
      [
        { content_type: "text", title: "Retry Disco", payload: "RETRY_STYLE_disco" },
        { content_type: "text", title: "Choose another style", payload: "CHOOSE_STYLE" },
      ],
    );
    expect(sendImageMock).not.toHaveBeenCalled();
    expect(safeLogMock).toHaveBeenCalledWith("generation_start", expect.objectContaining({ style: "disco", mode: "openai" }));
    expect(safeLogMock).toHaveBeenCalledWith("generation_fail", expect.objectContaining({ mode: "openai", errorClass: "MissingOpenAiApiKeyError" }));
  });

  it("reaches OpenAI generator path with GENERATOR_MODE=openai and API key", async () => {
    process.env.GENERATOR_MODE = "openai";
    process.env.OPENAI_API_KEY = "dummy-key";

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ url: "https://cdn.example/generated.png" }] }),
    }));

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
                message: { mid: "mid-style-openai-success", text: "gold" },
              },
            ],
          },
        ],
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalled();
    expect(sendImageMock).toHaveBeenCalledWith("openai-success-user", "https://cdn.example/generated.png");
    expect(safeLogMock).toHaveBeenCalledWith("generation_start", expect.objectContaining({ style: "gold", mode: "openai" }));
    expect(safeLogMock).toHaveBeenCalledWith("generation_success", expect.objectContaining({ mode: "openai" }));
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
              message: { mid: "mid-style-retry-failure", text: "gold" },
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
      "Choose an option:",
      [
        { content_type: "text", title: "Retry Gold", payload: "RETRY_STYLE_gold" },
        { content_type: "text", title: "Choose another style", payload: "CHOOSE_STYLE" },
      ],
    );
    expect(safeLogMock).toHaveBeenCalledWith("generation_start", expect.objectContaining({ style: "gold", mode: "openai" }));
  });
  it("shows timeout message when OpenAI generation exceeds timeout", async () => {
    process.env.GENERATOR_MODE = "openai";
    process.env.OPENAI_API_KEY = "dummy-key";

    const timeoutError = new Error("aborted");
    timeoutError.name = "AbortError";
    const fetchMock = vi.fn(async () => {
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
                message: { mid: "mid-style-openai-timeout", text: "clouds" },
              },
            ],
          },
        ],
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(sendTextMock).toHaveBeenNthCalledWith(3, "openai-timeout-user", "⚠️ I couldn’t generate this style right now.");
    expect(sendTextMock).toHaveBeenNthCalledWith(4, "openai-timeout-user", "You can try again or pick a different style.");
    expect(safeLogMock).toHaveBeenCalledWith("generation_fail", expect.objectContaining({ mode: "openai", errorClass: "GenerationTimeoutError" }));
  });

});

describe("messenger greeting behavior", () => {
  beforeEach(() => {
    process.env.PRIVACY_PEPPER = "test-pepper";
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
      "Welcome 👋 Pick a quick start.",
      expect.arrayContaining([
        { content_type: "text", title: "Send photo", payload: "START_PHOTO" },
        { content_type: "text", title: "What is this?", payload: "WHAT_IS_THIS" },
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

    expect(sendTextMock).toHaveBeenCalledWith("style-user", "Photo received ✅");
    expect(sendQuickRepliesMock).toHaveBeenLastCalledWith(
      "style-user",
      "What style should I use?",
      [
        { content_type: "text", title: "Caricature", payload: "caricature" },
        { content_type: "text", title: "Petals", payload: "petals" },
        { content_type: "text", title: "Gold", payload: "gold" },
        { content_type: "text", title: "Cinematic", payload: "cinematic" },
        { content_type: "text", title: "Disco", payload: "disco" },
        { content_type: "text", title: "Clouds", payload: "clouds" },
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

describe("acknowledgement edgecases", () => {
  beforeEach(() => {
    process.env.PRIVACY_PEPPER = "test-pepper";
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
