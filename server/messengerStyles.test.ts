import { describe, expect, it } from "vitest";
import { STYLE_TO_DEMO_FILE, getDemoThumbnailUrl, type Style } from "./_core/messengerStyles";

describe("STYLE_TO_DEMO_FILE", () => {
  it("maps canonical styles to the expected demo files", () => {
    const expected: Record<Style, string> = {
      caricature: "01-caricature.png",
      petals: "02-petals.png",
      gold: "03-gold.png",
      cinematic: "04-crayon.png",
      disco: "05-paparazzi.png",
      clouds: "06-clouds.png",
    };

    expect(STYLE_TO_DEMO_FILE).toEqual(expected);
  });

  it("builds demo thumbnail URLs from mapped files", () => {
    expect(getDemoThumbnailUrl("cinematic")).toBe("/demo/04-crayon.png");
    expect(getDemoThumbnailUrl("disco")).toBe("/demo/05-paparazzi.png");
  });
});
