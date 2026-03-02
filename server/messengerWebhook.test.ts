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
    expect(sendTextMock).not.toHaveBeenCalled();
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

    expect(sendQuickRepliesMock).toHaveBeenCalledTimes(1);
    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      "echo-user",
      "Dank je. Kies hieronder een stijl.",
      expect.any(Array),
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
        "Klaar. Je kan de afbeelding opslaan door erop te tikken.",
        [
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
              message: { mid: "mid-style-openai-missing", text: "disco" },
            },
          ],
        },
      ],
    });

    expect(sendQuickRepliesMock).toHaveBeenLastCalledWith("openai-missing-key-user", "AI generation isn’t enabled yet.", [
      { content_type: "text", title: "Retry this style", payload: "disco" },
      { content_type: "text", title: "Andere stijl", payload: "CHOOSE_STYLE" },
    ]);
    expect(sendImageMock).not.toHaveBeenCalled();
    expect(sendTextMock).toHaveBeenCalledTimes(2);
    expect(sendTextMock).toHaveBeenNthCalledWith(1, "openai-missing-key-user", "Ik maak nu je Disco-stijl.");
    expect(sendTextMock).toHaveBeenNthCalledWith(2, "openai-missing-key-user", "Er ging iets mis bij het maken van je afbeelding. Kies gerust opnieuw een stijl.");
  });

  it("reaches OpenAI generator path with GENERATOR_MODE=openai and API key", async () => {
    process.env.GENERATOR_MODE = "openai";
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

    const sourceImage = Buffer.alloc(6000, 7);
    const generatedImageBytes = Buffer.from("fake-png").toString("base64");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://img.example/source.jpg") {
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
                message: { mid: "mid-style-openai-success", text: "gold" },
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
      expect.stringMatching(/^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/leaderbot-[a-z0-9-]+-\d+\.jpg$/),
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
      "AI generation isn’t enabled yet.",
      [
        { content_type: "text", title: "Retry this style", payload: "gold" },
        { content_type: "text", title: "Andere stijl", payload: "CHOOSE_STYLE" },
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
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://img.example/source.jpg") {
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
                message: { mid: "mid-style-openai-timeout", text: "clouds" },
              },
            ],
          },
        ],
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(sendQuickRepliesMock).toHaveBeenLastCalledWith("openai-timeout-user", "This took too long.", [
      { content_type: "text", title: "Retry this style", payload: "clouds" },
      { content_type: "text", title: "Andere stijl", payload: "CHOOSE_STYLE" },
    ]);
  });

  it("style click during generation does not start a second run", async () => {
    process.env.GENERATOR_MODE = "openai";
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

    let resolveFetch: ((value: { ok: boolean; json: () => Promise<{ data: Array<{ b64_json: string }> }> }) => void) | undefined;
    const sourceImage = Buffer.alloc(6000, 7);
    const fetchMock = vi.fn((url: string) => {
      if (url === "https://img.example/source.jpg") {
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

      await Promise.resolve();

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
      expect(sendTextMock).toHaveBeenCalledWith("busy-user", "Ik ben nog bezig met je vorige afbeelding.");

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
    const fetchMock = vi.fn((url: string) => {
      if (url === "https://img.example/source.jpg") {
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
                message: { mid: "mid-style-busy-text-1", text: "disco" },
              },
            ],
          },
        ],
      });

      await Promise.resolve();

      sendImageMock.mockClear();
      sendQuickRepliesMock.mockClear();
      sendTextMock.mockClear();

      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: "busy-user-text" },
                message: { mid: "mid-style-busy-text-2", text: "gold" },
              },
            ],
          },
        ],
      });

      expect(sendTextMock.mock.calls).toEqual([
        ["busy-user-text", "Ik ben nog bezig met je vorige afbeelding."],
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

describe("messenger greeting behavior", () => {
  beforeEach(() => {
    process.env.PRIVACY_PEPPER = "test-pepper";
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
      "Dank je. Kies hieronder een stijl.",
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
                message: { mid: "mid-transition-style", text: "gold" },
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
        "Dank je. Kies hieronder een stijl.",
        expect.any(Array),
      );
      expect(sendTextMock).toHaveBeenCalledTimes(1);
      expect(sendTextMock).toHaveBeenCalledWith("transition-order-user", "Ik maak nu je Gold-stijl.");
      expect(sendImageMock).toHaveBeenCalledTimes(1);
      expect(sendQuickRepliesMock).toHaveBeenNthCalledWith(
        2,
        "transition-order-user",
        "Klaar. Je kan de afbeelding opslaan door erop te tikken.",
        [
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
      "Klaar. Je kan de afbeelding opslaan door erop te tikken.",
      [
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
      "Er ging iets mis bij het maken van je afbeelding. Kies gerust opnieuw een stijl.",
      [
        { content_type: "text", title: "Probeer opnieuw", payload: "RETRY_STYLE" },
        { content_type: "text", title: "Andere stijl", payload: "CHOOSE_STYLE" },
      ],
    );
  });
});

describe("acknowledgement edgecases", () => {
  beforeEach(() => {
    process.env.PRIVACY_PEPPER = "test-pepper";
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
