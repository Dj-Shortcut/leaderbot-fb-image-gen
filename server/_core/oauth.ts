import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";

export const OAUTH_STATE_COOKIE_NAME = "lb_oauth_state_nonce";

type OAuthStatePayload = {
  nonce: string;
  redirectUri: string;
};

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function getCookieValue(req: Request, key: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }

  const cookies = parseCookieHeader(header);
  const value = cookies[key];
  return typeof value === "string" ? value : undefined;
}

function clearOAuthStateCookie(res: Response) {
  res.append(
    "Set-Cookie",
    `${OAUTH_STATE_COOKIE_NAME}=; Path=/api/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

export function parseOAuthState(state: string): OAuthStatePayload | null {
  try {
    const decoded = Buffer.from(state, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<OAuthStatePayload>;

    if (
      typeof parsed.redirectUri !== "string" ||
      parsed.redirectUri.length === 0 ||
      typeof parsed.nonce !== "string" ||
      parsed.nonce.length < 16
    ) {
      return null;
    }

    return {
      redirectUri: parsed.redirectUri,
      nonce: parsed.nonce,
    };
  } catch {
    return null;
  }
}

export function validateOAuthState(req: Request, state: string): OAuthStatePayload | null {
  const parsedState = parseOAuthState(state);
  if (!parsedState) {
    return null;
  }

  const expectedNonce = getCookieValue(req, OAUTH_STATE_COOKIE_NAME);
  if (!expectedNonce || expectedNonce !== parsedState.nonce) {
    return null;
  }

  return parsedState;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", (req: Request, res: Response) => {
    void (async () => {
      const code = getQueryParam(req, "code");
      const state = getQueryParam(req, "state");

      if (!code || !state) {
        clearOAuthStateCookie(res);
        res.status(400).json({ error: "code and state are required" });
        return;
      }

      const validatedState = validateOAuthState(req, state);
      if (!validatedState) {
        clearOAuthStateCookie(res);
        res.status(400).json({ error: "invalid oauth state" });
        return;
      }

      try {
        const { sdk } = await import("./sdk");
        const tokenResponse = await sdk.exchangeCodeForToken(code, validatedState.redirectUri);
        const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

        if (!userInfo.openId) {
          clearOAuthStateCookie(res);
          res.status(400).json({ error: "openId missing from user info" });
          return;
        }

        await db.upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: new Date(),
        });

        const sessionToken = await sdk.createSessionToken(userInfo.openId, {
          name: userInfo.name || "",
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        clearOAuthStateCookie(res);

        res.redirect(302, "/");
      } catch (error) {
        clearOAuthStateCookie(res);
        console.error("[OAuth] Callback failed", error);
        res.status(500).json({ error: "OAuth callback failed" });
      }
    })();
  });
}
