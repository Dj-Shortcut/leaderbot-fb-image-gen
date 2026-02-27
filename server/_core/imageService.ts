import { STYLE_TO_DEMO_FILE, type Style } from "./messengerStyles";

export type GeneratorMode = "mock" | "openai";

export interface ImageGenerator {
  generate(input: {
    style: Style;
    sourceImageUrl?: string;
    userKey: string;
  }): Promise<{ imageUrl: string }>;
}

export class InvalidGenerationInputError extends Error {}
export class MissingOpenAiApiKeyError extends Error {}
export class GenerationTimeoutError extends Error {}
export class OpenAiGenerationError extends Error {}

function getBaseUrl(): string {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim() ?? process.env.BASE_URL?.trim();

  if (configuredBaseUrl && /^https?:\/\//.test(configuredBaseUrl)) {
    return configuredBaseUrl;
  }

  return "http://localhost:3000";
}

function getMockImageForStyle(style: Style): string {
  const filename = STYLE_TO_DEMO_FILE[style];
  return `${getBaseUrl()}/demo/${filename}`;
}

function getGeneratorMode(): GeneratorMode {
  return process.env.GENERATOR_MODE === "openai" ? "openai" : "mock";
}

function getOpenAiTimeoutMs(): number {
  const raw = Number.parseInt(process.env.OPENAI_IMAGE_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }

  return 60_000;
}

class MockImageGenerator implements ImageGenerator {
  async generate(input: { style: Style; sourceImageUrl?: string; userKey: string }): Promise<{ imageUrl: string }> {
    return {
      imageUrl: getMockImageForStyle(input.style),
    };
  }
}

export class OpenAiImageGenerator implements ImageGenerator {
  async generate(input: { style: Style; sourceImageUrl?: string; userKey: string }): Promise<{ imageUrl: string }> {
    if (!input.style) {
      throw new InvalidGenerationInputError("Style is required");
    }

    if (!input.sourceImageUrl) {
      throw new InvalidGenerationInputError("sourceImageUrl is required");
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new MissingOpenAiApiKeyError("OPENAI_API_KEY is missing");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, getOpenAiTimeoutMs());

    try {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: `Apply ${input.style} style to this photo URL: ${input.sourceImageUrl}`,
          size: "1024x1024",
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new OpenAiGenerationError(`OpenAI request failed (${response.status} ${response.statusText})`);
      }

      const result = (await response.json()) as { data?: Array<{ url?: string }> };
      const imageUrl = result.data?.[0]?.url;

      if (!imageUrl) {
        throw new OpenAiGenerationError("OpenAI response did not include an image URL");
      }

      return { imageUrl };
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        throw new GenerationTimeoutError("OpenAI generation timed out");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createImageGenerator(mode: GeneratorMode = getGeneratorMode()): { mode: GeneratorMode; generator: ImageGenerator } {
  if (mode === "openai") {
    return { mode, generator: new OpenAiImageGenerator() };
  }

  return { mode: "mock", generator: new MockImageGenerator() };
}
