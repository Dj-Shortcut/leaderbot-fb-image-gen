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
  }): Promise<{
    imageUrl: string;
    proof: { incomingLen: number; incomingSha256: string; openaiInputLen: number; openaiInputSha256: string };
    metrics: GenerationMetrics;
  }>;
}

export class InvalidGenerationInputError extends Error {}
export class MissingOpenAiApiKeyError extends Error {}
export class GenerationTimeoutError extends Error {}
export class OpenAiGenerationError extends Error {}
export class MissingAppBaseUrlError extends Error {}
export class MissingInputImageError extends Error {}

export type GenerationMetrics = {
  fbImageFetchMs?: number;
  openAiMs?: number;
  uploadOrServeMs?: number;
  totalMs: number;
};

type ErrorWithGenerationMetrics = Error & { generationMetrics?: GenerationMetrics };

const MIN_INPUT_IMAGE_BYTES = 5 * 1024;
const FB_IMAGE_FETCH_RETRY_LIMIT = 1;

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
  const relativeFilePath = path.posix.join("generated", `${publicId}.png`);
  const absoluteDirPath = path.resolve(process.cwd(), "public", "generated");
  const absoluteFilePath = path.resolve(process.cwd(), "public", "generated", `${publicId}.png`);

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

function getInboundImageTimeoutMs(): number {
  const raw = Number.parseInt(process.env.FB_IMAGE_FETCH_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }

  return 10_000;
}

function finalizeMetrics(startedAt: number, partial: Omit<GenerationMetrics, "totalMs"> = {}): GenerationMetrics {
  return {
    ...partial,
    totalMs: Date.now() - startedAt,
  };
}

function attachGenerationMetrics(error: unknown, metrics: GenerationMetrics): unknown {
  if (error instanceof Error) {
    (error as ErrorWithGenerationMetrics).generationMetrics = metrics;
  }

  return error;
}

export function getGenerationMetrics(error: unknown): GenerationMetrics | undefined {
  if (error instanceof Error) {
    return (error as ErrorWithGenerationMetrics).generationMetrics;
  }

  return undefined;
}

function isRetryableResponseStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error instanceof TypeError;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

class MockImageGenerator implements ImageGenerator {
  generate(input: { style: Style; sourceImageUrl?: string; userKey: string; reqId: string }): Promise<{
    imageUrl: string;
    proof: { incomingLen: number; incomingSha256: string; openaiInputLen: number; openaiInputSha256: string };
    metrics: GenerationMetrics;
  }> {
    return Promise.resolve({
      imageUrl: getMockImageForStyle(input.style),
      proof: {
        incomingLen: 0,
        incomingSha256: "",
        openaiInputLen: 0,
        openaiInputSha256: "",
      },
      metrics: {
        uploadOrServeMs: 0,
        totalMs: 0,
      },
    });
  }
}

async function downloadSourceImageOrThrow(sourceImageUrl: string, reqId: string): Promise<{
  imageBuffer: Buffer;
  contentType: string;
  incomingLen: number;
  incomingSha256: string;
  fbImageFetchMs: number;
}> {
  const timeoutMs = getInboundImageTimeoutMs();
  let totalFetchMs = 0;

  for (let attempt = 0; attempt <= FB_IMAGE_FETCH_RETRY_LIMIT; attempt += 1) {
    const attemptStartedAt = Date.now();

    try {
      const response = await fetchWithTimeout(sourceImageUrl, undefined, timeoutMs);
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";

      if (!response.ok) {
        totalFetchMs += Date.now() - attemptStartedAt;

        if (attempt < FB_IMAGE_FETCH_RETRY_LIMIT && isRetryableResponseStatus(response.status)) {
          console.debug("FB_IMAGE_FETCH_RETRY", { reqId, attempt: attempt + 1, status: response.status });
          continue;
        }

        console.error("MISSING_INPUT_IMAGE", { reqId, reason: "download_failed", status: response.status });
        throw new MissingInputImageError(`Failed to download source image (${response.status})`);
      }

      const imageBuffer = Buffer.from(await response.arrayBuffer());
      totalFetchMs += Date.now() - attemptStartedAt;
      const incomingByteLen = safeLen(imageBuffer);
      const incomingHash = sha256(imageBuffer);

      if (process.env.DEBUG_IMAGE_PROOF === "1") {
        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        const savedPath = `/tmp/leaderbot_incoming.${ext}`;
        await fs.writeFile(savedPath, imageBuffer);
        console.log("DEBUG_IMAGE_PROOF", { reqId, saved_path: savedPath });
      }

      if (incomingByteLen < MIN_INPUT_IMAGE_BYTES) {
        console.error("MISSING_INPUT_IMAGE", { reqId, reason: "too_small", byte_len: incomingByteLen });
        throw new MissingInputImageError(`Source image too small (${incomingByteLen} bytes)`);
      }

      return {
        imageBuffer,
        contentType,
        incomingLen: incomingByteLen,
        incomingSha256: incomingHash,
        fbImageFetchMs: totalFetchMs,
      };
    } catch (error) {
      if (error instanceof MissingInputImageError) {
        throw error;
      }

      totalFetchMs += Date.now() - attemptStartedAt;

      if (attempt < FB_IMAGE_FETCH_RETRY_LIMIT && isTransientNetworkError(error)) {
        console.debug("FB_IMAGE_FETCH_RETRY", {
          reqId,
          attempt: attempt + 1,
          reason: error instanceof Error ? error.name : "UnknownError",
        });
        continue;
      }

      if (isTransientNetworkError(error)) {
        console.error("MISSING_INPUT_IMAGE", {
          reqId,
          reason: error instanceof Error && error.name === "AbortError" ? "download_timeout" : "download_network_error",
        });
        throw new MissingInputImageError("Failed to download source image");
      }

      throw error;
    }
  }

  throw new MissingInputImageError("Failed to download source image");
}

