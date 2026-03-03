import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { OpenAiImageGenerator } from "./_core/imageService";
import { sha256 } from "./_core/imageProof";

const GENERATED_IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=";

describe("OpenAi image-to-image proof", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
    delete process.env.APP_BASE_URL;
  });

  it("sends the original image bytes in OpenAI edits request", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

    const fixture = Buffer.alloc(7000, 9);
    const fixtureHash = sha256(fixture);
    const generatedImageBytes = GENERATED_IMAGE_BASE64;

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
        } as Response;
      }

      expect(url).toBe("https://api.openai.com/v1/images/edits");
      const formData = init?.body as FormData;
      expect(formData).toBeInstanceOf(FormData);
      const imageBlob = formData.get("image");
      expect(imageBlob).toBeInstanceOf(Blob);
      const imageBuffer = Buffer.from(await (imageBlob as Blob).arrayBuffer());
      expect(sha256(imageBuffer)).toBe(fixtureHash);
      expect(formData.get("prompt")).toContain("Apply disco style to this photo");
      expect(formData.get("output_format")).toBe("jpeg");

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: generatedImageBytes }] }),
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
    expect(result.imageUrl).toMatch(/^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/leaderbot-disco-\d+\.jpg$/);
    expect(result.metrics.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.fbImageFetchMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.openAiMs).toBeGreaterThanOrEqual(0);
  });

  it("hard-fails before OpenAI call when input image is too small", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

    const tinyFixture = Buffer.alloc(1024, 1);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://img.example/source.jpg") {
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
      }),
    ).rejects.toThrow("Source image too small");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries the source image download once on transient network errors", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

    const fixture = Buffer.alloc(7000, 9);
    const generatedImageBytes = GENERATED_IMAGE_BASE64;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://img.example/source.jpg" && fetchMock.mock.calls.length === 1) {
        throw new TypeError("temporary network failure");
      }

      if (url === "https://img.example/source.jpg") {
        return {
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          arrayBuffer: async () => fixture,
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ data: [{ b64_json: generatedImageBytes }] }),
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
    expect(result.imageUrl).toMatch(/^https:\/\/leaderbot-fb-image-gen\.fly\.dev\/generated\/leaderbot-disco-\d+\.jpg$/);
    expect(result.metrics.fbImageFetchMs).toBeGreaterThanOrEqual(0);
  });

  it("removes leftover generated webp files", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";
    process.env.APP_BASE_URL = "https://leaderbot-fb-image-gen.fly.dev";

    const generatedDir = path.resolve(process.cwd(), "public", "generated");
    await fs.mkdir(generatedDir, { recursive: true });
    await fs.writeFile(path.join(generatedDir, "old-artifact.webp"), Buffer.from("webp"));

    const fixture = Buffer.alloc(7000, 9);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://img.example/source.jpg") {
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
    await generator.generate({
      style: "disco",
      sourceImageUrl: "https://img.example/source.jpg",
      userKey: "user-1",
      reqId: "req-4",
    });

    await expect(fs.access(path.join(generatedDir, "old-artifact.webp"))).rejects.toThrow();
  });

});
