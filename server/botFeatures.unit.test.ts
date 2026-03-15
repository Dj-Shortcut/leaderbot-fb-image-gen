import { describe, expect, it, vi } from "vitest";
import { ensureDefaultBotFeaturesRegistered } from "./_core/bot/defaultFeatures";
import { remixFeature } from "./_core/bot/features/remixFeature";
import { rateLimitFeature } from "./_core/bot/features/rateLimitFeature";
import { styleCommandsFeature } from "./_core/bot/features/styleCommandsFeature";
import type { BotTextContext } from "./_core/botContext";
import type { MessengerUserState } from "./_core/messengerState";
import { resetStateStore } from "./_core/messengerState";

function makeState(overrides: Partial<MessengerUserState> = {}): MessengerUserState {
  return {
    psid: "p1",
    userKey: "u1",
    stage: "IDLE",
    state: "IDLE",
    lastPhotoUrl: null,
    lastPhoto: null,
    selectedStyle: null,
    chosenStyle: null,
    hasSeenIntro: false,
    lastGeneratedUrl: null,
    quota: { dayKey: "2026-01-01", count: 0 },
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeContext(overrides: Partial<BotTextContext> = {}): BotTextContext {
  return {
    senderId: "p1",
    userId: "u1",
    reqId: "req-1",
    lang: "en",
    state: makeState(),
    messageText: "remix: neon rain",
    normalizedText: "remix: neon rain",
    hasPhoto: false,
    sendText: vi.fn(async () => undefined),
    sendImage: vi.fn(async () => undefined),
    sendQuickReplies: vi.fn(async () => undefined),
    sendStateQuickReplies: vi.fn(async () => undefined),
    preselectStyle: vi.fn(async () => undefined),
    chooseStyle: vi.fn(async () => undefined),
    runStyleGeneration: vi.fn(async () => undefined),
    getRuntimeStats: () => ({
      date: "2026-01-01",
      imagesGeneratedToday: 0,
      activeUsersToday: 0,
      errorCountToday: 0,
      averageGenerationLatencyMs: null,
    }),
    logger: console,
    ...overrides,
  };
}

describe("default feature registration", () => {
  it("is idempotent across repeated calls", () => {
    expect(() => {
      ensureDefaultBotFeaturesRegistered();
      ensureDefaultBotFeaturesRegistered();
    }).not.toThrow();
  });
});

describe("styleCommandsFeature", () => {
  it("accepts /style cyberpunk and delegates style selection", async () => {
    const chooseStyle = vi.fn(async () => undefined);
    const context = makeContext({
      state: makeState({
        lastPhotoUrl: "https://img.example/source.jpg",
        lastPhoto: "https://img.example/source.jpg",
      }),
      messageText: "/style cyberpunk",
      normalizedText: "/style cyberpunk",
      chooseStyle,
    });

    const handled = await styleCommandsFeature.onText?.(context);

    expect(handled).toEqual({ handled: true });
    expect(chooseStyle).toHaveBeenCalledWith("cyberpunk");
  });

  it("confirms style changes when no photo context exists yet", async () => {
    const sendText = vi.fn(async () => undefined);
    const preselectStyle = vi.fn(async () => undefined);
    const chooseStyle = vi.fn(async () => undefined);
    const context = makeContext({
      messageText: "style: cyberpunk",
      normalizedText: "style: cyberpunk",
      sendText,
      preselectStyle,
      chooseStyle,
    });

    await styleCommandsFeature.onText?.(context);

    expect(preselectStyle).toHaveBeenCalledWith("cyberpunk");
    expect(sendText).toHaveBeenCalledWith("✅ Style set to cyberpunk.");
    expect(chooseStyle).not.toHaveBeenCalled();
  });

  it("falls through on invalid style commands", async () => {
    const chooseStyle = vi.fn(async () => undefined);
    const context = makeContext({
      messageText: "/style vaporwave",
      normalizedText: "/style vaporwave",
      chooseStyle,
    });

    const handled = await styleCommandsFeature.onText?.(context);

    expect(handled).toEqual({ handled: false });
    expect(chooseStyle).not.toHaveBeenCalled();
  });
});

describe("remixFeature", () => {
  it("remixes from last source photo and combines prompt context", async () => {
    const runStyleGeneration = vi.fn(async () => undefined);
    const context = makeContext({
      state: makeState({
        lastGeneratedUrl: "https://app.example/generated.jpg",
        lastPhotoUrl: "https://img.example/source.jpg",
        lastStyle: "caricature",
        lastPrompt: "more contrast",
      }),
      runStyleGeneration,
      messageText: "remix: cyberpunk neon rain",
      normalizedText: "remix: cyberpunk neon rain",
      hasPhoto: true,
    });

    const handled = await remixFeature.onText?.(context);

    expect(handled).toEqual({ handled: true });
    expect(runStyleGeneration).toHaveBeenCalledWith(
      "caricature",
      "https://img.example/source.jpg",
      "more contrast | cyberpunk neon rain",
    );
  });
});

describe("rateLimitFeature", () => {
  it("resets the in-memory bucket after the 60 second window", async () => {
    resetStateStore();

    const sendText = vi.fn(async () => undefined);
    const baseTime = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now");

    try {
      nowSpy.mockReturnValue(baseTime);
      for (let index = 0; index < 11; index += 1) {
        await rateLimitFeature.onText?.(
          makeContext({
            senderId: "rate-limit-memory-user",
            userId: "u-rate",
            messageText: `hello-${index}`,
            normalizedText: `hello-${index}`,
            sendText,
          })
        );
      }

      expect(sendText).toHaveBeenCalledTimes(1);

      sendText.mockClear();
      nowSpy.mockReturnValue(baseTime + 61_000);

      const result = await rateLimitFeature.onText?.(
        makeContext({
          senderId: "rate-limit-memory-user",
          userId: "u-rate",
          messageText: "fresh-window",
          normalizedText: "fresh-window",
          sendText,
        })
      );

      expect(result).toEqual({ handled: false });
      expect(sendText).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });
});
