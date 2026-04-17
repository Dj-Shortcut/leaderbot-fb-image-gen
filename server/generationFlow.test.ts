import { describe, expect, it, vi } from "vitest";

const { createImageGeneratorMock } = vi.hoisted(() => ({
  createImageGeneratorMock: vi.fn(),
}));

vi.mock("./_core/imageService", () => ({
  createImageGenerator: createImageGeneratorMock,
  GenerationTimeoutError: class GenerationTimeoutError extends Error {},
  getGenerationMetrics: (error: Error & { generationMetrics?: unknown }) =>
    error.generationMetrics,
  InvalidSourceImageUrlError: class InvalidSourceImageUrlError extends Error {},
  MissingAppBaseUrlError: class MissingAppBaseUrlError extends Error {},
  MissingInputImageError: class MissingInputImageError extends Error {},
  MissingObjectStorageConfigError: class MissingObjectStorageConfigError extends Error {},
  MissingOpenAiApiKeyError: class MissingOpenAiApiKeyError extends Error {},
  OpenAiBudgetExceededError: class OpenAiBudgetExceededError extends Error {},
}));

import { executeGenerationFlow } from "./_core/generationFlow";
import {
  GenerationTimeoutError,
  InvalidSourceImageUrlError,
  MissingInputImageError,
  OpenAiBudgetExceededError,
} from "./_core/imageService";

describe("generationFlow", () => {
  it("returns missing_source_image when no source image is available", async () => {
    const result = await executeGenerationFlow({
      style: "cyberpunk",
      userId: "user-1",
      reqId: "req-1",
    });

    expect(result).toMatchObject({
      kind: "error",
      errorKind: "missing_source_image",
      trustedSourceImageUrl: false,
    });
  });

  it("marks stored last photo URLs as trusted", async () => {
    const generateMock = vi.fn().mockResolvedValue({
      imageUrl: "https://example.com/generated.jpg",
      proof: {
        incomingLen: 10,
        incomingSha256: "in",
        openaiInputLen: 10,
        openaiInputSha256: "out",
      },
      metrics: { totalMs: 123 },
    });
    createImageGeneratorMock.mockReturnValue({
      mode: "openai",
      generator: { generate: generateMock },
    });

    const result = await executeGenerationFlow({
      style: "cyberpunk",
      userId: "user-1",
      reqId: "req-1",
      lastPhotoUrl: "https://stored.example/image.jpg",
      lastPhotoSource: "stored",
    });

    expect(result).toMatchObject({
      kind: "success",
      trustedSourceImageUrl: true,
      resolvedSourceImageUrl: "https://stored.example/image.jpg",
    });
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        trustedSourceImageUrl: true,
        sourceImageProvenance: "storeInbound",
      })
    );
  });

  it("classifies mapped generator failures", async () => {
    const timeoutError = new GenerationTimeoutError("timeout");
    (timeoutError as Error & { generationMetrics?: unknown }).generationMetrics = {
      totalMs: 45,
    };

    createImageGeneratorMock.mockReturnValue({
      mode: "openai",
      generator: { generate: vi.fn().mockRejectedValue(timeoutError) },
    });

    const timeoutResult = await executeGenerationFlow({
      style: "cyberpunk",
      userId: "user-1",
      reqId: "req-1",
      lastPhotoUrl: "https://example.com/photo.jpg",
    });

    expect(timeoutResult).toMatchObject({
      kind: "error",
      errorKind: "generation_timeout",
      metrics: { totalMs: 45 },
    });

    createImageGeneratorMock.mockReturnValue({
      mode: "openai",
      generator: {
        generate: vi.fn().mockRejectedValue(new InvalidSourceImageUrlError("bad")),
      },
    });

    const invalidSourceResult = await executeGenerationFlow({
      style: "cyberpunk",
      userId: "user-1",
      reqId: "req-1",
      lastPhotoUrl: "https://example.com/photo.jpg",
    });

    expect(invalidSourceResult).toMatchObject({
      kind: "error",
      errorKind: "invalid_source_image",
    });

    createImageGeneratorMock.mockReturnValue({
      mode: "openai",
      generator: {
        generate: vi.fn().mockRejectedValue(new MissingInputImageError("missing")),
      },
    });

    const missingInputResult = await executeGenerationFlow({
      style: "cyberpunk",
      userId: "user-1",
      reqId: "req-1",
      lastPhotoUrl: "https://example.com/photo.jpg",
    });

    expect(missingInputResult).toMatchObject({
      kind: "error",
      errorKind: "missing_input_image",
    });

    createImageGeneratorMock.mockReturnValue({
      mode: "openai",
      generator: {
        generate: vi.fn().mockRejectedValue(new OpenAiBudgetExceededError("budget")),
      },
    });

    const budgetResult = await executeGenerationFlow({
      style: "cyberpunk",
      userId: "user-1",
      reqId: "req-1",
      lastPhotoUrl: "https://example.com/photo.jpg",
    });

    expect(budgetResult).toMatchObject({
      kind: "error",
      errorKind: "generation_budget_reached",
    });
  });
});

