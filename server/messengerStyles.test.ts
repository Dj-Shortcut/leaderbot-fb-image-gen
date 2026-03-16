import { describe, expect, it } from "vitest";
import { STYLE_CONFIGS, getStyleById, isStylePayload } from "./_core/messengerStyles";

describe("messengerStyles", () => {
  it("exposes canonical style configs", () => {
    expect(STYLE_CONFIGS.map(style => style.style)).toEqual([
      "caricature",
      "petals",
      "gold",
      "cinematic",
      "cyberpunk",
      "disco",
      "clouds",
    ]);
  });

  it("validates and resolves style payloads", () => {
    expect(isStylePayload("STYLE_CINEMATIC")).toBe(true);
    expect(isStylePayload("STYLE_CYBERPUNK")).toBe(true);
    expect(isStylePayload("UNKNOWN_STYLE")).toBe(false);
    expect(getStyleById("STYLE_CYBERPUNK").label).toContain("Cyberpunk");
    expect(getStyleById("STYLE_DISCO").label).toContain("Disco");
  });
});
