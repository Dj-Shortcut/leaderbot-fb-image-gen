import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { safeLogMock } = vi.hoisted(() => ({
  safeLogMock: vi.fn(),
}));

vi.mock("./_core/messengerApi", () => ({
  safeLog: safeLogMock,
}));

import { resetStateStore } from "./_core/messengerState";
import { getMessengerChatHistory } from "./_core/messengerChatMemory";
import { generateMessengerReply } from "./_core/messengerResponsesService";

const originalApiKey = process.env.OPENAI_API_KEY;
const originalTextModel = process.env.OPENAI_TEXT_MODEL;
const originalTextMaxOutputTokens = process.env.OPENAI_TEXT_MAX_OUTPUT_TOKENS;
const originalTextMaxRetries = process.env.OPENAI_TEXT_MAX_RETRIES;
const originalRedisUrl = process.env.REDIS_URL;

describe("messenger responses service", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    process.env.OPENAI_TEXT_MODEL = "gpt-4.1-mini";
    delete process.env.OPENAI_TEXT_MAX_OUTPUT_TOKENS;
    delete process.env.OPENAI_TEXT_MAX_RETRIES;
    safeLogMock.mockReset();
    resetStateStore();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }

    if (originalTextModel === undefined) {
      delete process.env.OPENAI_TEXT_MODEL;
    } else {
      process.env.OPENAI_TEXT_MODEL = originalTextModel;
    }

    if (originalTextMaxOutputTokens === undefined) {
      delete process.env.OPENAI_TEXT_MAX_OUTPUT_TOKENS;
    } else {
      process.env.OPENAI_TEXT_MAX_OUTPUT_TOKENS = originalTextMaxOutputTokens;
    }

    if (originalTextMaxRetries === undefined) {
      delete process.env.OPENAI_TEXT_MAX_RETRIES;
    } else {
      process.env.OPENAI_TEXT_MAX_RETRIES = originalTextMaxRetries;
    }

    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  it("returns deterministic fallback when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await generateMessengerReply({
      psid: "psid-1",
      userKey: "user-key-1",
      lang: "nl",
      stage: "AWAITING_PHOTO",
      text: "Hallo",
      hasPhoto: false,
    });

    expect(result).toEqual({
      text: "Stuur gerust een foto, dan kan ik een stijl voor je maken.",
      source: "fallback",
    });
  });

  it("returns Responses output and stores chat history", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ output_text: "Kies een stijl via de knoppen." }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateMessengerReply({
      psid: "psid-2",
      userKey: "user-key-2",
      lang: "nl",
      stage: "AWAITING_STYLE",
      text: "Wat moet ik nu doen?",
      hasPhoto: true,
    });

    expect(result).toEqual({
      text: "Kies een stijl via de knoppen.",
      source: "responses",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchCall = fetchMock.mock.calls[0];
    const requestInit = fetchCall?.[1] as RequestInit | undefined;
    const payload = JSON.parse(String(requestInit?.body)) as {
      model: string;
      max_output_tokens: number;
    };
    expect(payload.model).toBe("gpt-4.1-mini");
    expect(payload.max_output_tokens).toBe(160);

    const history = await getMessengerChatHistory("user-key-2");
    expect(history).toEqual([
      expect.objectContaining({ role: "user", text: "Wat moet ik nu doen?" }),
      expect.objectContaining({
        role: "assistant",
        text: "Kies een stijl via de knoppen.",
      }),
    ]);
  });

  it("falls back when the Responses request times out", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const timeoutError = new Error("timeout");
    timeoutError.name = "AbortError";
    const fetchMock = vi.fn(async () => {
      throw timeoutError;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateMessengerReply({
      psid: "psid-3",
      userKey: "user-key-3",
      lang: "en",
      stage: "AWAITING_PHOTO",
      text: "help",
      hasPhoto: false,
    });

    expect(result).toEqual({
      text: "Feel free to send a photo, then I can make a style for you.",
      source: "fallback",
    });
  });

  it("caps max_output_tokens and retries to avoid runaway cost", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_TEXT_MAX_OUTPUT_TOKENS = "999";
    process.env.OPENAI_TEXT_MAX_RETRIES = "10";

    const fetchMock = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        text: async () => "server unavailable",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateMessengerReply({
      psid: "psid-4",
      userKey: "user-key-4",
      lang: "nl",
      stage: "AWAITING_PHOTO",
      text: "help",
      hasPhoto: false,
    });

    expect(result.source).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const fetchCall = fetchMock.mock.calls[0];
    const requestInit = fetchCall?.[1] as RequestInit | undefined;
    const payload = JSON.parse(String(requestInit?.body)) as {
      max_output_tokens: number;
    };
    expect(payload.max_output_tokens).toBe(200);
  });
});

