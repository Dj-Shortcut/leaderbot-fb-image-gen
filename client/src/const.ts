export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

const getOptionalEnvString = (value: unknown): string | undefined => {
  return typeof value === "string" ? value : undefined;
};

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  const oauthPortalUrl = getOptionalEnvString(import.meta.env.VITE_OAUTH_PORTAL_URL);
  const appId = getOptionalEnvString(import.meta.env.VITE_APP_ID);
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  if (!oauthPortalUrl || !appId) {
    return redirectUri;
  }

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
