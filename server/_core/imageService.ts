import { randomUUID } from "node:crypto";
import { type Style } from "./messengerStyles";
import { safeLen, sha256 } from "./imageProof";
import {
  attachGenerationMetrics,
  buildOpenAiRequest,
  fetchOpenAiImageResponse,
  finalizeGenerationMetrics,
  getGenerationMetrics,
  OpenAiBudgetExceededError,
  parseOpenAiImageResponse,
  type GenerationMetrics,
} from "./image-generation/openAiImageClient";
import { buildStylePrompt } from "./image-generation/promptBuilder";
import {
  type DownloadedSourceImage,
  InvalidSourceImageUrlError,
  logSourceImageFetchStart,
  MissingInputImageError,
  resolveStoredSourceImage,
  type SourceImageData,
} from "./image-generation/sourceImageFetcher";
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

async function prepareGenerationInput(
  input: GeneratorInput
): Promise<PreparedGenerationInput> {
  // TODO: collapse this orchestration into a dedicated ImageService once prompt and source-image paths are fully extracted.
  logSourceImageFetchStart(input);

  return {
    hasSourceImage: Boolean(input.sourceImageUrl || input.sourceImageData),
    prompt: buildStylePrompt(input.style, input.promptHint),
    sourceImage: await resolveStoredSourceImage(input),
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

// TEMP: backward-compatibility re-exports during caller migration away from imageService.ts.
export {
  getGenerationMetrics,
  InvalidSourceImageUrlError,
  MissingInputImageError,
  OpenAiBudgetExceededError,
};
