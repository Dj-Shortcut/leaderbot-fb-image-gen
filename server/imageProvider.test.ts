import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createImageGenerator,
  getGeneratorStartupConfig,
  OpenAiImageGenerator,
} from "./_core/imageService";

const GENERATED_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=";
const originalImageProvider = process.env.IMAGE_PROVIDER;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const originalAppBaseUrl = process.env.APP_BASE_URL;
const originalOpenAiImageMaxRetries = process.env.OPENAI_IMAGE_MAX_RETRIES;
const originalOpenAiImageRetryBaseMs = process.env.OPENAI_IMAGE_RETRY_BASE_MS;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function toUrlString(url: string | URL): string {
  return typeof url === "string" ? url : url.toString();
}

describe("image provider boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    restoreEnv("IMAGE_PROVIDER", originalImageProvider);
    restoreEnv("OPENAI_API_KEY", originalOpenAiApiKey);
    restoreEnv("APP_BASE_URL", originalAppBaseUrl);
    restoreEnv("OPENAI_IMAGE_MAX_RETRIES", originalOpenAiImageMaxRetries);
    restoreEnv("OPENAI_IMAGE_RETRY_BASE_MS", originalOpenAiImageRetryBaseMs);
  });

  it("defaults to the current OpenAI Images provider", () => {
    delete process.env.IMAGE_PROVIDER;

    const result = createImageGenerator();

    expect(result.mode).toBe("openai-images");
    expect(result.generator).toBeInstanceOf(OpenAiImageGenerator);
    expect(getGeneratorStartupConfig().mode).toBe("openai-images");
  });

  it.each(["openai-responses", "openai-responses-image"])(
    "fails fast for unsupported image provider %s",
    provider => {
      process.env.IMAGE_PROVIDER = provider;

      expect(() => createImageGenerator()).toThrow(
        `Unsupported IMAGE_PROVIDER "${provider}". Expected "openai-images".`
      );
    }
  );

  it("logs the active provider once per generation even when OpenAI retries", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.OPENAI_IMAGE_MAX_RETRIES = "1";
    process.env.OPENAI_IMAGE_RETRY_BASE_MS = "1";

    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(toUrlString(url)).toBe("https://api.openai.com/v1/images/edits");

      if (fetchMock.mock.calls.length === 1) {
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "temporary failure",
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: GENERATED_IMAGE_BASE64 }] }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    const result = await generator.generate({
      style: "disco",
      sourceImageData: {
        buffer: Buffer.alloc(7000, 8),
        contentType: "image/jpeg",
      },
      userKey: "user-1",
      reqId: "req-provider-log",
    });

    const providerLogs = logSpy.mock.calls
      .map(([payload]) =>
        typeof payload === "string" ? JSON.parse(payload) : payload
      )
      .filter(payload => payload?.msg === "image_provider_used");

    expect(result.imageUrl).toMatch(
      /^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/[0-9a-f-]+\.jpg$/
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(providerLogs).toEqual([
      {
        level: "info",
        reqId: "req-provider-log",
        msg: "image_provider_used",
        provider: "openai-images",
        hasSourceImage: true,
      },
    ]);
  });
});
