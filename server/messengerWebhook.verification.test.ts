import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("express-rate-limit", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

async function getWebhook(path: string): Promise<{ status: number; payload: string }> {
  const { registerMetaWebhookRoutes } = await import("./_core/meta/webhookRoutes");
  const app = express();
  registerMetaWebhookRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind test server");
  }

  const response = await new Promise<{ status: number; payload: string }>((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path,
        method: "GET",
      },
      res => {
        let payload = "";
        res.on("data", chunk => {
          payload += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, payload });
        });
      },
    );

    request.on("error", reject);
    request.end();
  });

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

describe("messenger webhook verification route", () => {
  afterEach(() => {
    delete process.env.FB_VERIFY_TOKEN;
  });

  it("fails closed when FB_VERIFY_TOKEN is missing", async () => {
    const response = await getWebhook(
      "/webhook/facebook?hub.mode=subscribe&hub.verify_token=test&hub.challenge=abc",
    );

    expect(response.status).toBe(403);
  });

  it("rejects requests with a missing challenge", async () => {
    process.env.FB_VERIFY_TOKEN = "test-token";

    const response = await getWebhook(
      "/webhook/facebook?hub.mode=subscribe&hub.verify_token=test-token",
    );

    expect(response.status).toBe(403);
  });

  it("returns challenge for valid token", async () => {
    process.env.FB_VERIFY_TOKEN = "test-token";

    const response = await getWebhook(
      "/webhook/facebook?hub.mode=subscribe&hub.verify_token=test-token&hub.challenge=abc123",
    );

    expect(response.status).toBe(200);
    expect(response.payload).toBe("abc123");
  });
});
