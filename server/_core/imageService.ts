import { type Style } from "./messengerStyles";
import { safeLen, sha256 } from "./imageProof";
import {
  attachGenerationMetrics,
  buildOpenAiRequest,
  fetchOpenAiImageResponse,
  finalizeGenerationMetrics,
  getGenerationMetrics,
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
  assertProductionImageStorageConfig,
  getConfiguredBaseUrl,
  hasObjectStorageConfig,
} from "./image-generation/imageServiceConfig";
import { publishGeneratedImage } from "./image-generation/generatedImagePublisher";
import {
  GenerationTimeoutError,
  InvalidGenerationInputError,
  MissingOpenAiApiKeyError,
  MissingAppBaseUrlError,
  MissingObjectStorageConfigError,
} from "./image-generation/imageServiceErrors";
import { createLogger } from "./logger";

export const OPENAI_IMAGES_PROVIDER = "openai-images" as const;
export type ImageProvider = typeof OPENAI_IMAGES_PROVIDER;

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

function ensureJpegBuffer(buffer: Buffer): Buffer {
  return buffer;
}

export function getGeneratorStartupConfig(): {
  mode: ImageProvider;
  resolvedBaseUrl: string | undefined;
  objectStorageEnabled: boolean;
  requiresDurableStorageInProduction: boolean;
} {
  return {
    mode: getImageProvider(),
    resolvedBaseUrl: getConfiguredBaseUrl(),
    objectStorageEnabled: hasObjectStorageConfig(),
    requiresDurableStorageInProduction: true,
  };
}

function getImageProvider(): ImageProvider {
  const configured = process.env.IMAGE_PROVIDER?.trim();
  if (!configured) {
    return OPENAI_IMAGES_PROVIDER;
  }

  if (configured === OPENAI_IMAGES_PROVIDER) {
    return configured;
  }

  throw new Error(
    `Unsupported IMAGE_PROVIDER "${configured}". Expected "${OPENAI_IMAGES_PROVIDER}".`
  );
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

function logImageProviderUsed(input: GeneratorInput): void {
  createLogger({ reqId: input.reqId }).info({
    msg: "image_provider_used",
    provider: OPENAI_IMAGES_PROVIDER,
    hasSourceImage: Boolean(input.sourceImageUrl || input.sourceImageData),
  });
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

    logImageProviderUsed(input);

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

export function createImageGenerator(provider: ImageProvider = getImageProvider()): {
  mode: ImageProvider;
  generator: ImageGenerator;
} {
  return { mode: provider, generator: new OpenAiImageGenerator() };
}

export {
  getGenerationMetrics,
};
