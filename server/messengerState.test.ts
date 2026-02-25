import { beforeEach, describe, expect, it } from "vitest";
import { anonymizePsid, getOrCreateState, resetStateStore, setChosenStyle, setFlowState, setPendingImage } from "./_core/messengerState";

describe("messenger state flow", () => {
  beforeEach(() => {
    resetStateStore();
  });

  it("handles photo-first transition", () => {
    const userId = "photo-first-user";

    setPendingImage(userId, "https://img.example/pic.jpg", 1000);

    const state = getOrCreateState(userId);
    expect(state.stage).toBe("awaiting_style");
    expect(state.lastPhoto).toBe("https://img.example/pic.jpg");
  });

  it("handles style-first transition", () => {
    const userId = "style-first-user";

    setFlowState(userId, "idle", 1000);
    setChosenStyle(userId, "Anime", 1001);

    const state = getOrCreateState(userId);
    expect(state.stage).toBe("idle");
    expect(state.selectedStyle).toBe("Anime");
    expect(state.lastPhoto).toBeNull();
  });

  it("hashes PSID deterministically", () => {
    process.env.MESSENGER_PSID_SALT = "test-salt";

    const first = anonymizePsid("12345");
    const second = anonymizePsid("12345");
    const other = anonymizePsid("abcde");

    expect(first).toHaveLength(64);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });
});
