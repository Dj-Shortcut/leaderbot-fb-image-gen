import { afterEach, describe, expect, it } from "vitest";
import { getChatRolloutDecision } from "./_core/chatRollout";

const originalEngine = process.env.MESSENGER_CHAT_ENGINE;
const originalCanary = process.env.MESSENGER_CHAT_CANARY_PERCENT;

afterEach(() => {
  if (originalEngine === undefined) {
    delete process.env.MESSENGER_CHAT_ENGINE;
  } else {
    process.env.MESSENGER_CHAT_ENGINE = originalEngine;
  }

  if (originalCanary === undefined) {
    delete process.env.MESSENGER_CHAT_CANARY_PERCENT;
  } else {
    process.env.MESSENGER_CHAT_CANARY_PERCENT = originalCanary;
  }
});

describe("chat rollout", () => {
  it("defaults to legacy engine and zero canary", () => {
    delete process.env.MESSENGER_CHAT_ENGINE;
    delete process.env.MESSENGER_CHAT_CANARY_PERCENT;

    const decision = getChatRolloutDecision("user-key-1");
    expect(decision.engine).toBe("legacy");
    expect(decision.canaryPercent).toBe(0);
    expect(decision.useResponses).toBe(false);
  });

  it("enables all users when responses engine is set with 100% canary", () => {
    process.env.MESSENGER_CHAT_ENGINE = "responses";
    process.env.MESSENGER_CHAT_CANARY_PERCENT = "100";

    const decision = getChatRolloutDecision("user-key-2");
    expect(decision.engine).toBe("responses");
    expect(decision.useResponses).toBe(true);
  });

  it("keeps rollout deterministic for the same user key", () => {
    process.env.MESSENGER_CHAT_ENGINE = "responses";
    process.env.MESSENGER_CHAT_CANARY_PERCENT = "10";

    const first = getChatRolloutDecision("stable-user-key");
    const second = getChatRolloutDecision("stable-user-key");

    expect(first.bucket).toBe(second.bucket);
    expect(first.useResponses).toBe(second.useResponses);
  });

  it("produces mixed selection at 10% canary", () => {
    process.env.MESSENGER_CHAT_ENGINE = "responses";
    process.env.MESSENGER_CHAT_CANARY_PERCENT = "10";

    const decisions = Array.from({ length: 200 }, (_, index) =>
      getChatRolloutDecision(`user-key-${index}`)
    );
    const enabledCount = decisions.filter(item => item.useResponses).length;

    expect(enabledCount).toBeGreaterThan(0);
    expect(enabledCount).toBeLessThan(decisions.length);
  });
});

