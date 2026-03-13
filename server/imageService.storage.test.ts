import { afterEach, describe, expect, it, vi } from "vitest";

const GENERATED_IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=";

function toUrlString(url: string | URL): string {
  return typeof url === "string" ? url : url.toString();
}

describe("OpenAi image delivery via object storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.OPENAI_API_KEY;
    delete process.env.SOURCE_IMAGE_ALLOWED_HOSTS;
    delete process.env.BUILT_IN_FORGE_API_URL;
    delete process.env.BUILT_IN_FORGE_API_KEY;
    delete process.env.APP_BASE_URL;
  });

  it("uploads generated image to storage and returns signed URL", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.SOURCE_IMAGE_ALLOWED_HOSTS = "img.example";
    process.env.BUILT_IN_FORGE_API_URL = "https://forge.example";
    process.env.BUILT_IN_FORGE_API_KEY = "forge-secret";

    const { OpenAiImageGenerator } = await import("./_core/imageService");

    const sourceImage = Buffer.alloc(7000, 8);
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (toUrlString(url) === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => sourceImage,
        } as Response;
      }

      if (toUrlString(url) === "https://api.openai.com/v1/images/edits") {
        return {
          ok: true,
          json: async () => ({ data: [{ b64_json: GENERATED_IMAGE_BASE64 }] }),
        } as Response;
      }

      if (toUrlString(url).startsWith("https://forge.example/v1/storage/upload?path=generated%2Fdisco%2F")) {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual({ Authorization: "Bearer forge-secret" });
        expect(init?.body).toBeInstanceOf(FormData);

        return {
          ok: true,
          json: async () => ({ url: "https://cdn.example/generated/disco.jpg?signature=abc" }),
        } as Response;
      }

      throw new Error(`Unexpected fetch url: ${toUrlString(url)}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const generator = new OpenAiImageGenerator();
    const result = await generator.generate({
      style: "disco",
      sourceImageUrl: "https://img.example/source.jpg",
      userKey: "user-1",
      reqId: "req-storage-1",
    });

    expect(result.imageUrl).toBe("https://cdn.example/generated/disco.jpg?signature=abc");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
