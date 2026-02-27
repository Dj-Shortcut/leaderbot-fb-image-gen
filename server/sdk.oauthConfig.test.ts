import { afterEach, describe, expect, it, vi } from "vitest";

describe("OAuth SDK configuration guard", () => {
  const originalOAuthUrl = process.env.OAUTH_SERVER_URL;

  afterEach(() => {
    if (originalOAuthUrl === undefined) {
      delete process.env.OAUTH_SERVER_URL;
    } else {
      process.env.OAUTH_SERVER_URL = originalOAuthUrl;
    }
    vi.restoreAllMocks();
  });

  it("does not log an OAuth error when OAUTH_SERVER_URL is missing", async () => {
    delete process.env.OAUTH_SERVER_URL;
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.resetModules();
    await import("./_core/sdk");

    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("OAUTH_SERVER_URL is not configured")
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "[OAuth] OAUTH_SERVER_URL not set, OAuth client calls are disabled until configured"
    );
  });

  it("logs OAuth initialization when OAUTH_SERVER_URL is provided", async () => {
    process.env.OAUTH_SERVER_URL = "https://oauth.example.com";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.resetModules();
    await import("./_core/sdk");

    expect(logSpy).toHaveBeenCalledWith(
      "[OAuth] Initialized with baseURL:",
      "https://oauth.example.com"
    );
  });
});
