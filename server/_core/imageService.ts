import { randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import { STYLE_TO_DEMO_FILE, type Style } from "./messengerStyles";
import fs from "fs/promises";
import path from "path";
import { safeLen, sha256 } from "./imageProof";
import { buildGeneratedImageUrl, putGeneratedImage } from "./generatedImageStore";
import { storagePut } from "../storage";

export type GeneratorMode = "mock" | "openai";

export interface ImageGenerator {
  generate(input: {
    style: Style;
    sourceImageUrl?: string;
    promptHint?: string;
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
export class InvalidSourceImageUrlError extends Error {}

export type GenerationMetrics = {
  fbImageFetchMs?: number;
  openAiMs?: number;
  uploadOrServeMs?: number;
  totalMs: number;
};

type ErrorWithGenerationMetrics = Error & { generationMetrics?: GenerationMetrics };

const MIN_INPUT_IMAGE_BYTES = 5 * 1024;
const FB_IMAGE_FETCH_RETRY_LIMIT = 1;
const OPENAI_RETRY_LIMIT_DEFAULT = 1;
const OPENAI_RETRY_BASE_MS_DEFAULT = 500;
const OPENAI_TIMEOUT_MS_DEFAULT = 30_000;

function getConfiguredBaseUrl(): string | undefined {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim() ?? process.env.BASE_URL?.trim();

  if (!configuredBaseUrl || !/^https?:\/\//.test(configuredBaseUrl)) {
    return undefined;
  }

  if (process.env.NODE_ENV === "production" && !configuredBaseUrl.startsWith("https://")) {
    console.error("APP_BASE_URL must use https:// in production", {
      hasConfiguredBaseUrl: true,
      protocol: configuredBaseUrl.split(":")[0],
    });
    return undefined;
  }

  return configuredBaseUrl.replace(/\/$/, "");
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

function buildStylePrompt(style: Style, promptHint?: string): string {
  const basePrompt =
    style === "cyberpunk"
      ? "Apply cyberpunk aesthetic, neon-lit futuristic city, glowing signs, high contrast, cinematic sci-fi atmosphere, detailed digital art to this photo."
      : `Apply ${style} style to this photo.`;

  const trimmedPromptHint = promptHint?.trim();
  if (!trimmedPromptHint) {
    return basePrompt;
  }

  return `${basePrompt} Additional direction: ${trimmedPromptHint}.`;
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

function hasObjectStorageConfig(): boolean {
  return Boolean(process.env.BUILT_IN_FORGE_API_URL?.trim() && process.env.BUILT_IN_FORGE_API_KEY?.trim());
}

async function publishGeneratedImage(jpegBuffer: Buffer, style: Style): Promise<string> {
  if (hasObjectStorageConfig()) {
    const key = `generated/${style}/${Date.now()}-${randomUUID()}.jpg`;
    const { url } = await storagePut(key, jpegBuffer, "image/jpeg");
    return url;
  }

  const token = putGeneratedImage(jpegBuffer, "image/jpeg");
  const publicBaseUrl = getRequiredPublicBaseUrl();
  return buildGeneratedImageUrl(publicBaseUrl, token);
}
function ensureJpegBuffer(buffer: Buffer): Buffer {
  return buffer;
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

  return OPENAI_TIMEOUT_MS_DEFAULT;
}

function getInboundImageTimeoutMs(): number {
  const raw = Number.parseInt(process.env.FB_IMAGE_FETCH_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }

  return 10_000;
}

function getOpenAiRetryLimit(): number {
  const raw = Number.parseInt(process.env.OPENAI_IMAGE_MAX_RETRIES ?? "", 10);
  if (Number.isFinite(raw) && raw >= 0) {
    return raw;
  }

  return OPENAI_RETRY_LIMIT_DEFAULT;
}

function getOpenAiRetryBaseMs(): number {
  const raw = Number.parseInt(process.env.OPENAI_IMAGE_RETRY_BASE_MS ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }

  return OPENAI_RETRY_BASE_MS_DEFAULT;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
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

function parseAllowedHostsFromEnv(): string[] {
  return (process.env.SOURCE_IMAGE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(x => Number(x));
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }

  const [a, b] = parts;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;

  return false;
}

function hostnameMatchesAllowedHost(hostname: string, allowedHost: string): boolean {
  return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status <= 399 && status !== 304;
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();

  if (h === "localhost" || h.endsWith(".localhost")) return true;

  const ipType = net.isIP(h);
  if (ipType === 4) return isPrivateIPv4(h);
  if (ipType === 6) {
    if (h === "::1") return true;
    if (h.startsWith("fc") || h.startsWith("fd")) return true;
    if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true;
    return true;
  }

  return false;
}

export function validateSourceImageUrlOrThrow(sourceImageUrl: string, reqId?: string): URL {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(sourceImageUrl);
  } catch {
    console.warn("SOURCE_IMAGE_URL_BLOCKED", { reqId, reason: "invalid_url" });
    throw new InvalidSourceImageUrlError("sourceImageUrl is not allowed");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (parsedUrl.protocol !== "https:") {
    console.warn("SOURCE_IMAGE_URL_BLOCKED", { reqId, reason: "non_https", protocol: parsedUrl.protocol });
    throw new InvalidSourceImageUrlError("sourceImageUrl is not allowed");
  }

  if (parsedUrl.username || parsedUrl.password) {
    console.warn("SOURCE_IMAGE_URL_BLOCKED", { reqId, reason: "credentials_in_url" });
    throw new InvalidSourceImageUrlError("sourceImageUrl is not allowed");
  }

  if (parsedUrl.port && parsedUrl.port !== "443") {
    console.warn("SOURCE_IMAGE_URL_BLOCKED", { reqId, reason: "non_standard_port", port: parsedUrl.port });
    throw new InvalidSourceImageUrlError("sourceImageUrl is not allowed");
  }

  if (isBlockedHostname(hostname)) {
    console.warn("SOURCE_IMAGE_URL_BLOCKED", { reqId, reason: "blocked_hostname", hostname });
    throw new InvalidSourceImageUrlError("sourceImageUrl is not allowed");
  }

  const allowedHosts = parseAllowedHostsFromEnv();
  if (allowedHosts.length === 0) {
    console.warn("SOURCE_IMAGE_URL_BLOCKED", { reqId, reason: "allowlist_not_configured" });
    throw new InvalidSourceImageUrlError("sourceImageUrl is not allowed");
  }

  if (!allowedHosts.some(allowedHost => hostnameMatchesAllowedHost(hostname, allowedHost))) {
    console.warn("SOURCE_IMAGE_URL_BLOCKED", { reqId, reason: "host_not_allowed", hostname });
    throw new InvalidSourceImageUrlError("sourceImageUrl is not allowed");
  }

  return parsedUrl;
}

async function fetchWithTimeout(input: URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      redirect: init?.redirect ?? "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

class MockImageGenerator implements ImageGenerator {
  generate(input: { style: Style; sourceImageUrl?: string; promptHint?: string; userKey: string; reqId: string }): Promise<{
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
  const validatedSourceImageUrl = validateSourceImageUrlOrThrow(sourceImageUrl, reqId);
  const timeoutMs = getInboundImageTimeoutMs();
  let totalFetchMs = 0;

  for (let attempt = 0; attempt <= FB_IMAGE_FETCH_RETRY_LIMIT; attempt += 1) {
    const attemptStartedAt = Date.now();

    try {
      const response = await fetchWithTimeout(validatedSourceImageUrl, { redirect: "manual" }, timeoutMs);
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";

      if (isRedirectStatus(response.status)) {
        console.warn("SOURCE_IMAGE_URL_BLOCKED", {
          reqId,
          reason: "redirect_not_allowed",
          status: response.status,
          location: response.headers.get("location") ?? undefined,
        });
        throw new InvalidSourceImageUrlError("sourceImageUrl is not allowed");
      }

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
        if (process.env.NODE_ENV === "production") {
          console.warn("DEBUG_IMAGE_PROOF is ignored in production", { reqId });
        } else {
          const ext = contentType.includes("png") ? "png" : "jpg";
          const debugDir = path.join(os.tmpdir(), "leaderbot-debug");
          const savedPath = path.join(
            debugDir,
            `leaderbot_incoming_${reqId}_${Date.now()}_${randomUUID()}.${ext}`
          );
          await fs.mkdir(debugDir, { recursive: true });
          await fs.writeFile(savedPath, imageBuffer);
          console.log("DEBUG_IMAGE_PROOF", { reqId, saved_path: savedPath });
        }
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
      if (error instanceof MissingInputImageError || error instanceof InvalidSourceImageUrlError) {
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
  async generate(input: { style: Style; sourceImageUrl?: string; promptHint?: string; userKey: string; reqId: string }): Promise<{
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

    try {
      const { imageBuffer, contentType, incomingLen, incomingSha256, fbImageFetchMs } = await downloadSourceImageOrThrow(input.sourceImageUrl, input.reqId);
      partialMetrics.fbImageFetchMs = fbImageFetchMs;
      const openAiInputHash = sha256(imageBuffer);
      const openAiInputByteLen = safeLen(imageBuffer);

      const openAiRetryLimit = getOpenAiRetryLimit();
      const openAiRetryBaseMs = getOpenAiRetryBaseMs();
      const openAiTimeoutMs = getOpenAiTimeoutMs();

      const createOpenAiFormData = (): FormData => {
        const formData = new FormData();
        const prompt = buildStylePrompt(input.style, input.promptHint);
        formData.set("model", "gpt-image-1");
        formData.set("prompt", prompt);
        formData.set("size", "1024x1024");
        formData.set("output_format", "jpeg");
        formData.set("image", new Blob([new Uint8Array(imageBuffer)], { type: contentType }), "source-image");
        return formData;
      };

      let response: Response | undefined;
      for (let attempt = 0; attempt <= openAiRetryLimit; attempt += 1) {
        const openAiStartedAt = Date.now();
        try {
          response = await fetchWithTimeout(
            new URL("https://api.openai.com/v1/images/edits"),
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              },
              body: createOpenAiFormData(),
            },
            openAiTimeoutMs,
          );
        } catch (error) {
          partialMetrics.openAiMs = (partialMetrics.openAiMs ?? 0) + (Date.now() - openAiStartedAt);
          if (attempt < openAiRetryLimit && isTransientNetworkError(error)) {
            const waitMs = openAiRetryBaseMs * 2 ** attempt;
            console.warn("OPENAI_GENERATION_RETRY", { reqId: input.reqId, attempt: attempt + 1, waitMs, reason: (error as Error).name });
            await wait(waitMs);
            continue;
          }

          throw error;
        }

        partialMetrics.openAiMs = (partialMetrics.openAiMs ?? 0) + (Date.now() - openAiStartedAt);
        if (response.ok) {
          break;
        }

        if (attempt < openAiRetryLimit && isRetryableResponseStatus(response.status)) {
          const waitMs = openAiRetryBaseMs * 2 ** attempt;
          console.warn("OPENAI_GENERATION_RETRY", { reqId: input.reqId, attempt: attempt + 1, waitMs, status: response.status });
          await wait(waitMs);
          continue;
        }

        break;
      }

      if (!response) {
        throw new OpenAiGenerationError("OpenAI request failed before receiving a response");
      }

      if (!response.ok) {
        throw attachGenerationMetrics(
          new OpenAiGenerationError(`OpenAI request failed (${response.status} ${response.statusText})`),
          finalizeMetrics(startedAt, partialMetrics),
        );
      }

      const result = (await response.json()) as { data?: Array<{ b64_json?: string }> };
      const base64Image = result.data?.[0]?.b64_json;

      if (!base64Image) {
        throw new OpenAiGenerationError("OpenAI response did not include base64 image data");
      }

      const imageBufferResult = Buffer.from(base64Image, "base64");
      if (imageBufferResult.length <= 0) {
        throw new OpenAiGenerationError("OpenAI response image data was empty after base64 decode");
      }

      const jpegBuffer = ensureJpegBuffer(imageBufferResult);
      const uploadStartedAt = Date.now();
      const imageUrl = await publishGeneratedImage(jpegBuffer, input.style);
      const uploadOrServeMs = Date.now() - uploadStartedAt;
      partialMetrics.uploadOrServeMs = uploadOrServeMs;

      return {
        imageUrl,
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
    }
  }
}

export function createImageGenerator(mode: GeneratorMode = getGeneratorMode()): { mode: GeneratorMode; generator: ImageGenerator } {
  if (mode === "openai") {
    return { mode, generator: new OpenAiImageGenerator() };
  }

  return { mode: "mock", generator: new MockImageGenerator() };
}
