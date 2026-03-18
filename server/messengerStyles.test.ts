import { describe, expect, it } from "vitest";
import {
  STYLE_CONFIGS,
  STYLE_CATEGORY_CONFIGS,
  getStyleCategoryById,
  getStyleById,
  getStylesForCategory,
  isStyleCategoryPayload,
  isStylePayload,
} from "./_core/messengerStyles";

describe("messengerStyles", () => {
  it("exposes canonical style configs", () => {
    expect(STYLE_CONFIGS.map(style => style.style)).toEqual([
      "caricature",
      "storybook-anime",
      "petals",
      "gold",
      "cinematic",
      "oil-paint",
      "cyberpunk",
      "norman-blackwell",
      "disco",
      "clouds",
    ]);
  });

  it("validates and resolves style payloads", () => {
    expect(isStylePayload("STYLE_CINEMATIC")).toBe(true);
    expect(isStylePayload("STYLE_OIL_PAINT")).toBe(true);
    expect(isStylePayload("STYLE_CYBERPUNK")).toBe(true);
    expect(isStylePayload("STYLE_NORMAN_BLACKWELL")).toBe(true);
    expect(isStylePayload("STYLE_STORYBOOK_ANIME")).toBe(true);
    expect(isStylePayload("UNKNOWN_STYLE")).toBe(false);
    expect(getStyleById("STYLE_STORYBOOK_ANIME").label).toContain(
      "Storybook Anime"
    );
    expect(getStyleById("STYLE_OIL_PAINT").label).toContain("Oil Paint");
    expect(getStyleById("STYLE_CYBERPUNK").label).toContain("Cyberpunk");
    expect(getStyleById("STYLE_NORMAN_BLACKWELL").label).toContain(
      "Norman Blackwell"
    );
    expect(getStyleById("STYLE_DISCO").label).toContain("Disco");
  });

  it("exposes style categories and maps styles into them", () => {
    expect(STYLE_CATEGORY_CONFIGS.map(category => category.category)).toEqual([
      "illustrated",
      "atmosphere",
      "bold",
    ]);
    expect(isStyleCategoryPayload("STYLE_CATEGORY_ILLUSTRATED")).toBe(true);
    expect(isStyleCategoryPayload("STYLE_CATEGORY_BOLD")).toBe(true);
    expect(isStyleCategoryPayload("STYLE_CATEGORY_UNKNOWN")).toBe(false);
    expect(getStyleCategoryById("STYLE_CATEGORY_ATMOSPHERE").label).toContain(
      "Atmosphere"
    );
    expect(getStylesForCategory("illustrated").map(style => style.style)).toEqual([
      "caricature",
      "storybook-anime",
      "oil-paint",
      "norman-blackwell",
    ]);
  });
});
