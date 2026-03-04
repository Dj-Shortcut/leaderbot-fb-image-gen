import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import {
  attachRequestTracing,
  getRequestId,
  recordHttpRequestMetric,
  registerMetricsRoute,
  resetObservabilityMetrics,
} from "./_core/observability";

afterEach(() => {
  resetObservabilityMetrics();
});

async function startServer(configure?: (app: express.Express) => void) {
  const app = express();
  app.use(attachRequestTracing());
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      recordHttpRequestMetric(req.method, req.path, res.statusCode, durationMs);
    });
    next();
  });
  configure?.(app);
  registerMetricsRoute(app);

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

describe("observability", () => {
  it("propagates incoming X-Request-Id headers", async () => {
    const server = await startServer(app => {
      app.get("/trace", (req, res) => {
        res.status(200).json({ reqId: getRequestId(req) ?? null });
      });
    });

    try {
      const response = await fetch(`${server.baseUrl}/trace`, {
        headers: {
          "X-Request-Id": "req-test-123",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBe("req-test-123");
      expect(await response.json()).toEqual({ reqId: "req-test-123" });
    } finally {
      await server.close();
    }
  });

  it("exposes Prometheus-style HTTP metrics", async () => {
    const server = await startServer(app => {
      app.get("/ok", (_req, res) => {
        res.status(200).json({ ok: true });
      });
    });

    try {
      await fetch(`${server.baseUrl}/ok`);
      const response = await fetch(`${server.baseUrl}/metrics`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(body).toContain("http_requests_total");
      expect(body).toContain('path="/ok"');
      expect(body).toContain("http_request_duration_seconds_bucket");
    } finally {
      await server.close();
    }
  });
});
