import { afterEach, describe, expect, it } from "vitest";
import {
  createImageGenerator,
  getGeneratorStartupConfig,
  OpenAiImageGenerator,
} from "./_core/imageService";

const originalImageProvider = process.env.IMAGE_PROVIDER;

describe("image provider boundary", () => {
  afterEach(() => {
    if (originalImageProvider === undefined) {
      delete process.env.IMAGE_PROVIDER;
    } else {
      process.env.IMAGE_PROVIDER = originalImageProvider;
    }
  });

  it("defaults to the current OpenAI Images provider", () => {
    delete process.env.IMAGE_PROVIDER;

    const result = createImageGenerator();

    expect(result.mode).toBe("openai-images");
    expect(result.generator).toBeInstanceOf(OpenAiImageGenerator);
    expect(getGeneratorStartupConfig().mode).toBe("openai-images");
  });

  it("fails fast for unknown image providers", () => {
    process.env.IMAGE_PROVIDER = "openai-responses-image";

    expect(() => createImageGenerator()).toThrow(
      'Unsupported IMAGE_PROVIDER "openai-responses-image". Expected "openai-images".'
    );
  });
});
