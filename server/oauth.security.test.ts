import http from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerOAuthRoutes, OAUTH_STATE_COOKIE_NAME, parseOAuthState } from "./_core/oauth";

const mocks = vi.hoisted(() => ({
  exchangeCodeForToken: vi.fn(),
  getUserInfo: vi.fn(),
  createSessionToken: vi.fn(),
  upsertUser: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({
  sdk: {
    exchangeCodeForToken: mocks.exchangeCodeForToken,
    getUserInfo: mocks.getUserInfo,
    createSessionToken: mocks.createSessionToken,
  },
}));

vi.mock("./db", () => ({
  upsertUser: mocks.upsertUser,
}));

function buildState(redirectUri: string, nonce: string): string {
  return Buffer.from(JSON.stringify({ redirectUri, nonce }), "utf8").toString("base64");
}

async function sendCallbackRequest(params: {
  code: string;
  state: string;
  cookie?: string;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; payload: string }> {
  const app = express();
  registerOAuthRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind test server");
  }

  const path = `/api/oauth/callback?code=${encodeURIComponent(params.code)}&state=${encodeURIComponent(params.state)}`;
  const response = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; payload: string }>(
    (resolve, reject) => {
      const request = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path,
          method: "GET",
          headers: params.cookie ? { cookie: params.cookie } : undefined,
        },
        res => {
          let payload = "";
          res.on("data", chunk => {
            payload += chunk;
          });
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              payload,
            });
          });
        }
      );

      request.on("error", reject);
      request.end();
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

describe("OAuth callback security", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "x".repeat(32);
    mocks.exchangeCodeForToken.mockReset();
    mocks.getUserInfo.mockReset();
    mocks.createSessionToken.mockReset();
    mocks.upsertUser.mockReset();
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    vi.restoreAllMocks();
  });

  it("rejects callback requests with a missing matching state nonce cookie", async () => {
    const state = buildState("https://leaderbot.example/api/oauth/callback", "nonce-1234567890abcdef");

    const response = await sendCallbackRequest({
      code: "code-1",
      state,
    });

    expect(response.status).toBe(400);
    expect(response.payload).toContain("invalid oauth state");
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it("accepts callback requests when the nonce cookie matches", async () => {
    mocks.exchangeCodeForToken.mockResolvedValue({ accessToken: "access-token" });
    mocks.getUserInfo.mockResolvedValue({
      openId: "open-id-1",
      name: "Test User",
      email: "test@example.com",
      loginMethod: "email",
      platform: "email",
    });
    mocks.createSessionToken.mockResolvedValue("session-token");

    const nonce = "nonce-1234567890abcdef";
    const redirectUri = "https://leaderbot.example/api/oauth/callback";
    const state = buildState(redirectUri, nonce);
    const response = await sendCallbackRequest({
      code: "code-2",
      state,
      cookie: `${OAUTH_STATE_COOKIE_NAME}=${nonce}`,
    });

    expect(response.status).toBe(302);
    expect(mocks.exchangeCodeForToken).toHaveBeenCalledWith("code-2", redirectUri);
    expect(mocks.createSessionToken).toHaveBeenCalled();
  });

  it("parses valid state payloads and rejects malformed ones", () => {
    const valid = parseOAuthState(buildState("https://leaderbot.example/api/oauth/callback", "nonce-1234567890abcdef"));
    const invalid = parseOAuthState("not-base64");

    expect(valid).toEqual({
      redirectUri: "https://leaderbot.example/api/oauth/callback",
      nonce: "nonce-1234567890abcdef",
    });
    expect(invalid).toBeNull();
  });
});
