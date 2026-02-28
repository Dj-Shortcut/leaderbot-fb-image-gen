import { beforeEach, describe, expect, it } from "vitest";
import {
  anonymizePsid,
  getOrCreateState,
  getQuickRepliesForState,
  resetStateStore,
  setChosenStyle,
  setFlowState,
  setPendingImage,
} from "./_core/messengerState";

describe("messenger state flow", () => {
  beforeEach(() => {
    resetStateStore();
  });

  it("handles photo-first transition", () => {
    const userId = "photo-first-user";

    setPendingImage(userId, "https://img.example/pic.jpg", 1000);

    const state = getOrCreateState(userId);
    expect(state.stage).toBe("AWAITING_STYLE");
    expect(state.lastPhoto).toBe("https://img.example/pic.jpg");
  });

  it("handles style-first transition", () => {
    const userId = "style-first-user";

    setFlowState(userId, "IDLE", 1000);
    setChosenStyle(userId, "Anime", 1001);

    const state = getOrCreateState(userId);
    expect(state.stage).toBe("IDLE");
    expect(state.selectedStyle).toBe("Anime");
    expect(state.lastPhoto).toBeNull();
  });

  it("maps quick replies by state", () => {
    expect(getQuickRepliesForState("IDLE")).toEqual([
      { title: "Wat doe ik?", payload: "WHAT_IS_THIS" },
      { title: "Privacy", payload: "PRIVACY_INFO" },
    ]);
    expect(getQuickRepliesForState("AWAITING_PHOTO")).toEqual([]);
    expect(getQuickRepliesForState("AWAITING_STYLE")).toEqual([
      { title: "🎨 Caricature", payload: "STYLE_CARICATURE" },
      { title: "🌸 Petals", payload: "STYLE_PETALS" },
      { title: "✨ Gold", payload: "STYLE_GOLD" },
      { title: "🎬 Cinematic", payload: "STYLE_CINEMATIC" },
      { title: "🪩 Disco Glow", payload: "STYLE_DISCO" },
      { title: "☁️ Clouds", payload: "STYLE_CLOUDS" },
    ]);
    expect(getQuickRepliesForState("PROCESSING")).toEqual([]);
    expect(getQuickRepliesForState("RESULT_READY")).toEqual([
      { title: "Nieuwe stijl", payload: "CHOOSE_STYLE" },
      { title: "Privacy", payload: "PRIVACY_INFO" },
    ]);
    expect(getQuickRepliesForState("FAILURE")).toEqual([
      { title: "Probeer opnieuw", payload: "RETRY_STYLE" },
      { title: "Andere stijl", payload: "CHOOSE_STYLE" },
    ]);
  });

  it("hashes PSID deterministically", () => {
    process.env.PRIVACY_PEPPER = "test-pepper";

    const first = anonymizePsid("12345");
    const second = anonymizePsid("12345");
    const other = anonymizePsid("abcde");

    expect(first).toHaveLength(64);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });
});
