import { describe, expect, it, beforeEach } from "vitest";
import { getOrCreateState, resetStateStore, setChosenStyle, setFlowState, setPendingImage } from "./_core/messengerState";

describe("messenger state flow", () => {
  beforeEach(() => {
    resetStateStore();
  });

  it("handles photo-first transition", () => {
    const psid = "photo-first-user";

    setPendingImage(psid, "https://img.example/pic.jpg", 1000);

    const state = getOrCreateState(psid);
    expect(state.state).toBe("awaiting_style");
    expect(state.lastPhotoUrl).toBe("https://img.example/pic.jpg");
  });

  it("handles style-first transition", () => {
    const psid = "style-first-user";

    setFlowState(psid, "awaiting_photo", 1000);
    setChosenStyle(psid, "Anime", 1001);

    const state = getOrCreateState(psid);
    expect(state.state).toBe("awaiting_photo");
    expect(state.chosenStyle).toBe("Anime");
    expect(state.lastPhotoUrl).toBeUndefined();
  });
});
