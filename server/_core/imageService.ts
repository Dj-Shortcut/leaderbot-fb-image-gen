import { randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import { type Style } from "./messengerStyles";
import fs from "fs/promises";
import path from "path";
import { safeLen, sha256 } from "./imageProof";
import {
  attachGenerationMetrics,
  buildOpenAiRequest,
  fetchOpenAiImageResponse,
  finalizeGenerationMetrics,
  getGenerationMetrics,
  OpenAiBudgetExceededError,
  OpenAiGenerationError,
  parseOpenAiImageResponse,
  type GenerationMetrics,
} from "./image-generation/openAiImageClient";
import {
  buildGeneratedImageUrl,
  putGeneratedImage,
} from "./generatedImageStore";
import { storagePut } from "../storage";

type GeneratorMode = "openai";

interface ImageGenerator {
  generate(input: {
    style: Style;
    sourceImageUrl?: string;
    trustedSourceImageUrl?: boolean;
    sourceImageProvenance?: "storeInbound";
    sourceImageData?: {
      buffer: Buffer;
      contentType: string;
    };
    promptHint?: string;
    userKey: string;
    reqId: string;
  }): Promise<{
    imageUrl: string;
    proof: {
      incomingLen: number;
      incomingSha256: string;
      openaiInputLen: number;
      openaiInputSha256: string;
    };
    metrics: GenerationMetrics;
  }>;
}

class InvalidGenerationInputError extends Error {}
export class MissingOpenAiApiKeyError extends Error {}
export class GenerationTimeoutError extends Error {}
export class MissingAppBaseUrlError extends Error {}
export class MissingObjectStorageConfigError extends Error {}
export class MissingInputImageError extends Error {}
export class InvalidSourceImageUrlError extends Error {}

function getSourceUrlDiagnostics(sourceImageUrl: string): {
  hostname?: string;
  protocol?: string;
} {
  try {
    const parsed = new URL(sourceImageUrl);
    return {
      hostname: parsed.hostname.toLowerCase(),
      protocol: parsed.protocol,
    };
  } catch {
    return {};
  }
}

type SourceImageData = {
  buffer: Buffer;
  contentType: string;
};

type DownloadedSourceImage = SourceImageData & {
  incomingLen: number;
  incomingSha256: string;
  fbImageFetchMs: number;
};

type GeneratorInput = {
  style: Style;
  sourceImageUrl?: string;
  trustedSourceImageUrl?: boolean;
  sourceImageProvenance?: "storeInbound";
  sourceImageData?: {
    buffer: Buffer;
    contentType: string;
  };
  promptHint?: string;
  userKey: string;
  reqId: string;
};

type PreparedGenerationInput = {
  hasSourceImage: boolean;
  prompt: string;
  sourceImage: DownloadedSourceImage;
};

type SourceImageDownloadOptions = {
  trustedSourceImageUrl?: boolean;
  sourceImageProvenance?: "storeInbound";
};

type SourceImageFetchAttemptResult = {
  response: Response;
  contentType: string;
};

const MIN_INPUT_IMAGE_BYTES = 5 * 1024;
const MAX_INBOUND_IMAGE_BYTES = 20 * 1024 * 1024;
const FB_IMAGE_FETCH_RETRY_LIMIT = 1;
function getConfiguredBaseUrl(): string | undefined {
  const configuredBaseUrl =
    process.env.APP_BASE_URL?.trim() ?? process.env.BASE_URL?.trim();

  if (!configuredBaseUrl || !/^https?:\/\//.test(configuredBaseUrl)) {
    return undefined;
  }

  if (
    process.env.NODE_ENV === "production" &&
    !configuredBaseUrl.startsWith("https://")
  ) {
    console.error("APP_BASE_URL must use https:// in production", {
      hasConfiguredBaseUrl: true,
      protocol: configuredBaseUrl.split(":")[0],
    });
    return undefined;
  }

  return configuredBaseUrl.replace(/\/$/, "");
}

function getRequiredPublicBaseUrl(): string {
  const baseUrl = getConfiguredBaseUrl();
  if (!baseUrl) {
    console.error("APP_BASE_URL is required for image generation");
    throw new MissingAppBaseUrlError("APP_BASE_URL is missing or invalid");
  }

  return baseUrl;
}

function hasObjectStorageConfig(): boolean {
  return Boolean(
    process.env.BUILT_IN_FORGE_API_URL?.trim() &&
    process.env.BUILT_IN_FORGE_API_KEY?.trim()
  );
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function assertProductionImageStorageConfig(): void {
  if (!isProductionRuntime()) {
    return;
  }

  if (!hasObjectStorageConfig()) {
    throw new MissingObjectStorageConfigError(
      "BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY are required in production for durable generated image storage"
    );
  }
}

async function publishGeneratedImage(
  jpegBuffer: Buffer,
  style: Style,
  reqId?: string
): Promise<string> {
  if (hasObjectStorageConfig()) {
    const key = `generated/${style}/${Date.now()}-${randomUUID()}.jpg`;
    try {
      const { url } = await storagePut(key, jpegBuffer, "image/jpeg");
      console.info(
        JSON.stringify({
          level: "info",
          msg: "generated_image_upload_success",
          reqId,
          style,
          storageKey: key,
          publicUrl: url,
        })
      );
      return url;
    } catch (error) {
      console.error("GENERATED_IMAGE_UPLOAD_FAILED", {
        reqId,
        style,
        storageKey: key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  if (isProductionRuntime()) {
    throw new MissingObjectStorageConfigError(
      "BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY are required in production for durable generated image storage"
    );
  }

  const token = putGeneratedImage(jpegBuffer, "image/jpeg");
  const publicBaseUrl = getRequiredPublicBaseUrl();
  const localUrl = buildGeneratedImageUrl(publicBaseUrl, token);
  console.warn("GENERATED_IMAGE_LOCAL_FALLBACK", {
    reqId,
    style,
    token,
    publicUrl: localUrl,
  });
  return localUrl;
}
function ensureJpegBuffer(buffer: Buffer): Buffer {
  return buffer;
}

export function getGeneratorStartupConfig(): {
  mode: GeneratorMode;
  resolvedBaseUrl: string | undefined;
  objectStorageEnabled: boolean;
  requiresDurableStorageInProduction: boolean;
} {
  return {
    mode: "openai",
    resolvedBaseUrl: getConfiguredBaseUrl(),
    objectStorageEnabled: hasObjectStorageConfig(),
    requiresDurableStorageInProduction: true,
  };
}

const STYLE_PROMPTS = {
  caricature:
    "Transform this photo into a high-end caricature portrait with playfully exaggerated facial proportions, crisp inked contours, dimensional cel-shaded rendering, punchy studio key lighting, a saturated carnival palette of cherry red, cobalt, tangerine, and teal, and an energetic mischievous mood with polished illustration detail.",
  "storybook-anime":
    "Transform this photo into a whimsical hand-drawn fantasy illustration with a warm storybook atmosphere. Preserve the subject identity while rendering the image as a soft, painterly animated scene with delicate linework, hand-painted background sensibility, lush natural greens and sun-washed earth tones, gentle expressive eyes, subtly simplified anatomy, cozy fantasy details, soft daylight or golden-hour lighting, and a nostalgic magical mood. The result should feel like a lovingly crafted illustrated animation frame with a warm human touch, clearly non-photorealistic and never like a generic photo filter.",
  "afroman-americana":
    "Transform this photo into a premium stylized portrait in an Afroman-inspired Americana look. Preserve the subject identity and facial features while dressing them in a tailored American flag suit with bold retro Americana energy, a relaxed victorious expression, crisp silhouette, polished illustrative rendering, rich red white and blue color balance, iconic stage charisma, and a clean composition.",
  gold:
    "Reimagine this portrait as a luxe gilded editorial artwork with molten gold highlights, champagne and amber color grading, sculpted rim lighting, glossy reflective surfaces, regal opulent mood, and ultra-detailed rendered textures that feel like a premium fashion campaign dipped in liquid metal.",
  petals:
    "Turn this image into a romantic floral fantasy portrait surrounded by drifting blossom petals, luminous backlighting, a soft pastel palette of rose, blush, ivory, and fresh green, dreamy springtime mood, velvety skin rendering, and richly detailed painterly depth with graceful motion in every petal.",
  clouds:
    "Render this portrait as an ethereal skyborne scene wrapped in layered clouds, diffused sunrise lighting, airy gradients of pearl white, pale blue, silver, and warm peach, serene uplifting mood, soft atmospheric depth, and finely rendered cinematic detail that blends realism with dreamlike softness.",
  cinematic:
    "Reframe this photo as a prestige-film still with dramatic directional lighting, deep shadows, subtle lens bloom, a refined teal-and-amber palette, moody emotionally charged atmosphere, shallow depth of field, and richly detailed photoreal rendering with premium color-graded cinema texture.",
  disco:
    "Convert this portrait into a glamorous disco-era hero shot with mirror-ball reflections, magenta and electric blue spotlights, glittering highlights, a bold nightlife palette of fuchsia, violet, cyan, and chrome, euphoric dance-floor mood, and glossy high-detail rendering full of sparkle and motion.",
  cyberpunk:
    "Transform this photo into a cyberpunk portrait with neon signage glow, rain-slick reflections, intense high-contrast lighting, a vivid palette of electric pink, cyan, ultraviolet, and toxic blue, rebellious futuristic mood, and dense digital-art rendering packed with atmospheric sci-fi detail.",
  "oil-paint":
    "Render this portrait as a classical oil painting with visible brush strokes, textured canvas grain, sculpted painterly lighting, a rich museum-grade palette of umber, ochre, crimson, and deep blue, dignified fine-art mood, and layered artisanal detail throughout the composition.",
  "norman-blackwell":
    "Reimagine this photo as a nostalgic mid-century American editorial illustration with warm storybook lighting, an all-American palette of cream, brick red, muted teal, and honey gold, heartfelt small-town mood, painterly realism, expressive character detail, and the polished finish of a vintage family magazine cover from the 1940s or 1950s.",
} satisfies Record<Style, string>;

function buildStylePrompt(style: Style, promptHint?: string): string {
  const basePrompt = STYLE_PROMPTS[style];

  const trimmedPromptHint = promptHint?.trim();
  if (!trimmedPromptHint) {
    return basePrompt;
  }

  return `${basePrompt} Additional direction: ${trimmedPromptHint}.`;
}

function getInboundImageTimeoutMs(): number {
  const raw = Number.parseInt(process.env.FB_IMAGE_FETCH_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }

  return 10_000;
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
  if (
    parts.length !== 4 ||
    parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
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

function hostnameMatchesAllowedHost(
  hostname: string,
  allowedHost: string
): boolean {
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
    if (
      h.startsWith("fe8") ||
      h.startsWith("fe9") ||
      h.startsWith("fea") ||
      h.startsWith("feb")
    )
      return true;
    return true;
  }

  return false;
}

function blockSourceImageUrl(
  reqId: string | undefined,
  reason: string,
  details: Record<string, unknown> = {}
): never {
  console.warn("SOURCE_IMAGE_URL_BLOCKED", {
    reqId,
    reason,
    ...details,
  });
  throw new InvalidSourceImageUrlError("sourceImageUrl is not allowed");
}

function validateSourceImageUrlOrThrow(
  sourceImageUrl: string,
  reqId?: string,
  options?: SourceImageDownloadOptions
): URL {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(sourceImageUrl);
  } catch {
    return blockSourceImageUrl(reqId, "invalid_url");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (parsedUrl.protocol !== "https:") {
    return blockSourceImageUrl(reqId, "non_https", {
      protocol: parsedUrl.protocol,
    });
  }

  if (parsedUrl.username || parsedUrl.password) {
    return blockSourceImageUrl(reqId, "credentials_in_url");
  }

  if (parsedUrl.port && parsedUrl.port !== "443") {
    return blockSourceImageUrl(reqId, "non_standard_port", {
      port: parsedUrl.port,
    });
  }

  if (isBlockedHostname(hostname)) {
    return blockSourceImageUrl(reqId, "blocked_hostname", {
      hostname,
    });
  }

  const allowTrustedSourceBypass =
    options?.trustedSourceImageUrl === true &&
    options.sourceImageProvenance === "storeInbound";

  if (!allowTrustedSourceBypass) {
    const allowedHosts = parseAllowedHostsFromEnv();
    if (allowedHosts.length === 0) {
      return blockSourceImageUrl(reqId, "allowlist_not_configured");
    }

    if (
      !allowedHosts.some(allowedHost =>
        hostnameMatchesAllowedHost(hostname, allowedHost)
      )
    ) {
      return blockSourceImageUrl(reqId, "host_not_allowed", {
        hostname,
      });
    }
  }

  return parsedUrl;
}

async function fetchSourceImageAttempt(
  sourceImageUrl: URL,
  timeoutMs: number
): Promise<SourceImageFetchAttemptResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  let response: Response;
  try {
    response = await fetch(sourceImageUrl, {
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  return {
    response,
    contentType:
      response.headers.get("content-type") ?? "application/octet-stream",
  };
}

function assertNoRedirectResponse(
  response: Response,
  reqId: string
): void {
  if (!isRedirectStatus(response.status)) {
    return;
  }

  blockSourceImageUrl(reqId, "redirect_not_allowed", {
    status: response.status,
    location: response.headers.get("location") ?? undefined,
  });
}

function shouldRetrySourceImageStatus(
  attempt: number,
  response: Response,
  reqId: string
): boolean {
  if (
    attempt < FB_IMAGE_FETCH_RETRY_LIMIT &&
    isRetryableResponseStatus(response.status)
  ) {
    console.debug("FB_IMAGE_FETCH_RETRY", {
      reqId,
      attempt: attempt + 1,
      status: response.status,
    });
    return true;
  }

  return false;
}

function throwMissingInputDownloadFailed(
  reqId: string,
  status: number
): never {
  console.error("MISSING_INPUT_IMAGE", {
    reqId,
    reason: "download_failed",
    status,
  });
  throw new MissingInputImageError(
    `Failed to download source image (${status})`
  );
}

async function maybeWriteDebugImageProof(
  reqId: string,
  contentType: string,
  imageBuffer: Buffer
): Promise<void> {
  if (process.env.DEBUG_IMAGE_PROOF !== "1") {
    return;
  }

  if (process.env.NODE_ENV === "production") {
    console.warn("DEBUG_IMAGE_PROOF is ignored in production", { reqId });
    return;
  }

  const ext = contentType.includes("png") ? "png" : "jpg";
  const debugDir = path.join(os.tmpdir(), "leaderbot-debug");
  const safeReqId = reqId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "req";
  const savedPath = path.join(
    debugDir,
    `leaderbot_incoming_${safeReqId}_${Date.now()}_${randomUUID()}.${ext}`
  );
  try {
    await fs.mkdir(debugDir, { recursive: true });
    await fs.writeFile(savedPath, imageBuffer);
    console.log("DEBUG_IMAGE_PROOF", { reqId, saved_path: savedPath });
  } catch (error) {
    console.warn("DEBUG_IMAGE_PROOF_WRITE_FAILED", {
      reqId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function assertSourceImageSizeOrThrow(
  reqId: string,
  incomingByteLen: number
): void {
  if (incomingByteLen >= MIN_INPUT_IMAGE_BYTES) {
    return;
  }

  console.error("MISSING_INPUT_IMAGE", {
    reqId,
    reason: "too_small",
    byte_len: incomingByteLen,
  });
  throw new MissingInputImageError(
    `Source image too small (${incomingByteLen} bytes)`
  );
}

function assertInboundImageWithinLimit(
  reqId: string,
  incomingByteLen: number
): void {
  if (incomingByteLen <= MAX_INBOUND_IMAGE_BYTES) {
    return;
  }

  console.error("MISSING_INPUT_IMAGE", {
    reqId,
    reason: "too_large",
    byte_len: incomingByteLen,
    max_byte_len: MAX_INBOUND_IMAGE_BYTES,
  });
  throw new MissingInputImageError(
    `Source image too large (${incomingByteLen} bytes)`
  );
}

async function readResponseBufferWithinLimit(
  reqId: string,
  response: Response
): Promise<Buffer> {
  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = Number.parseInt(contentLengthHeader ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > 0) {
    try {
      assertInboundImageWithinLimit(reqId, contentLength);
    } catch (error) {
      await response.body?.cancel();
      throw error;
    }
  }

  if (!response.body) {
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    assertInboundImageWithinLimit(reqId, safeLen(imageBuffer));
    return imageBuffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    totalBytes += value.byteLength;
    try {
      assertInboundImageWithinLimit(reqId, totalBytes);
    } catch (error) {
      await reader.cancel();
      throw error;
    }
    chunks.push(value);
  }

  return Buffer.concat(
    chunks.map(chunk =>
      Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    )
  );
}

async function buildDownloadedSourceImage(
  reqId: string,
  contentType: string,
  response: Response,
  totalFetchMs: number
): Promise<DownloadedSourceImage> {
  const imageBuffer = await readResponseBufferWithinLimit(reqId, response);
  const incomingByteLen = safeLen(imageBuffer);
  const incomingHash = sha256(imageBuffer);

  await maybeWriteDebugImageProof(reqId, contentType, imageBuffer);
  assertSourceImageSizeOrThrow(reqId, incomingByteLen);

  return {
    buffer: imageBuffer,
    contentType,
    incomingLen: incomingByteLen,
    incomingSha256: incomingHash,
    fbImageFetchMs: totalFetchMs,
  };
}

function shouldRetrySourceImageError(
  attempt: number,
  error: unknown,
  reqId: string
): boolean {
  if (attempt < FB_IMAGE_FETCH_RETRY_LIMIT && isTransientNetworkError(error)) {
    console.debug("FB_IMAGE_FETCH_RETRY", {
      reqId,
      attempt: attempt + 1,
      reason: error instanceof Error ? error.name : "UnknownError",
    });
    return true;
  }

  return false;
}

function rethrowSourceImageError(error: unknown, reqId: string): never {
  if (
    error instanceof MissingInputImageError ||
    error instanceof InvalidSourceImageUrlError
  ) {
    throw error;
  }

  if (isTransientNetworkError(error)) {
    console.error("MISSING_INPUT_IMAGE", {
      reqId,
      reason:
        error instanceof Error && error.name === "AbortError"
          ? "download_timeout"
          : "download_network_error",
    });
    throw new MissingInputImageError("Failed to download source image");
  }

  throw error;
}

async function downloadSourceImageOrThrow(
  sourceImageUrl: string,
  reqId: string,
  options?: SourceImageDownloadOptions
): Promise<DownloadedSourceImage> {
  const validatedSourceImageUrl = validateSourceImageUrlOrThrow(
    sourceImageUrl,
    reqId,
    options
  );
  const timeoutMs = getInboundImageTimeoutMs();
  let totalFetchMs = 0;

  for (let attempt = 0; attempt <= FB_IMAGE_FETCH_RETRY_LIMIT; attempt += 1) {
    const attemptStartedAt = Date.now();

    try {
      const { response, contentType } = await fetchSourceImageAttempt(
        validatedSourceImageUrl,
        timeoutMs
      );
      assertNoRedirectResponse(response, reqId);

      if (!response.ok) {
        totalFetchMs += Date.now() - attemptStartedAt;
        if (shouldRetrySourceImageStatus(attempt, response, reqId)) {
          continue;
        }
        throwMissingInputDownloadFailed(reqId, response.status);
      }

      totalFetchMs += Date.now() - attemptStartedAt;
      return buildDownloadedSourceImage(
        reqId,
        contentType,
        response,
        totalFetchMs
      );
    } catch (error) {
      totalFetchMs += Date.now() - attemptStartedAt;
      if (shouldRetrySourceImageError(attempt, error, reqId)) {
        continue;
      }
      rethrowSourceImageError(error, reqId);
    }
  }

  throw new MissingInputImageError("Failed to download source image");
}

function normalizeProvidedSourceImage(
  sourceImageData: SourceImageData
): DownloadedSourceImage {
  return {
    buffer: sourceImageData.buffer,
    contentType: sourceImageData.contentType,
    incomingLen: safeLen(sourceImageData.buffer),
    incomingSha256: sha256(sourceImageData.buffer),
    fbImageFetchMs: 0,
  };
}

function logSourceImageFetchStart(input: GeneratorInput): void {
  if (!input.sourceImageUrl) {
    return;
  }

  console.info("SOURCE_IMAGE_FETCH_START", {
    reqId: input.reqId,
    trustedSourceImageUrl: Boolean(input.trustedSourceImageUrl),
    sourceImageProvenance: input.sourceImageProvenance,
    ...getSourceUrlDiagnostics(input.sourceImageUrl),
  });
}

async function resolveSourceImage(
  input: GeneratorInput
): Promise<DownloadedSourceImage> {
  if (input.sourceImageData) {
    return normalizeProvidedSourceImage(input.sourceImageData);
  }

  if (!input.sourceImageUrl) {
    return normalizeProvidedSourceImage({
      buffer: Buffer.from([]),
      contentType: "image/jpeg",
    });
  }

  return downloadSourceImageOrThrow(input.sourceImageUrl, input.reqId, {
    trustedSourceImageUrl: input.trustedSourceImageUrl,
    sourceImageProvenance: input.sourceImageProvenance,
  });
}

async function prepareGenerationInput(
  input: GeneratorInput
): Promise<PreparedGenerationInput> {
  logSourceImageFetchStart(input);

  return {
    hasSourceImage: Boolean(input.sourceImageUrl || input.sourceImageData),
    prompt: buildStylePrompt(input.style, input.promptHint),
    sourceImage: await resolveSourceImage(input),
  };
}

export class OpenAiImageGenerator implements ImageGenerator {
  async generate(input: GeneratorInput): Promise<{
    imageUrl: string;
    proof: {
      incomingLen: number;
      incomingSha256: string;
      openaiInputLen: number;
      openaiInputSha256: string;
    };
    metrics: GenerationMetrics;
  }> {
    const startedAt = Date.now();
    const partialMetrics: Omit<GenerationMetrics, "totalMs"> = {};
    if (!input.style) {
      throw new InvalidGenerationInputError("Style is required");
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new MissingOpenAiApiKeyError("OPENAI_API_KEY is missing");
    }

    try {
      const preparedInput = await prepareGenerationInput(input);
      const sourceImage = preparedInput.sourceImage;
      partialMetrics.fbImageFetchMs = sourceImage.fbImageFetchMs;

      const incomingLen = preparedInput.hasSourceImage ? sourceImage.incomingLen : 0;
      const incomingSha256 = preparedInput.hasSourceImage
        ? sourceImage.incomingSha256
        : sha256(Buffer.from([]));
      const openAiInputHash = preparedInput.hasSourceImage
        ? sha256(sourceImage.buffer)
        : incomingSha256;
      const openAiInputByteLen = preparedInput.hasSourceImage
        ? safeLen(sourceImage.buffer)
        : 0;

      const response = await fetchOpenAiImageResponse(buildOpenAiRequest({
        prompt: preparedInput.prompt,
        sourceImage,
        hasSourceImage: preparedInput.hasSourceImage,
      }), {
        reqId: input.reqId,
        startedAt,
        partialMetrics,
      });

      const imageBufferResult = await parseOpenAiImageResponse(response);

      const jpegBuffer = ensureJpegBuffer(imageBufferResult);
      const uploadStartedAt = Date.now();
      const imageUrl = await publishGeneratedImage(
        jpegBuffer,
        input.style,
        input.reqId
      );
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
        metrics: finalizeGenerationMetrics(startedAt, partialMetrics),
      };
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        throw attachGenerationMetrics(
          new GenerationTimeoutError("OpenAI generation timed out"),
          finalizeGenerationMetrics(startedAt, partialMetrics)
        );
      }

      throw attachGenerationMetrics(
        error,
        finalizeGenerationMetrics(
          startedAt,
          getGenerationMetrics(error) ?? partialMetrics
        )
      );
    }
  }
}

export function createImageGenerator(mode: GeneratorMode = "openai"): {
  mode: GeneratorMode;
  generator: ImageGenerator;
} {
  return { mode, generator: new OpenAiImageGenerator() };
}

export { getGenerationMetrics, OpenAiBudgetExceededError };
