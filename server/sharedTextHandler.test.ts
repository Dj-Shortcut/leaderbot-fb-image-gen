import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { safeLogMock, generateMessengerReplyMock } = vi.hoisted(() => ({
  safeLogMock: vi.fn(),
  generateMessengerReplyMock: vi.fn(),
}));

vi.mock("./_core/messengerApi", () => ({
  safeLog: safeLogMock,
}));

vi.mock("./_core/messengerResponsesService", () => ({
  generateMessengerReply: generateMessengerReplyMock,
}));

import { t } from "./_core/i18n";
import { handleSharedTextMessage } from "./_core/sharedTextHandler";
import type { MessengerUserState } from "./_core/messengerState";

const originalEngine = process.env.MESSENGER_CHAT_ENGINE;
const originalCanary = process.env.MESSENGER_CHAT_CANARY_PERCENT;

function createState(
  overrides: Partial<MessengerUserState> = {}
): MessengerUserState {
  return {
    psid: "psid-1",
    userKey: "user-key-1",
    stage: "IDLE",
    state: "IDLE",
    lastPhotoUrl: null,
    lastPhoto: null,
    selectedStyle: null,
    chosenStyle: null,
    selectedStyleCategory: null,
    preselectedStyle: null,
    preferredLang: "nl",
    hasSeenIntro: false,
    lastGeneratedUrl: null,
    quota: {
      dayKey: "2026-03-20",
      count: 0,
    },
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("sharedTextHandler", () => {
  beforeEach(() => {
    delete process.env.MESSENGER_CHAT_ENGINE;
    delete process.env.MESSENGER_CHAT_CANARY_PERCENT;
    safeLogMock.mockReset();
    generateMessengerReplyMock.mockReset();
  });

  afterEach(() => {
    if (originalEngine === undefined) {
      delete process.env.MESSENGER_CHAT_ENGINE;
    } else {
      process.env.MESSENGER_CHAT_ENGINE = originalEngine;
    }

    if (originalCanary === undefined) {
      delete process.env.MESSENGER_CHAT_CANARY_PERCENT;
    } else {
      process.env.MESSENGER_CHAT_CANARY_PERCENT = originalCanary;
    }
  });

  it("returns intro response metadata for a new greeting", async () => {
    const result = await handleSharedTextMessage({
      message: {
        channel: "messenger",
        senderId: "psid-1",
        userId: "user-key-1",
        messageType: "text",
        textBody: "Hi",
      },
      reqId: "req-1",
      lang: "nl",
      getState: async () => createState(),
      setFlowState: async () => {},
    });

    expect(result).toEqual({
      response: {
        kind: "text",
        text: t("nl", "flowExplanation"),
      },
      replyState: "IDLE",
      afterSend: "markIntroSeen",
    });
  });

  it("returns no response for acknowledgement text and logs the ignored ack", async () => {
    const logAckIgnored = vi.fn();

    const result = await handleSharedTextMessage({
      message: {
        channel: "messenger",
        senderId: "psid-1",
        userId: "user-key-1",
        messageType: "text",
        textBody: "ok",
      },
      reqId: "req-ack",
      lang: "nl",
      getState: async () => createState(),
      setFlowState: async () => {},
      logAckIgnored,
    });

    expect(result).toEqual({ response: null });
    expect(logAckIgnored).toHaveBeenCalledWith("ok");
  });

  it("returns the style picker response metadata when a photo is already present", async () => {
    const setFlowState = vi.fn(async () => {});

    const result = await handleSharedTextMessage({
      message: {
        channel: "whatsapp",
        senderId: "wa-user",
        userId: "wa-user-key",
        messageType: "text",
        textBody: "new style",
      },
      reqId: "req-style",
      lang: "en",
      getState: async () =>
        createState({
          psid: "wa-user",
          userKey: "wa-user-key",
          lastPhotoUrl: "https://img.example/photo.jpg",
          lastPhoto: "https://img.example/photo.jpg",
        }),
      setFlowState,
    });

    expect(setFlowState).toHaveBeenCalledWith("AWAITING_STYLE");
    expect(result).toEqual({
      response: { kind: "text", text: t("en", "styleCategoryPicker") },
      replyState: "AWAITING_STYLE",
    });
  });

  it("returns the generated reply when responses rollout is enabled", async () => {
    process.env.MESSENGER_CHAT_ENGINE = "responses";
    process.env.MESSENGER_CHAT_CANARY_PERCENT = "100";
    generateMessengerReplyMock.mockResolvedValue({
      text: "Generated response",
      source: "responses",
    });

    const result = await handleSharedTextMessage({
      message: {
        channel: "messenger",
        senderId: "psid-2",
        userId: "user-key-2",
        messageType: "text",
        textBody: "Can you help me?",
      },
      reqId: "req-rollout",
      lang: "en",
      getState: async () =>
        createState({
          psid: "psid-2",
          userKey: "user-key-2",
          stage: "AWAITING_STYLE",
          state: "AWAITING_STYLE",
          hasSeenIntro: true,
          lastPhotoUrl: "https://img.example/input.jpg",
          lastPhoto: "https://img.example/input.jpg",
        }),
      setFlowState: async () => {},
    });

    expect(generateMessengerReplyMock).toHaveBeenCalledWith({
      psid: "psid-2",
      userKey: "user-key-2",
      lang: "en",
      stage: "AWAITING_STYLE",
      text: "Can you help me?",
      hasPhoto: true,
    });
    expect(result).toEqual({
      response: { kind: "text", text: "Generated response" },
    });
  });

  it("falls back to the no-photo guidance when the responses engine fails", async () => {
    process.env.MESSENGER_CHAT_ENGINE = "responses";
    process.env.MESSENGER_CHAT_CANARY_PERCENT = "100";
    generateMessengerReplyMock.mockRejectedValue(new Error("boom"));

    const setFlowState = vi.fn(async () => {});
    const logEngineResult = vi.fn();

    const result = await handleSharedTextMessage({
      message: {
        channel: "messenger",
        senderId: "psid-3",
        userId: "user-key-3",
        messageType: "text",
        textBody: "Help",
      },
      reqId: "req-fallback",
      lang: "en",
      getState: async () =>
        createState({
          psid: "psid-3",
          userKey: "user-key-3",
          hasSeenIntro: true,
        }),
      setFlowState,
      logEngineResult,
    });

    expect(logEngineResult).toHaveBeenCalledWith({
      source: "fallback",
      errorCode: "Error",
    });
    expect(result).toEqual({
      response: {
        kind: "text",
        text: t("en", "textWithoutPhoto"),
      },
    });
  });
});
