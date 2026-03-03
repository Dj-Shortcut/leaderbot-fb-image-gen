export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};

const MIN_SESSION_SECRET_LENGTH = 32;

export function getConfiguredJwtSecret(): string {
  return process.env.JWT_SECRET?.trim() ?? "";
}

export function assertAuthConfig(): void {
  const secret = getConfiguredJwtSecret();

  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be set and at least ${MIN_SESSION_SECRET_LENGTH} characters long`
    );
  }
}
