import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

async function postJson(
  app: express.Express,
  body: unknown
): Promise<{ status: number; payload: string }> {
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind test server");
  }

  const response = await new Promise<{ status: number; payload: string }>(
    (resolve, reject) => {
      const request = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/api/chat",
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
        },
        res => {
          let payload = "";
          res.on("data", chunk => {
            payload += chunk;
          });
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              payload,
            });
          });
        }
      );

      request.on("error", reject);
      request.end(JSON.stringify(body));
    }
  );

  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return response;
}

describe("chat request validation", () => {
  afterEach(() => {
    delete process.env.BUILT_IN_FORGE_API_URL;
    delete process.env.BUILT_IN_FORGE_API_KEY;
    vi.doUnmock("ai");
    vi.restoreAllMocks();
  });

  async function createConfiguredApp() {
    process.env.BUILT_IN_FORGE_API_URL = "https://example.test/forge";
    process.env.BUILT_IN_FORGE_API_KEY = "secret-token";
    vi.resetModules();

    const { registerChatRoutes } = await import("./_core/chat");
    const app = express();
    app.use(express.json());
    registerChatRoutes(app);
    return app;
  }

  it("rejects payloads without a messages array", async () => {
    const app = await createConfiguredApp();

    const responseA = await postJson(app, {});

    expect(responseA.status).toBe(400);
    expect(responseA.payload).toContain("messages array is required");
  });

  it("rejects payloads with invalid model messages", async () => {
    const app = await createConfiguredApp();

    const response = await postJson(app, {
      messages: [{ content: "hello" }],
    });

    expect(response.status).toBe(400);
    expect(response.payload).toContain("messages must be valid model messages");
  });

  it("accepts payloads with role and content", async () => {
    const streamTextMock = vi.fn(() => ({
      pipeUIMessageStreamToResponse: vi.fn((res: express.Response) => {
        res.status(200).end();
      }),
    }));
    vi.doMock("ai", async importOriginal => {
      const actual = await importOriginal<typeof import("ai")>();
      return {
        ...actual,
        streamText: streamTextMock,
      };
    });
    const app = await createConfiguredApp();

    const response = await postJson(app, {
      messages: [{ role: "user", content: "hello" }],
    });

    expect(response.status).toBe(200);
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "hello" }],
      })
    );
  });
});
