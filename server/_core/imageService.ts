import { STYLE_TO_DEMO_FILE, type Style } from "./messengerStyles";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { safeLen, sha256 } from "./imageProof";

export type GeneratorMode = "mock" | "openai";

export interface ImageGenerator {
  generate(input: {
    style: Style;
    sourceImageUrl?: string;
    userKey: string;
    reqId: string;
  }): Promise<{ imageUrl: string }>;
}

export class InvalidGenerationInputError extends Error {}
export class MissingOpenAiApiKeyError extends Error {}
export class GenerationTimeoutError extends Error {}
export class OpenAiGenerationError extends Error {}
export class MissingAppBaseUrlError extends Error {}
export class MissingInputImageError extends Error {}

const MIN_INPUT_IMAGE_BYTES = 5 * 1024;

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
  generate(input: { style: Style; sourceImageUrl?: string; userKey: string; reqId: string }): Promise<{ imageUrl: string }> {
    return Promise.resolve({
      imageUrl: getMockImageForStyle(input.style),
    });
  }
}

async function downloadSourceImageOrThrow(sourceImageUrl: string, reqId: string): Promise<{ imageBuffer: Buffer; contentType: string }> {
  const response = await fetch(sourceImageUrl);
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";

  if (!response.ok) {
    console.error("MISSING_INPUT_IMAGE", { reqId, reason: "download_failed", status: response.status });
    throw new MissingInputImageError(`Failed to download source image (${response.status})`);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const incomingByteLen = safeLen(imageBuffer);
  const incomingHash = sha256(imageBuffer);

  console.log("IMAGE_PROOF", {
    reqId,
    proof_stage: "incoming",
    content_type: contentType,
    byte_len: incomingByteLen,
    sha256: incomingHash,
  });

  if (process.env.DEBUG_IMAGE_PROOF === "1") {
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const savedPath = `/tmp/leaderbot_incoming.${ext}`;
    await fs.writeFile(savedPath, imageBuffer);
    console.log("IMAGE_PROOF", { reqId, proof_stage: "incoming", saved_path: savedPath });
  }

  if (incomingByteLen < MIN_INPUT_IMAGE_BYTES) {
    console.error("MISSING_INPUT_IMAGE", { reqId, reason: "too_small", byte_len: incomingByteLen });
    throw new MissingInputImageError(`Source image too small (${incomingByteLen} bytes)`);
  }

  return { imageBuffer, contentType };
}

export class OpenAiImageGenerator implements ImageGenerator {
  async generate(input: { style: Style; sourceImageUrl?: string; userKey: string; reqId: string }): Promise<{ imageUrl: string }> {
    if (!input.style) {
      throw new InvalidGenerationInputError("Style is required");
    }

    if (!input.sourceImageUrl) {
      console.error("MISSING_INPUT_IMAGE", { reqId: input.reqId, reason: "missing_source_url" });
      throw new MissingInputImageError("sourceImageUrl is required");
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new MissingOpenAiApiKeyError("OPENAI_API_KEY is missing");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, getOpenAiTimeoutMs());

    try {
      const { imageBuffer, contentType } = await downloadSourceImageOrThrow(input.sourceImageUrl, input.reqId);
      const openAiInputHash = sha256(imageBuffer);
      const openAiInputByteLen = safeLen(imageBuffer);

      console.log("IMAGE_PROOF", {
        reqId: input.reqId,
        proof_stage: "openai_input",
        byte_len: openAiInputByteLen,
        sha256: openAiInputHash,
      });

      const formData = new FormData();
      formData.set("model", "gpt-image-1");
      formData.set("prompt", `Apply ${input.style} style to this photo.`);
      formData.set("size", "1024x1024");
      formData.set("output_format", "png");
      formData.set("image", new Blob([imageBuffer], { type: contentType }), "source-image");

      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: formData,
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

      const imageBufferResult = Buffer.from(base64Png, "base64");
      const relativeFilePath = await persistGeneratedPng(imageBufferResult);
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
