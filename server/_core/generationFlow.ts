import {
  createImageGenerator,
  GenerationTimeoutError,
  getGenerationMetrics,
  InvalidSourceImageUrlError,
  MissingAppBaseUrlError,
  MissingInputImageError,
  MissingObjectStorageConfigError,
  MissingOpenAiApiKeyError,
  OpenAiBudgetExceededError,
} from "./imageService";
import type { SourceImageOrigin } from "./messengerState";
import type { Style } from "./messengerStyles";

type GenerationProof = {
  incomingLen: number;
  incomingSha256: string;
  openaiInputLen: number;
  openaiInputSha256: string;
};

type GenerationMetrics = NonNullable<ReturnType<typeof getGenerationMetrics>> | {
  totalMs: number;
  fbImageFetchMs?: number;
  openAiMs?: number;
  uploadOrServeMs?: number;
};

export type GenerationFlowSuccess = {
  kind: "success";
  imageUrl: string;
  metrics: GenerationMetrics;
  proof: GenerationProof;
  mode: "openai";
  resolvedSourceImageUrl: string;
  trustedSourceImageUrl: boolean;
};

export type GenerationFlowFailureKind =
  | "missing_source_image"
  | "invalid_source_image"
  | "missing_input_image"
  | "generation_unavailable"
  | "generation_timeout"
  | "generation_budget_reached"
  | "generation_failed";

export type GenerationFlowFailure = {
  kind: "error";
  errorKind: GenerationFlowFailureKind;
  error: unknown;
  metrics?: GenerationMetrics;
  resolvedSourceImageUrl?: string;
  trustedSourceImageUrl: boolean;
};

export type GenerationFlowResult =
  | GenerationFlowSuccess
  | GenerationFlowFailure;

type ExecuteGenerationFlowInput = {
  style: Style;
  userId: string;
  reqId: string;
  promptHint?: string;
  sourceImageUrl?: string;
  lastPhotoUrl?: string | null;
  lastPhotoSource?: SourceImageOrigin | null;
};

function classifyGenerationError(error: unknown): GenerationFlowFailureKind {
  if (error instanceof InvalidSourceImageUrlError) {
    return "invalid_source_image";
  }

  if (error instanceof MissingInputImageError) {
    return "missing_input_image";
  }

  if (
    error instanceof MissingOpenAiApiKeyError ||
    error instanceof MissingAppBaseUrlError ||
    error instanceof MissingObjectStorageConfigError
  ) {
    return "generation_unavailable";
  }

  if (error instanceof GenerationTimeoutError) {
    return "generation_timeout";
  }

  if (error instanceof OpenAiBudgetExceededError) {
    return "generation_budget_reached";
  }

  return "generation_failed";
}

export async function executeGenerationFlow(
  input: ExecuteGenerationFlowInput
): Promise<GenerationFlowResult> {
  const resolvedSourceImageUrl = input.sourceImageUrl ?? input.lastPhotoUrl ?? undefined;
  const trustedSourceImageUrl =
    resolvedSourceImageUrl !== undefined &&
    resolvedSourceImageUrl === input.lastPhotoUrl &&
    input.lastPhotoSource === "stored";

  if (!resolvedSourceImageUrl) {
    return {
      kind: "error",
      errorKind: "missing_source_image",
      error: new MissingInputImageError("Missing source image"),
      trustedSourceImageUrl,
    };
  }

  if (!trustedSourceImageUrl) {
    return {
      kind: "error",
      errorKind: "invalid_source_image",
      error: new InvalidSourceImageUrlError(
        "Only stored source images are allowed in generation flow"
      ),
      resolvedSourceImageUrl,
      trustedSourceImageUrl,
    };
  }

  const { mode, generator } = createImageGenerator();

  try {
    const { imageUrl, proof, metrics } = await generator.generate({
      style: input.style,
      sourceImageUrl: resolvedSourceImageUrl,
      trustedSourceImageUrl,
      sourceImageProvenance: trustedSourceImageUrl ? "storeInbound" : undefined,
      promptHint: input.promptHint,
      userKey: input.userId,
      reqId: input.reqId,
    });

    return {
      kind: "success",
      imageUrl,
      metrics,
      proof,
      mode,
      resolvedSourceImageUrl,
      trustedSourceImageUrl,
    };
  } catch (error) {
    return {
      kind: "error",
      errorKind: classifyGenerationError(error),
      error,
      metrics: getGenerationMetrics(error),
      resolvedSourceImageUrl,
      trustedSourceImageUrl,
    };
  }
}

