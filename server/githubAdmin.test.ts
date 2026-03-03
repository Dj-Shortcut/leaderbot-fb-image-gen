import http from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_SESSION_COOKIE_NAME,
  GITHUB_ADMIN_STATE_COOKIE_NAME,
  createAdminSessionToken,
  parseAdminGithubUsers,
  registerGitHubAdminRoutes,
} from "./_core/githubAdmin";

type TestResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  payload: string;
};

async function listen(app: express.Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind test server");
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

async function request(
  baseUrl: string,
  path: string,
  options: {
    method?: "GET" | "POST";
    cookie?: string;
  } = {}
): Promise<TestResponse> {
  const url = new URL(path, baseUrl);

  return await new Promise<TestResponse>((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? "GET",
        headers: options.cookie ? { cookie: options.cookie } : undefined,
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

    req.on("error", reject);
    req.end();
  });
}

describe("GitHub admin auth", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "x".repeat(32);
    process.env.GITHUB_CLIENT_ID = "github-client-id";
    process.env.GITHUB_CLIENT_SECRET = "github-client-secret";
    process.env.GITHUB_CALLBACK_URL = "https://leaderbot.example/auth/github/callback";
    process.env.ADMIN_GITHUB_USERS = "Dj-Shortcut,other-admin";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GITHUB_CALLBACK_URL;
    delete process.env.ADMIN_GITHUB_USERS;
    vi.unstubAllGlobals();
  });

  it("parses the admin GitHub allowlist", () => {
    expect(parseAdminGithubUsers(" Dj-Shortcut, other-admin ,,DJ-Shortcut ")).toEqual(
      new Set(["dj-shortcut", "other-admin"])
    );
  });

  it("rejects callback requests when state does not match the cookie", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const app = express();
    registerGitHubAdminRoutes(app);
    const server = await listen(app);

    try {
      const response = await request(
        server.baseUrl,
        "/auth/github/callback?code=test-code&state=wrong-state",
        {
          cookie: `${GITHUB_ADMIN_STATE_COOKIE_NAME}=expected-state`,
        }
      );

      expect(response.status).toBe(400);
      expect(response.payload).toContain("Invalid GitHub OAuth state");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("rejects callback requests when the GitHub user is not allowlisted", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input === "https://github.com/login/oauth/access_token") {
        return {
          ok: true,
          json: async () => ({ access_token: "github-token" }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ login: "not-allowed-user" }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const app = express();
    registerGitHubAdminRoutes(app);
    const server = await listen(app);

    try {
      const response = await request(
        server.baseUrl,
        "/auth/github/callback?code=test-code&state=matching-state",
        {
          cookie: `${GITHUB_ADMIN_STATE_COOKIE_NAME}=matching-state`,
        }
      );

      expect(response.status).toBe(403);
      expect(response.payload).toContain("GitHub user is not allowed");
    } finally {
      await server.close();
    }
  });

  it("allows /admin when a valid allowlisted admin session cookie is present", async () => {
    const token = await createAdminSessionToken("Dj-Shortcut");
    const app = express();
    registerGitHubAdminRoutes(app);
    const server = await listen(app);

    try {
      const response = await request(server.baseUrl, "/admin", {
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}`,
      });

      expect(response.status).toBe(200);
      expect(response.payload).toContain("Admin dashboard coming soon");
      expect(response.payload).toContain("Dj-Shortcut");
    } finally {
      await server.close();
    }
  });

  it("clears the admin session on logout", async () => {
    const app = express();
    registerGitHubAdminRoutes(app);
    const server = await listen(app);

    try {
      const response = await request(server.baseUrl, "/auth/logout", {
        method: "POST",
      });

      expect(response.status).toBe(303);
      expect(response.headers.location).toBe("/");
      expect(response.headers["set-cookie"]).toEqual(
        expect.arrayContaining([expect.stringContaining(`${ADMIN_SESSION_COOKIE_NAME}=`)])
      );
    } finally {
      await server.close();
    }
  });
});
