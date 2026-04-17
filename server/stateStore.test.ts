import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStateStore,
  findInMemoryState,
  getOrCreateStoredState,
  readScopedState,
  readState,
  updateStoredState,
  writeScopedState,
  writeState,
} from "./_core/stateStore";

describe("stateStore memory TTL", () => {
  const originalRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    delete process.env.REDIS_URL;
    clearStateStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    clearStateStore();
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
      return;
    }

    process.env.REDIS_URL = originalRedisUrl;
  });

  it("expires scoped state in memory mode after its TTL", () => {
    writeScopedState("scope", "key", { value: 1 }, 5);

    expect(readScopedState<{ value: number }>("scope", "key")).toEqual({
      value: 1,
    });

    vi.advanceTimersByTime(5_001);

    expect(readScopedState("scope", "key")).toBeNull();
  });

  it("applies the same TTL semantics to default state writes", () => {
    writeState("user-1", { stage: "IDLE" });

    expect(readState<{ stage: string }>("user-1")).toEqual({ stage: "IDLE" });

    vi.advanceTimersByTime(172800_001);

    expect(readState("user-1")).toBeNull();
  });

  it("recreates stored state after expiry", () => {
    const first = getOrCreateStoredState("user-2", () => ({ version: 1 }));
    expect(first).toEqual({ version: 1 });

    vi.advanceTimersByTime(172800_001);

    const second = getOrCreateStoredState("user-2", () => ({ version: 2 }));
    expect(second).toEqual({ version: 2 });
  });

  it("treats expired state as null during update", () => {
    writeState("user-3", { count: 1 });
    vi.advanceTimersByTime(172800_001);

    const result = updateStoredState<{ count: number }>("user-3", current => ({
      count: current?.count ?? 99,
    }));

    expect(result).toEqual({ count: 99 });
    expect(readState("user-3")).toEqual({ count: 99 });
  });

  it("does not return expired entries from findInMemoryState", () => {
    writeScopedState("scope", "fresh", { id: "fresh" }, 10);
    writeScopedState("scope", "stale", { id: "stale" }, 1);

    vi.advanceTimersByTime(1_001);

    expect(findInMemoryState<{ id: string }>(value => value.id === "stale")).toBeNull();
    expect(findInMemoryState<{ id: string }>(value => value.id === "fresh")).toEqual({
      id: "fresh",
    });
  });

  it("clears both payloads and TTL metadata", () => {
    writeScopedState("scope", "key", { ok: true }, 10);
    clearStateStore();
    vi.advanceTimersByTime(10_001);

    expect(readScopedState("scope", "key")).toBeNull();
    expect(findInMemoryState<{ ok: boolean }>(value => value.ok)).toBeNull();
  });
});
