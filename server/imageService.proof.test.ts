import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InvalidSourceImageUrlError,
  OpenAiImageGenerator,
} from "./_core/imageService";
import { sha256 } from "./_core/imageProof";

const GENERATED_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=";

function toUrlString(url: string | URL): string {
  return typeof url === "string" ? url : url.toString();
}

describe("OpenAi image-to-image proof", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
    delete process.env.APP_BASE_URL;
    delete process.env.OPENAI_IMAGE_MAX_RETRIES;
    delete process.env.OPENAI_IMAGE_RETRY_BASE_MS;
    delete process.env.OPENAI_IMAGE_TIMEOUT_MS;
    delete process.env.SOURCE_IMAGE_ALLOWED_HOSTS;
  });

  it("sends the original image bytes in OpenAI edits request", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";

    const fixture = Buffer.alloc(7000, 9);
    const fixtureHash = sha256(fixture);

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        expect(init?.redirect).toBe("manual");
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
        } as Response;
      }

      expect(toUrlString(url)).toBe("https://api.openai.com/v1/images/edits");
      const formData = init?.body as FormData;
      expect(formData).toBeInstanceOf(FormData);
      const imageBlob = formData.get("image");
      expect(imageBlob).toBeInstanceOf(Blob);
      const imageBuffer = Buffer.from(await (imageBlob as Blob).arrayBuffer());
      expect(sha256(imageBuffer)).toBe(fixtureHash);
      expect(formData.get("prompt")).toContain(
        "Apply disco style to this photo"
      );
      expect(formData.get("output_format")).toBe("jpeg");

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: GENERATED_IMAGE_BASE64 }] }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    const result = await generator.generate({
      style: "disco",
      sourceImageUrl: "https://img.example/source.jpg",
      userKey: "user-1",
      reqId: "req-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.imageUrl).toMatch(
      /^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/[0-9a-f-]+\.jpg$/
    );
    expect(result.metrics.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.fbImageFetchMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.openAiMs).toBeGreaterThanOrEqual(0);
  });

  it("forwards remix prompt hints to the OpenAI edits prompt", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";

    const fixture = Buffer.alloc(7000, 9);

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
        } as Response;
      }

      const formData = init?.body as FormData;
      expect(formData.get("prompt")).toContain(
        "Apply disco style to this photo."
      );
      expect(formData.get("prompt")).toContain(
        "Additional direction: neon rain."
      );

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: GENERATED_IMAGE_BASE64 }] }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await generator.generate({
      style: "disco",
      sourceImageUrl: "https://img.example/source.jpg",
      promptHint: "neon rain",
      userKey: "user-1",
      reqId: "req-remix-prompt",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the cyberpunk preset prompt for OpenAI edits", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";

    const fixture = Buffer.alloc(7000, 9);

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
        } as Response;
      }

      const formData = init?.body as FormData;
      expect(formData.get("prompt")).toContain("cyberpunk aesthetic");
      expect(formData.get("prompt")).toContain("neon-lit futuristic city");
      expect(formData.get("prompt")).toContain("cinematic sci-fi atmosphere");

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: GENERATED_IMAGE_BASE64 }] }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await generator.generate({
      style: "cyberpunk",
      sourceImageUrl: "https://img.example/source.jpg",
      userKey: "user-1",
      reqId: "req-cyberpunk-prompt",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the Norman Blackwell preset prompt for OpenAI edits", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";

    const fixture = Buffer.alloc(7000, 9);

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
        } as Response;
      }

      const formData = init?.body as FormData;
      const prompt = String(formData.get("prompt"));
      expect(prompt).toContain("Norman Blackwell portrait style");
      expect(prompt).toContain("nostalgic mid-century editorial illustration");
      expect(prompt).toContain("warm Americana storytelling");
      expect(prompt).toContain("vintage magazine cover feel");

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: GENERATED_IMAGE_BASE64 }] }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await generator.generate({
      style: "norman-blackwell",
      sourceImageUrl: "https://img.example/source.jpg",
      userKey: "user-1",
      reqId: "req-norman-blackwell-prompt",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the oil-paint preset prompt for OpenAI edits", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";

    const fixture = Buffer.alloc(7000, 9);

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
        } as Response;
      }

      const formData = init?.body as FormData;
      const prompt = String(formData.get("prompt"));
      expect(prompt).toContain("classic oil painting portrait");
      expect(prompt).toContain("visible brush strokes");
      expect(prompt).toContain("textured canvas");
      expect(prompt).toContain("painterly lighting");
      expect(prompt).toContain("fine-art museum feel");

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: GENERATED_IMAGE_BASE64 }] }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await generator.generate({
      style: "oil-paint",
      sourceImageUrl: "https://img.example/source.jpg",
      userKey: "user-1",
      reqId: "req-oil-paint-prompt",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hard-fails before OpenAI call when input image is too small", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";

    const tinyFixture = Buffer.alloc(1024, 1);
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => tinyFixture,
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: GENERATED_IMAGE_BASE64 }] }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await expect(
      generator.generate({
        style: "disco",
        sourceImageUrl: "https://img.example/source.jpg",
        userKey: "user-1",
        reqId: "req-2",
      })
    ).rejects.toThrow("Source image too small");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries the source image download once on transient network errors", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";

    const fixture = Buffer.alloc(7000, 9);
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (
        toUrlString(url) === "https://img.example/source.jpg" &&
        fetchMock.mock.calls.length === 1
      ) {
        throw new TypeError("temporary network failure");
      }

      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
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
      sourceImageUrl: "https://img.example/source.jpg",
      userKey: "user-1",
      reqId: "req-3",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.imageUrl).toMatch(
      /^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/[0-9a-f-]+\.jpg$/
    );
    expect(result.metrics.fbImageFetchMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects localhost and private IP source image URLs before fetch", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await expect(
      generator.generate({
        style: "disco",
        sourceImageUrl: "https://127.0.0.1/source.jpg",
        userKey: "user-1",
        reqId: "req-private-ip",
      })
    ).rejects.toBeInstanceOf(InvalidSourceImageUrlError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces SOURCE_IMAGE_ALLOWED_HOSTS when configured", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example";

    const fixture = Buffer.alloc(7000, 9);
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (toUrlString(url) === "https://cdn.img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
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
      sourceImageUrl: "https://cdn.img.example/source.jpg",
      userKey: "user-1",
      reqId: "req-allowlist",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.imageUrl).toMatch(
      /^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/[0-9a-f-]+\.jpg$/
    );
  });

  it("blocks hosts outside SOURCE_IMAGE_ALLOWED_HOSTS before fetch", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await expect(
      generator.generate({
        style: "disco",
        sourceImageUrl: "https://other.example/source.jpg",
        userKey: "user-1",
        reqId: "req-deny-allowlist",
      })
    ).rejects.toBeInstanceOf(InvalidSourceImageUrlError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects source image URLs with embedded credentials before fetch", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await expect(
      generator.generate({
        style: "disco",
        sourceImageUrl: "https://user:pass@img.example/source.jpg",
        userKey: "user-1",
        reqId: "req-embedded-credentials",
      })
    ).rejects.toBeInstanceOf(InvalidSourceImageUrlError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects source image URLs on non-443 ports before fetch", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await expect(
      generator.generate({
        style: "disco",
        sourceImageUrl: "https://img.example:8443/source.jpg",
        userKey: "user-1",
        reqId: "req-non-standard-port",
      })
    ).rejects.toBeInstanceOf(InvalidSourceImageUrlError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires https APP_BASE_URL in production for openai mode", async () => {
    process.env.NODE_ENV = "production";
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "http://leaderbot.example";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example";

    const fixture = Buffer.alloc(7000, 9);
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: GENERATED_IMAGE_BASE64 }] }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await expect(
      generator.generate({
        style: "disco",
        sourceImageUrl: "https://img.example/source.jpg",
        userKey: "user-1",
        reqId: "req-insecure-app-base-url",
      })
    ).rejects.toThrow("APP_BASE_URL is missing or invalid");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    delete process.env.NODE_ENV;
  });

  it("retries OpenAI edits request on retryable status codes", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.OPENAI_IMAGE_MAX_RETRIES = "1";
    process.env.OPENAI_IMAGE_RETRY_BASE_MS = "1";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";

    const fixture = Buffer.alloc(7000, 9);
    let openAiCallCount = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
        } as Response;
      }

      openAiCallCount += 1;
      if (openAiCallCount === 1) {
        return {
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
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
      sourceImageUrl: "https://img.example/source.jpg",
      userKey: "user-1",
      reqId: "req-openai-retry",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.imageUrl).toMatch(
      /^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/[0-9a-f-]+\.jpg$/
    );
    expect(result.metrics.openAiMs).toBeGreaterThanOrEqual(0);
  });

  it("fails closed when SOURCE_IMAGE_ALLOWED_HOSTS is not set", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await expect(
      generator.generate({
        style: "disco",
        sourceImageUrl: "https://img.example/source.jpg",
        userKey: "user-1",
        reqId: "req-no-allowlist",
      })
    ).rejects.toBeInstanceOf(InvalidSourceImageUrlError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks redirects for source image fetches", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        expect(init?.redirect).toBe("manual");
        return {
          ok: false,
          status: 302,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => Buffer.alloc(7000, 9),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: GENERATED_IMAGE_BASE64 }] }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await expect(
      generator.generate({
        style: "disco",
        sourceImageUrl: "https://img.example/source.jpg",
        userKey: "user-1",
        reqId: "req-redirect-error",
      })
    ).rejects.toBeInstanceOf(InvalidSourceImageUrlError);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.any(URL),
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("retries OpenAI edits request after timeout aborts", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.OPENAI_IMAGE_MAX_RETRIES = "1";
    process.env.OPENAI_IMAGE_RETRY_BASE_MS = "1";
    process.env.OPENAI_IMAGE_TIMEOUT_MS = "5";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";

    const fixture = Buffer.alloc(7000, 9);
    let openAiCallCount = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
        } as Response;
      }

      openAiCallCount += 1;
      if (openAiCallCount === 1) {
        const abortError = new Error("request aborted");
        abortError.name = "AbortError";
        throw abortError;
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
      sourceImageUrl: "https://img.example/source.jpg",
      userKey: "user-1",
      reqId: "req-openai-timeout-retry",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.imageUrl).toMatch(
      /^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/[0-9a-f-]+\.jpg$/
    );
    expect(result.metrics.openAiMs).toBeGreaterThanOrEqual(0);
  });

  it("fails when OpenAI base64 payload decodes to an empty image buffer", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example,fbsbx.com";

    const fixture = Buffer.alloc(7000, 9);
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: "!!!" }] }),
      } as Response;
    });

    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    await expect(
      generator.generate({
        style: "disco",
        sourceImageUrl: "https://img.example/source.jpg",
        userKey: "user-1",
        reqId: "req-empty-output-buffer",
      })
    ).rejects.toThrow(
      "OpenAI response image data was empty after base64 decode"
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
