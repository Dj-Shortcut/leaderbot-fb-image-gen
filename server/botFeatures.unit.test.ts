import { describe, expect, it, vi } from "vitest";
import { ensureDefaultBotFeaturesRegistered } from "./_core/bot/defaultFeatures";
import { remixFeature } from "./_core/bot/features/remixFeature";
import type { BotFeatureContext } from "./_core/bot/features";
import type { MessengerUserState } from "./_core/messengerState";

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

function makeContext(overrides: Partial<BotFeatureContext> = {}): BotFeatureContext {
  return {
    psid: "p1",
    userId: "u1",
    reqId: "req-1",
    lang: "en",
    state: makeState(),
    text: "remix: neon rain",
    sendText: vi.fn(async () => undefined),
    sendImage: vi.fn(async () => undefined),
    sendStateQuickReplies: vi.fn(async () => undefined),
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
      text: "remix: cyberpunk neon rain",
    });

    const handled = await remixFeature.onText?.(context);

    expect(handled).toBe(true);
    expect(runStyleGeneration).toHaveBeenCalledWith(
      "caricature",
      "https://img.example/source.jpg",
      "more contrast | cyberpunk neon rain",
    );
  });
});
