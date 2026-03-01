import { beforeEach, describe, expect, it, vi } from "vitest";
import { canGenerate, increment } from "./_core/messengerQuota";
import { getOrCreateState, resetStateStore } from "./_core/messengerState";

describe("messenger quota dayKey", () => {
  beforeEach(() => {
    resetStateStore();
    vi.useRealTimers();
  });

  it("initializes new state with the current server dayKey", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T14:30:00.000Z"));

    const state = getOrCreateState("quota-user");

    expect(state.quota.dayKey).toBe("2026-03-01");
    expect(state.quota.count).toBe(0);
  });

  it("keeps the same dayKey throughout the same UTC day", () => {
    const userId = "same-day-user";

    increment(userId, Date.parse("2026-03-01T08:00:00.000Z"));

    expect(canGenerate(userId, Date.parse("2026-03-01T23:59:59.999Z"))).toBe(false);
    expect(getOrCreateState(userId).quota).toEqual({
      dayKey: "2026-03-01",
      count: 1,
    });
  });

  it("resets quota and updates dayKey after midnight UTC", () => {
    const userId = "midnight-user";

    increment(userId, Date.parse("2026-03-01T23:59:59.999Z"));

    expect(canGenerate(userId, Date.parse("2026-03-02T00:00:00.000Z"))).toBe(true);
    expect(getOrCreateState(userId).quota).toEqual({
      dayKey: "2026-03-02",
      count: 0,
    });
  });
});
