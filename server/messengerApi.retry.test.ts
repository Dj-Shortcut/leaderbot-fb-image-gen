import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendText } from "./_core/messengerApi";

describe("messengerApi retries", () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.FB_PAGE_ACCESS_TOKEN;
  const originalMaxRetries = process.env.GRAPH_API_MAX_RETRIES;
  const originalRetryBase = process.env.GRAPH_API_RETRY_BASE_MS;

  beforeEach(() => {
    process.env.FB_PAGE_ACCESS_TOKEN = "test-token";
    process.env.GRAPH_API_MAX_RETRIES = "2";
    process.env.GRAPH_API_RETRY_BASE_MS = "1";
  });

  afterEach(() => {
    global.fetch = originalFetch;

    if (originalToken === undefined) {
      delete process.env.FB_PAGE_ACCESS_TOKEN;
    } else {
      process.env.FB_PAGE_ACCESS_TOKEN = originalToken;
    }

    if (originalMaxRetries === undefined) {
      delete process.env.GRAPH_API_MAX_RETRIES;
    } else {
      process.env.GRAPH_API_MAX_RETRIES = originalMaxRetries;
    }

    if (originalRetryBase === undefined) {
      delete process.env.GRAPH_API_RETRY_BASE_MS;
    } else {
      process.env.GRAPH_API_RETRY_BASE_MS = originalRetryBase;
    }
  });

  it("retries 429 responses and succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "0" },
        })
      )
      .mockResolvedValueOnce(
        new Response("still limited", {
          status: 429,
          headers: { "retry-after": "0" },
        })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    global.fetch = fetchMock;

    await sendText("psid-1", "hello");

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws after max retries", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response("rate limited", { status: 429 })
      );

    global.fetch = fetchMock;

    await expect(sendText("psid-1", "hello")).rejects.toThrow(
      "Messenger API error 429"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