export class OpenAiImageGenerator implements ImageGenerator {
  async generate(input: { style: Style; sourceImageUrl?: string; userKey: string; reqId: string }): Promise<{
    imageUrl: string;
    proof: { incomingLen: number; incomingSha256: string; openaiInputLen: number; openaiInputSha256: string };
    metrics: GenerationMetrics;
  }> {
    const startedAt = Date.now();
    const partialMetrics: Omit<GenerationMetrics, "totalMs"> = {};
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
      const { imageBuffer, contentType, incomingLen, incomingSha256, fbImageFetchMs } = await downloadSourceImageOrThrow(input.sourceImageUrl, input.reqId);
      partialMetrics.fbImageFetchMs = fbImageFetchMs;
      const openAiInputHash = sha256(imageBuffer);
      const openAiInputByteLen = safeLen(imageBuffer);

      const formData = new FormData();
      formData.set("model", "gpt-image-1");
      formData.set("prompt", `Apply ${input.style} style to this photo.`);
      formData.set("size", "1024x1024");
      formData.set("output_format", "png");
      formData.set("image", new Blob([new Uint8Array(imageBuffer)], { type: contentType }), "source-image");

      const openAiStartedAt = Date.now();
      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: formData,
        signal: controller.signal,
      });
      const openAiMs = Date.now() - openAiStartedAt;
      partialMetrics.openAiMs = openAiMs;

      if (!response.ok) {
        throw attachGenerationMetrics(
          new OpenAiGenerationError(`OpenAI request failed (${response.status} ${response.statusText})`),
          finalizeMetrics(startedAt, partialMetrics),
        );
      }

      const result = (await response.json()) as { data?: Array<{ b64_json?: string }> };
      const base64Png = result.data?.[0]?.b64_json;

      if (!base64Png) {
        throw new OpenAiGenerationError("OpenAI response did not include base64 image data");
      }

      const imageBufferResult = Buffer.from(base64Png, "base64");
      const uploadStartedAt = Date.now();
      const relativeFilePath = await persistGeneratedPng(imageBufferResult);
      const uploadOrServeMs = Date.now() - uploadStartedAt;
      partialMetrics.uploadOrServeMs = uploadOrServeMs;
      const publicBaseUrl = getRequiredPublicBaseUrl();

      return {
        imageUrl: `${publicBaseUrl}/${relativeFilePath}`,
        proof: {
          incomingLen,
          incomingSha256,
          openaiInputLen: openAiInputByteLen,
          openaiInputSha256: openAiInputHash,
        },
        metrics: finalizeMetrics(startedAt, partialMetrics),
      };
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        throw attachGenerationMetrics(
          new GenerationTimeoutError("OpenAI generation timed out"),
          finalizeMetrics(startedAt, partialMetrics),
        );
      }

      throw attachGenerationMetrics(error, finalizeMetrics(startedAt, getGenerationMetrics(error) ?? partialMetrics));
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
