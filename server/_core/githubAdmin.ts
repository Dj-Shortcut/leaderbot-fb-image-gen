import { randomBytes } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { getAdminCookieOptions } from "./cookies";
import { getConfiguredJwtSecret } from "./env";

export const ADMIN_SESSION_COOKIE_NAME = "admin_session";
export const GITHUB_ADMIN_STATE_COOKIE_NAME = "github_admin_state";

const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const STATE_COOKIE_TTL_MS = 10 * 60 * 1000;
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

const githubCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

type GitHubTokenResponse = {
  access_token?: string;
};

type GitHubUserResponse = {
  login?: string;
};

type AdminSessionClaims = {
  sub: string;
};

type AdminLocals = {
  adminLogin?: string;
};

type GitHubAdminConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  allowedUsers: Set<string>;
};

function getCookieValue(req: Request, key: string): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  const parsed = parseCookieHeader(cookieHeader);
  const value = parsed[key];
  return typeof value === "string" ? value : undefined;
}

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function clearCookie(res: Response, req: Request, name: string): void {
  res.clearCookie(name, {
    ...getAdminCookieOptions(req),
    maxAge: 0,
  });
}

function getGitHubAdminConfig(): GitHubAdminConfig | null {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim() ?? "";
  const callbackUrl = process.env.GITHUB_CALLBACK_URL?.trim() ?? "";
  const allowedUsers = parseAdminGithubUsers();

  if (!clientId || !clientSecret || !callbackUrl || allowedUsers.size === 0) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    callbackUrl,
    allowedUsers,
  };
}

function getJwtSecretKey(): Uint8Array {
  const secret = getConfiguredJwtSecret();
  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }

  return new TextEncoder().encode(secret);
}

async function exchangeCodeForAccessToken(
  code: string,
  config: GitHubAdminConfig
): Promise<string> {
  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "leaderbot-admin-auth",
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed (${response.status})`);
  }

  const payload = (await response.json()) as GitHubTokenResponse;
  if (!payload.access_token) {
    throw new Error("GitHub token exchange did not return an access token");
  }

  return payload.access_token;
}

async function fetchGitHubLogin(accessToken: string): Promise<string> {
  const response = await fetch(GITHUB_USER_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "leaderbot-admin-auth",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub user lookup failed (${response.status})`);
  }

  const payload = (await response.json()) as GitHubUserResponse;
  if (!payload.login) {
    throw new Error("GitHub user payload did not include login");
  }

  return payload.login;
}

function isAllowedAdmin(login: string, allowedUsers: Set<string>): boolean {
  return allowedUsers.has(login.trim().toLowerCase());
}

function renderAdminSignInPage(): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <title>Admin Login</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: Arial, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
      a { display: inline-block; margin-top: 16px; padding: 12px 18px; border-radius: 8px; background: #111827; color: white; text-decoration: none; }
      p { line-height: 1.5; }
    </style>
  </head>
  <body>
    <h1>Admin Sign-in Required</h1>
    <p>This area is restricted to approved GitHub admins.</p>
    <a href="/auth/github/start">Sign in with GitHub</a>
  </body>
</html>`;
}

function renderAdminPage(adminLogin: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <title>Admin</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: Arial, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
      form { margin-top: 20px; }
      button { padding: 10px 14px; border-radius: 8px; border: 1px solid #d1d5db; background: white; cursor: pointer; }
    </style>
  </head>
  <body>
    <h1>Admin</h1>
    <p>Signed in as <strong>${adminLogin}</strong>.</p>
    <p>Admin dashboard coming soon.</p>
    <form action="/auth/logout" method="post">
      <button type="submit">Sign out</button>
    </form>
  </body>
</html>`;
}

function setStateCookie(req: Request, res: Response, state: string): void {
  res.cookie(GITHUB_ADMIN_STATE_COOKIE_NAME, state, {
    ...getAdminCookieOptions(req),
    maxAge: STATE_COOKIE_TTL_MS,
  });
}

function clearStateCookie(req: Request, res: Response): void {
  clearCookie(res, req, GITHUB_ADMIN_STATE_COOKIE_NAME);
}

function clearAdminSessionCookie(req: Request, res: Response): void {
  clearCookie(res, req, ADMIN_SESSION_COOKIE_NAME);
}

