import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

async function postJson(
  app: express.Express,
  path: string,
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
          path,
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

describe("chat route configuration", () => {
  const originalForgeApiUrl = process.env.BUILT_IN_FORGE_API_URL;
  const originalForgeApiKey = process.env.BUILT_IN_FORGE_API_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalForgeApiUrl === undefined) {
      delete process.env.BUILT_IN_FORGE_API_URL;
    } else {
      process.env.BUILT_IN_FORGE_API_URL = originalForgeApiUrl;
    }

    if (originalForgeApiKey === undefined) {
      delete process.env.BUILT_IN_FORGE_API_KEY;
    } else {
      process.env.BUILT_IN_FORGE_API_KEY = originalForgeApiKey;
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    vi.restoreAllMocks();
  });

  it("reports not configured when forge URL/key are missing or blank", async () => {
    process.env.BUILT_IN_FORGE_API_URL = "   ";
    process.env.BUILT_IN_FORGE_API_KEY = "";

    vi.resetModules();
    const { isChatConfigured } = await import("./_core/chat");

    expect(isChatConfigured()).toBe(false);
  });

  it("reports configured when forge URL/key are non-empty after trim", async () => {
    process.env.BUILT_IN_FORGE_API_URL = " https://example.test/forge ";
    process.env.BUILT_IN_FORGE_API_KEY = " secret-token ";

    vi.resetModules();
    const { isChatConfigured } = await import("./_core/chat");

    expect(isChatConfigured()).toBe(true);
  });



  it("rejects non-https forge URL in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.BUILT_IN_FORGE_API_URL = "http://example.test/forge";
    process.env.BUILT_IN_FORGE_API_KEY = "secret-token";

    vi.resetModules();
    const { isChatConfigured } = await import("./_core/chat");

    expect(() => isChatConfigured()).toThrow("BUILT_IN_FORGE_API_URL must use HTTPS in production");
  });

  it("registers active /api/chat when config is present", async () => {
    process.env.BUILT_IN_FORGE_API_URL = " https://example.test/forge ";
    process.env.BUILT_IN_FORGE_API_KEY = " secret-token ";

    vi.resetModules();
    const { registerChatRoutes } = await import("./_core/chat");

    const app = express();
    app.use(express.json());
    registerChatRoutes(app);

    const response = await postJson(app, "/api/chat", {});

    expect(response.status).toBe(400);
    expect(response.payload).toContain("messages array is required");
  });

  it("returns 503 when /api/chat is disabled by missing config", async () => {
    process.env.BUILT_IN_FORGE_API_URL = "";
    process.env.BUILT_IN_FORGE_API_KEY = "";

    vi.resetModules();
    const { registerChatRoutes } = await import("./_core/chat");

    const app = express();
    app.use(express.json());
    registerChatRoutes(app);

    const response = await postJson(app, "/api/chat", {
      messages: [{ role: "user", content: "hello" }],
    });

    expect(response.status).toBe(503);
    expect(response.payload).toContain("Chat API is disabled");
  });

  it("logs only once that chat is disabled", async () => {
    process.env.BUILT_IN_FORGE_API_URL = "";
    process.env.BUILT_IN_FORGE_API_KEY = "";

    vi.resetModules();
    const { registerChatRoutes } = await import("./_core/chat");
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    const app = express();
    app.use(express.json());

    registerChatRoutes(app);
    registerChatRoutes(app);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      "[Chat] /api/chat disabled: missing BUILT_IN_FORGE_API_URL and/or BUILT_IN_FORGE_API_KEY"
    );
  });
});
