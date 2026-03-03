import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { applySecurityHeaders } from "./_core/securityHeaders";

const originalNodeEnv = process.env.NODE_ENV;

async function startServer(
  configure?: (app: express.Express) => void
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = express();
  applySecurityHeaders(app);
  configure?.(app);
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
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

describe("security headers", () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
      return;
    }

    process.env.NODE_ENV = originalNodeEnv;
  });

  it("sets baseline hardening headers and removes x-powered-by", async () => {
    process.env.NODE_ENV = "development";
    const server = await startServer();

    try {
      const response = await fetch(`${server.baseUrl}/healthz`);

      expect(response.headers.get("x-powered-by")).toBeNull();
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("permissions-policy")).toContain("camera=()");
      expect(response.headers.get("strict-transport-security")).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("adds HSTS for secure production requests", async () => {
    process.env.NODE_ENV = "production";
    const server = await startServer(app => {
      app.get("/secure", (req, res) => {
        res.status(200).json({ secure: req.headers["x-forwarded-proto"] ?? null });
      });
    });

    try {
      const response = await fetch(`${server.baseUrl}/secure`, {
        headers: {
          "x-forwarded-proto": "https",
        },
      });

      expect(response.headers.get("strict-transport-security")).toBe(
        "max-age=31536000; includeSubDomains"
      );
    } finally {
      await server.close();
    }
  });
});