export function parseAdminGithubUsers(
  raw = process.env.ADMIN_GITHUB_USERS ?? ""
): Set<string> {
  return new Set(
    raw
      .split(",")
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function createAdminSessionToken(login: string): Promise<string> {
  return new SignJWT({
    sub: login,
  } satisfies AdminSessionClaims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(getJwtSecretKey());
}

async function verifyAdminSessionToken(
  token: string
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecretKey(), {
      algorithms: ["HS256"],
    });

    return typeof payload.sub === "string" && payload.sub.length > 0
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

async function getAdminLoginFromRequest(req: Request): Promise<string | null> {
  const config = getGitHubAdminConfig();
  if (!config) {
    return null;
  }

  const token = getCookieValue(req, ADMIN_SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const login = await verifyAdminSessionToken(token);
  if (!login || !isAllowedAdmin(login, config.allowedUsers)) {
    return null;
  }

  return login;
}

function sendUnauthorizedAdminResponse(req: Request, res: Response): void {
  if (req.method === "GET" && req.path === "/admin") {
    res.status(401).type("html").send(renderAdminSignInPage());
    return;
  }

  res.status(401).type("text/plain").send("Admin login required");
}

const requireAdmin: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  void (async () => {
    const login = await getAdminLoginFromRequest(req);
    if (!login) {
      sendUnauthorizedAdminResponse(req, res);
      return;
    }

    (res.locals as AdminLocals).adminLogin = login;
    next();
  })().catch(() => {
    sendUnauthorizedAdminResponse(req, res);
  });
};

export function registerGitHubAdminRoutes(app: Express): void {
  app.get("/auth/github/start", (req, res) => {
    const config = getGitHubAdminConfig();
    if (!config) {
      res
        .status(503)
        .type("text/plain")
        .send("GitHub admin auth is not configured");
      return;
    }

    const state = randomBytes(16).toString("hex");
    setStateCookie(req, res, state);

    const redirectUrl = new URL(GITHUB_AUTHORIZE_URL);
    redirectUrl.searchParams.set("client_id", config.clientId);
    redirectUrl.searchParams.set("redirect_uri", config.callbackUrl);
    redirectUrl.searchParams.set("scope", "read:user");
    redirectUrl.searchParams.set("state", state);

    res.redirect(302, redirectUrl.toString());
  });

  app.get("/auth/github/callback", (req, res) => {
    void (async () => {
      const config = getGitHubAdminConfig();
      if (!config) {
        res
          .status(503)
          .type("text/plain")
          .send("GitHub admin auth is not configured");
        return;
      }

      const parsedQuery = githubCallbackQuerySchema.safeParse({
        code: getQueryParam(req, "code"),
        state: getQueryParam(req, "state"),
      });
      const expectedState = getCookieValue(req, GITHUB_ADMIN_STATE_COOKIE_NAME);
      clearStateCookie(req, res);

      if (
        !parsedQuery.success ||
        !expectedState ||
        parsedQuery.data.state !== expectedState
      ) {
        res.status(400).type("text/plain").send("Invalid GitHub OAuth state");
        return;
      }

      const { code } = parsedQuery.data;

      try {
        const accessToken = await exchangeCodeForAccessToken(code, config);
        const login = await fetchGitHubLogin(accessToken);

        if (!isAllowedAdmin(login, config.allowedUsers)) {
          clearAdminSessionCookie(req, res);
          res.status(403).type("text/plain").send("GitHub user is not allowed");
          return;
        }

        const sessionToken = await createAdminSessionToken(login);
        res.cookie(ADMIN_SESSION_COOKIE_NAME, sessionToken, {
          ...getAdminCookieOptions(req),
          maxAge: ADMIN_SESSION_TTL_SECONDS * 1000,
        });
        res.redirect(302, "/admin");
      } catch (error) {
        clearAdminSessionCookie(req, res);
        console.error("[GitHubAdmin] OAuth callback failed", {
          error: error instanceof Error ? error.message : "UnknownError",
        });
        res.status(500).type("text/plain").send("GitHub OAuth failed");
      }
    })();
  });

  app.post("/auth/logout", (req, res) => {
    clearAdminSessionCookie(req, res);
    res.redirect(303, "/");
  });

  app.get("/admin", requireAdmin, (_req, res) => {
    const adminLogin = (res.locals as AdminLocals).adminLogin ?? "admin";
    res.status(200).type("html").send(renderAdminPage(adminLogin));
  });
}
