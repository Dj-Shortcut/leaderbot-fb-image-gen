import {
  MissingAppBaseUrlError,
  MissingObjectStorageConfigError,
} from "./imageServiceErrors";

export function getConfiguredBaseUrl(): string | undefined {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim()
    ? process.env.APP_BASE_URL.trim()
    : process.env.BASE_URL?.trim();

  if (!configuredBaseUrl || !/^https?:\/\//.test(configuredBaseUrl)) {
    return undefined;
  }

  if (
    process.env.NODE_ENV === "production" &&
    !configuredBaseUrl.startsWith("https://")
  ) {
    console.error(
      "Configured base URL (APP_BASE_URL or BASE_URL) must use https:// in production",
      {
      hasConfiguredBaseUrl: true,
      protocol: configuredBaseUrl.split(":")[0],
      }
    );
    return undefined;
  }

  return configuredBaseUrl.replace(/\/$/, "");
}

export function getRequiredPublicBaseUrl(): string {
  const baseUrl = getConfiguredBaseUrl();
  if (!baseUrl) {
    console.error("APP_BASE_URL is required for image generation");
    throw new MissingAppBaseUrlError("APP_BASE_URL is missing or invalid");
  }

  return baseUrl;
}

export function hasObjectStorageConfig(): boolean {
  return Boolean(
    process.env.BUILT_IN_FORGE_API_URL?.trim() &&
      process.env.BUILT_IN_FORGE_API_KEY?.trim()
  );
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function assertProductionImageStorageConfig(): void {
  if (!isProductionRuntime()) {
    return;
  }

  if (!hasObjectStorageConfig()) {
    throw new MissingObjectStorageConfigError(
      "BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY are required in production for durable generated image storage"
    );
  }
}
