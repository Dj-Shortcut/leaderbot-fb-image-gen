import { STYLE_TO_DEMO_FILE, type Style } from "./messengerStyles";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

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
export class MissingAppBaseUrlError extends Error {}

function getConfiguredBaseUrl(): string | undefined {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim() ?? process.env.BASE_URL?.trim();

  if (configuredBaseUrl && /^https?:\/\//.test(configuredBaseUrl)) {
    return configuredBaseUrl.replace(/\/$/, "");
  }

  return undefined;
}

function getBaseUrl(): string {
  const configuredBaseUrl = getConfiguredBaseUrl();

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  return "http://localhost:3000";
}

function getMockImageForStyle(style: Style): string {
  const filename = STYLE_TO_DEMO_FILE[style];
  return `${getBaseUrl()}/demo/${filename}`;
}

function getGeneratorMode(): GeneratorMode {
  return process.env.GENERATOR_MODE === "mock" ? "mock" : "openai";
}

function getRequiredPublicBaseUrl(): string {
  const baseUrl = getConfiguredBaseUrl();
  if (!baseUrl) {
    console.error("APP_BASE_URL is required when GENERATOR_MODE=openai");
    throw new MissingAppBaseUrlError("APP_BASE_URL is missing or invalid");
  }

  return baseUrl;
}

async function persistGeneratedPng(buffer: Buffer): Promise<string> {
  const publicId = `${Date.now()}-${randomUUID()}`;
  const relativeFilePath = path.join("generated", `${publicId}.png`);
  const absoluteDirPath = path.resolve(process.cwd(), "public", "generated");
  const absoluteFilePath = path.resolve(process.cwd(), "public", relativeFilePath);

  await fs.mkdir(absoluteDirPath, { recursive: true });
  await fs.writeFile(absoluteFilePath, buffer);

  const stats = await fs.stat(absoluteFilePath);
  if (stats.size <= 0) {
    throw new OpenAiGenerationError("Generated image file is empty");
  }

  return relativeFilePath;
}

export function getGeneratorStartupConfig(): { mode: GeneratorMode; resolvedBaseUrl: string | undefined } {
  return {
    mode: getGeneratorMode(),
    resolvedBaseUrl: getConfiguredBaseUrl(),
  };
}

function getOpenAiTimeoutMs(): number {
  const raw = Number.parseInt(process.env.OPENAI_IMAGE_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }

  return 60_000;
}

class MockImageGenerator implements ImageGenerator {
  generate(input: { style: Style; sourceImageUrl?: string; userKey: string }): Promise<{ imageUrl: string }> {
    return Promise.resolve({
      imageUrl: getMockImageForStyle(input.style),
    });
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
          output_format: "png",
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new OpenAiGenerationError(`OpenAI request failed (${response.status} ${response.statusText})`);
      }

      const result = (await response.json()) as { data?: Array<{ b64_json?: string }> };
      const base64Png = result.data?.[0]?.b64_json;

      if (!base64Png) {
        throw new OpenAiGenerationError("OpenAI response did not include base64 image data");
      }

      const imageBuffer = Buffer.from(base64Png, "base64");
      const relativeFilePath = await persistGeneratedPng(imageBuffer);
      const publicBaseUrl = getRequiredPublicBaseUrl();

      return { imageUrl: `${publicBaseUrl}/${relativeFilePath}` };
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
