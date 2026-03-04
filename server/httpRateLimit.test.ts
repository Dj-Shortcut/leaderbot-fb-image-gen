import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import {
  createGlobalHttpRateLimiter,
  resetGlobalHttpRateLimiter,
} from "./_core/httpRateLimit";

const originalWindowMs = process.env.HTTP_RATE_LIMIT_WINDOW_MS;
const originalMaxRequests = process.env.HTTP_RATE_LIMIT_MAX_REQUESTS;

afterEach(() => {
  resetGlobalHttpRateLimiter();

  if (originalWindowMs === undefined) {
    delete process.env.HTTP_RATE_LIMIT_WINDOW_MS;
  } else {
    process.env.HTTP_RATE_LIMIT_WINDOW_MS = originalWindowMs;
  }

  if (originalMaxRequests === undefined) {
    delete process.env.HTTP_RATE_LIMIT_MAX_REQUESTS;
  } else {
    process.env.HTTP_RATE_LIMIT_MAX_REQUESTS = originalMaxRequests;
  }
});

async function startServer() {
  const app = express();
  app.use(createGlobalHttpRateLimiter());
  app.get("/limited", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to get test server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

describe("global http rate limiter", () => {
  it("returns 429 after exceeding the per-IP request budget", async () => {
    process.env.HTTP_RATE_LIMIT_WINDOW_MS = "60000";
    process.env.HTTP_RATE_LIMIT_MAX_REQUESTS = "2";

    const server = await startServer();

    try {
      const first = await fetch(`${server.baseUrl}/limited`);
      const second = await fetch(`${server.baseUrl}/limited`);
      const third = await fetch(`${server.baseUrl}/limited`);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
      expect(third.headers.get("retry-after")).not.toBeNull();
      expect(await third.json()).toEqual({
        error: "Too Many Requests",
        message: "Global HTTP rate limit exceeded. Please retry shortly.",
      });
    } finally {
      await server.close();
    }
  });

  it("does not rate limit health checks", async () => {
    process.env.HTTP_RATE_LIMIT_WINDOW_MS = "60000";
    process.env.HTTP_RATE_LIMIT_MAX_REQUESTS = "1";

    const server = await startServer();

    try {
      const first = await fetch(`${server.baseUrl}/healthz`);
      const second = await fetch(`${server.baseUrl}/healthz`);
      const third = await fetch(`${server.baseUrl}/healthz`);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
