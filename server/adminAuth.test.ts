import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindTestHttpServer } from "./testHttpServer";

const { safeLogMock } = vi.hoisted(() => ({
  safeLogMock: vi.fn(),
}));

vi.mock("./_core/messengerApi", () => ({
  safeLog: safeLogMock,
}));

import {
  createAdminAuthRateLimiter,
  resetAdminAuthRateLimiterForTests,
  verifyAdminToken,
} from "./_core/adminAuth";

const originalAdminToken = process.env.ADMIN_TOKEN;

afterEach(() => {
  resetAdminAuthRateLimiterForTests();
  safeLogMock.mockClear();
  if (originalAdminToken === undefined) {
    delete process.env.ADMIN_TOKEN;
  } else {
    process.env.ADMIN_TOKEN = originalAdminToken;
  }
});

async function startServer() {
  const app = express();
  app.set("trust proxy", 1);
  app.get(
    "/admin/test",
    createAdminAuthRateLimiter({ eventName: "admin_test_rate_limited" }),
    (_req, res) => res.status(403).send("forbidden")
  );

  const server = http.createServer(app);
  const boundServer = await bindTestHttpServer(server);

  return {
    baseUrl: boundServer.baseUrl,
    close: boundServer.close,
  };
}

describe("admin auth", () => {
  it("uses constant-time token verification without accepting mismatches", () => {
    process.env.ADMIN_TOKEN = "correct-token";

    expect(
      verifyAdminToken({
        providedToken: "correct-token",
        eventName: "admin_auth_failed",
      })
    ).toBe(true);
    expect(
      verifyAdminToken({
        providedToken: "wrong-token",
        eventName: "admin_auth_failed",
      })
    ).toBe(false);
    expect(safeLogMock).toHaveBeenCalledWith("admin_auth_failed", {
      reason: "length_mismatch",
    });
  });

  it("rate limits repeated admin auth attempts per endpoint", async () => {
    const server = await startServer();

    try {
      const responses: Response[] = [];
      for (let index = 0; index < 6; index += 1) {
        responses.push(await fetch(`${server.baseUrl}/admin/test`));
      }

      expect(responses.slice(0, 5).map(response => response.status)).toEqual([
        403,
        403,
        403,
        403,
        403,
      ]);
      expect(responses[5].status).toBe(429);
      expect(responses[5].headers.get("retry-after")).not.toBeNull();
      expect(safeLogMock).toHaveBeenCalledWith("admin_test_rate_limited", {
        reason: "rate_limited",
      });
    } finally {
      await server.close();
    }
  });
});
