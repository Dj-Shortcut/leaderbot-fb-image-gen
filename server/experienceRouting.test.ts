import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  sendImageMock,
  sendQuickRepliesMock,
  sendTextMock,
  safeLogMock,
} = vi.hoisted(() => ({
  sendImageMock: vi.fn(async () => undefined),
  sendQuickRepliesMock: vi.fn(async () => undefined),
  sendTextMock: vi.fn(async () => undefined),
  safeLogMock: vi.fn(),
}));

vi.mock("./_core/messengerApi", () => ({
  sendImage: sendImageMock,
  sendQuickReplies: sendQuickRepliesMock,
  sendText: sendTextMock,
  safeLog: safeLogMock,
}));

import type { IdentityGameSession } from "./_core/activeExperience";
import {
  OpenAiImageGenerator,
} from "./_core/imageService";
import {
  processFacebookWebhookPayload,
  resetMessengerEventDedupe,
} from "./_core/messengerWebhook";
import { getIdentityGameSessionByUserId, upsertIdentityGameSession } from "./_core/identityGameSessionState";
import { parseGameEntryIntent } from "./_core/entryIntent";
import { routeActiveExperience, routeEntryIntent } from "./_core/experienceRouter";
import { anonymizePsid, getOrCreateState, getState, resetStateStore } from "./_core/messengerState";

describe("identity-ai-v1 routing", () => {
  beforeEach(() => {
    process.env.PRIVACY_PEPPER = "ci-test-pepper";
    resetStateStore();
    resetMessengerEventDedupe();
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
  });

  it("auto-start deep links send question 1 immediately without touching legacy style state", async () => {
    const psid = "identity-ai-v1-deep-link-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid, locale: "nl_BE" },
              postback: {
                payload: "GET_STARTED",
                referral: {
                  ref: "game:identity-ai-v1?locale=en",
                },
              },
            },
          ],
        },
      ],
    });

    const state = getState(anonymizePsid(psid));
    expect(state?.activeExperience?.type).toBe("identity_game");
    expect(state?.activeExperience?.id).toBe("identity-ai-v1");
    expect(state?.selectedStyle).toBeNull();
    expect(state?.preselectedStyle).toBeNull();
    expect(state?.stage).toBe("IDLE");
    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      psid,
      "When a new AI tool drops, what do you do first?",
      [
        {
          content_type: "text",
          title: "Open it and start making something",
          payload: "q1_build",
        },
        {
          content_type: "text",
          title: "Imagine what it could become",
          payload: "q1_vision",
        },
        {
          content_type: "text",
          title: "Figure out how it actually works",
          payload: "q1_analyst",
        },
        {
          content_type: "text",
          title: "See where it fits in a system",
          payload: "q1_operate",
        },
      ]
    );
  });

  it("resumes the same active non-expired game at the current question", async () => {
    const userKey = anonymizePsid("identity-ai-v1-resume-user");
    await upsertIdentityGameSession({
      sessionId: "resume-session",
      userId: userKey,
      gameId: "identity-ai-v1",
      gameVersion: "v1",
      entryIntent: {
        sourceChannel: "messenger",
        sourceType: "referral",
        targetExperienceType: "identity_game",
        targetExperienceId: "identity-ai-v1",
        receivedAt: 1710000000000,
      },
      status: "in_progress",
      currentQuestionId: "identity-ai-v1-q2",
      answers: [
        {
          questionId: "identity-ai-v1-q1",
          answerId: "q1_build",
          recordedAt: 1710000001000,
        },
      ],
      derivedTraits: {},
      startedAt: 1710000000000,
      updatedAt: 1710000001000,
      expiresAt: Date.now() + 60_000,
    });

    const setLastEntryIntent = vi.fn(async () => undefined);
    const setActiveExperience = vi.fn(async () => undefined);

    const result = await routeEntryIntent({
      state: {
        ...(await Promise.resolve(getOrCreateState(userKey))),
        psid: userKey,
        userKey,
      },
      entryIntent: parseGameEntryIntent({
        channel: "messenger",
        ref: "game:identity-ai-v1?locale=en",
        receivedAt: 1710000002000,
      }),
      setLastEntryIntent,
      setActiveExperience,
    });

    expect(result).toEqual({
      handled: true,
      response: {
        kind: "options_prompt",
        prompt: "What kind of result feels most satisfying to you?",
        options: [
          { id: "q2_build", title: "A finished thing I can use now" },
          { id: "q2_vision", title: "A bold idea no one saw coming" },
          { id: "q2_analyst", title: "A clean answer that makes sense" },
          { id: "q2_operate", title: "A process that runs smoothly" },
        ],
        selectionMode: "single",
        fallbackText: [
          "What kind of result feels most satisfying to you?",
          "1. A finished thing I can use now",
          "2. A bold idea no one saw coming",
          "3. A clean answer that makes sense",
          "4. A process that runs smoothly",
          "Reply with one of these exact options:",
        ].join("\n"),
      },
    });
  });

  it("does not silently reuse a different game's session", async () => {
    const userKey = anonymizePsid("identity-ai-v1-replace-user");
    const setLastEntryIntent = vi.fn(async () => undefined);
    const setActiveExperience = vi.fn(async () => undefined);

    const result = await routeEntryIntent({
      state: {
        ...(await Promise.resolve(getOrCreateState(userKey))),
        psid: userKey,
        userKey,
        activeExperience: {
          type: "identity_game",
          id: "which-vibe-are-you",
          sessionId: "old-session-id",
          status: "in_progress",
          startedAt: 1710000000000,
          updatedAt: 1710000000000,
        },
      },
      entryIntent: parseGameEntryIntent({
        channel: "messenger",
        ref: "game:identity-ai-v1?locale=en",
        receivedAt: 1710000010000,
      }),
      setLastEntryIntent,
      setActiveExperience,
    });

    expect(result.handled).toBe(true);
    expect(setActiveExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "identity-ai-v1",
        sessionId: expect.not.stringMatching(/^old-session-id$/),
      })
    );
  });

  it("re-prompts the same question on invalid input", async () => {
    const userKey = anonymizePsid("identity-ai-v1-invalid-user");
    const setActiveExperience = vi.fn(async () => undefined);

    await upsertIdentityGameSession({
      sessionId: "invalid-session",
      userId: userKey,
      gameId: "identity-ai-v1",
      gameVersion: "v1",
      entryIntent: {
        sourceChannel: "messenger",
        sourceType: "referral",
        targetExperienceType: "identity_game",
        targetExperienceId: "identity-ai-v1",
        localeHint: "en",
        receivedAt: 1710000000000,
      },
      status: "in_progress",
      currentQuestionId: "identity-ai-v1-q1",
      answers: [],
      derivedTraits: {},
      startedAt: 1710000000000,
      updatedAt: 1710000000000,
      expiresAt: Date.now() + 60_000,
    });

    const result = await routeActiveExperience({
      state: {
        ...(await Promise.resolve(getOrCreateState(userKey))),
        psid: userKey,
        userKey,
        lastEntryIntent: {
          sourceChannel: "messenger",
          sourceType: "referral",
          targetExperienceType: "identity_game",
          targetExperienceId: "identity-ai-v1",
          localeHint: "en",
          receivedAt: 1710000000000,
        },
        activeExperience: {
          type: "identity_game",
          id: "identity-ai-v1",
          sessionId: "invalid-session",
          status: "in_progress",
          startedAt: 1710000000000,
          updatedAt: 1710000000000,
        },
      },
      action: "not-an-option",
      setLastEntryIntent: vi.fn(async () => undefined),
      setActiveExperience,
    });

    expect(result).toEqual({
      handled: true,
      response: {
        kind: "options_prompt",
        prompt:
          "That answer does not match one of the 4 choices.\n\nWhen a new AI tool drops, what do you do first?",
        options: [
          { id: "q1_build", title: "Open it and start making something" },
          { id: "q1_vision", title: "Imagine what it could become" },
          { id: "q1_analyst", title: "Figure out how it actually works" },
          { id: "q1_operate", title: "See where it fits in a system" },
        ],
        selectionMode: "single",
        fallbackText: [
          "That answer does not match one of the 4 choices.",
          "When a new AI tool drops, what do you do first?",
          "1. Open it and start making something",
          "2. Imagine what it could become",
          "3. Figure out how it actually works",
          "4. See where it fits in a system",
          "Reply with one of these exact options:",
        ].join("\n"),
      },
    });
    expect(setActiveExperience).not.toHaveBeenCalled();
  });

  it("keeps mandatory routing order by letting the active game win over legacy commands", async () => {
    const psid = "identity-ai-v1-routing-order-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid, locale: "en_US" },
              postback: {
                payload: "GET_STARTED",
                referral: {
                  ref: "game:identity-ai-v1?locale=en",
                },
              },
            },
          ],
        },
      ],
    });

    sendTextMock.mockClear();
    sendQuickRepliesMock.mockClear();

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid, locale: "en_US" },
              postback: { payload: "CHOOSE_STYLE" },
            },
          ],
        },
      ],
    });

    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      psid,
      "That answer does not match one of the 4 choices.\n\nWhen a new AI tool drops, what do you do first?",
      expect.any(Array)
    );
    expect(sendTextMock).not.toHaveBeenCalledWith(
      psid,
      expect.stringContaining("Pick a style")
    );
  });

  it("completes after three valid answers, resolves one archetype, sends text first, and releases ActiveExperience", async () => {
    const userKey = anonymizePsid("identity-ai-v1-complete-user");
    const setActiveExperience = vi.fn(async () => undefined);
    const generateSpy = vi
      .spyOn(OpenAiImageGenerator.prototype, "generate")
      .mockResolvedValue({
        imageUrl: "https://example.com/identity-builder.jpg",
        proof: {
          incomingLen: 0,
          incomingSha256: "0",
          openaiInputLen: 0,
          openaiInputSha256: "0",
        },
        metrics: { totalMs: 12 },
      });

    try {
      await upsertIdentityGameSession({
        sessionId: "complete-session",
        userId: userKey,
        gameId: "identity-ai-v1",
        gameVersion: "v1",
        entryIntent: {
          sourceChannel: "messenger",
          sourceType: "referral",
          targetExperienceType: "identity_game",
          targetExperienceId: "identity-ai-v1",
          localeHint: "en",
          receivedAt: 1710000000000,
        },
        status: "in_progress",
        currentQuestionId: "identity-ai-v1-q3",
        answers: [
          {
            questionId: "identity-ai-v1-q1",
            answerId: "q1_build",
            recordedAt: 1710000001000,
          },
          {
            questionId: "identity-ai-v1-q2",
            answerId: "q2_build",
            recordedAt: 1710000002000,
          },
        ],
        derivedTraits: {},
        startedAt: 1710000000000,
        updatedAt: 1710000002000,
        expiresAt: Date.now() + 60_000,
      });

      const result = await routeActiveExperience({
        state: {
          ...(await Promise.resolve(getOrCreateState(userKey))),
          psid: userKey,
          userKey,
          lastEntryIntent: {
            sourceChannel: "messenger",
            sourceType: "referral",
            targetExperienceType: "identity_game",
            targetExperienceId: "identity-ai-v1",
            localeHint: "en",
            receivedAt: 1710000000000,
          },
          activeExperience: {
            type: "identity_game",
            id: "identity-ai-v1",
            sessionId: "complete-session",
            status: "in_progress",
            startedAt: 1710000000000,
            updatedAt: 1710000002000,
          },
        },
        action: "q3_build",
        setLastEntryIntent: vi.fn(async () => undefined),
        setActiveExperience,
      });

      expect(result.handled).toBe(true);
      expect(result.response).toEqual({
        kind: "text",
        text: [
          "You are: Builder",
          "Your dominant AI instinct is to turn momentum into something real.",
          "Your answers kept leaning toward making, shipping, and moving fast.",
          "Want another round? Open the game link again.",
        ].join("\n\n"),
      });

      const imageResponse = await result.afterSend?.();
      expect(imageResponse).toEqual({
        kind: "image",
        imageUrl: "https://example.com/identity-builder.jpg",
        caption: "You are: Builder",
      });
      expect(setActiveExperience).toHaveBeenLastCalledWith(null);
      const storedSession = await Promise.resolve(getIdentityGameSessionByUserId(userKey));
      expect(storedSession?.status).toBe("completed");
      expect(storedSession?.resultRef).toBe("builder");
    } finally {
      generateSpy.mockRestore();
    }
  });

  it("still completes when result image generation fails", async () => {
    const userKey = anonymizePsid("identity-ai-v1-image-fail-user");
    const setActiveExperience = vi.fn(async () => undefined);
    const generateSpy = vi
      .spyOn(OpenAiImageGenerator.prototype, "generate")
      .mockRejectedValue(new Error("generation failed"));

    try {
      await upsertIdentityGameSession({
        sessionId: "image-fail-session",
        userId: userKey,
        gameId: "identity-ai-v1",
        gameVersion: "v1",
        entryIntent: {
          sourceChannel: "messenger",
          sourceType: "referral",
          targetExperienceType: "identity_game",
          targetExperienceId: "identity-ai-v1",
          localeHint: "en",
          receivedAt: 1710000000000,
        },
        status: "in_progress",
        currentQuestionId: "identity-ai-v1-q3",
        answers: [
          {
            questionId: "identity-ai-v1-q1",
            answerId: "q1_analyst",
            recordedAt: 1710000001000,
          },
          {
            questionId: "identity-ai-v1-q2",
            answerId: "q2_analyst",
            recordedAt: 1710000002000,
          },
        ],
        derivedTraits: {},
        startedAt: 1710000000000,
        updatedAt: 1710000002000,
        expiresAt: Date.now() + 60_000,
      });

      const result = await routeActiveExperience({
        state: {
          ...(await Promise.resolve(getOrCreateState(userKey))),
          psid: userKey,
          userKey,
          lastEntryIntent: {
            sourceChannel: "messenger",
            sourceType: "referral",
            targetExperienceType: "identity_game",
            targetExperienceId: "identity-ai-v1",
            localeHint: "en",
            receivedAt: 1710000000000,
          },
          activeExperience: {
            type: "identity_game",
            id: "identity-ai-v1",
            sessionId: "image-fail-session",
            status: "in_progress",
            startedAt: 1710000000000,
            updatedAt: 1710000002000,
          },
        },
        action: "q3_analyst",
        setLastEntryIntent: vi.fn(async () => undefined),
        setActiveExperience,
      });

      expect(result.response).toEqual({
        kind: "text",
        text: [
          "You are: Analyst",
          "Your dominant AI instinct is to decode patterns before you commit.",
          "Your answers kept favoring clarity, logic, and understanding the system.",
          "Want another round? Open the game link again.",
        ].join("\n\n"),
      });
      await expect(result.afterSend?.()).resolves.toBeNull();
      expect(setActiveExperience).toHaveBeenLastCalledWith(null);
      const storedSession = await Promise.resolve(getIdentityGameSessionByUserId(userKey));
      expect(storedSession?.status).toBe("completed");
    } finally {
      generateSpy.mockRestore();
    }
  });

  it("falls back to normal thread handling after game completion", async () => {
    const psid = "identity-ai-v1-post-complete-user";
    const generateSpy = vi
      .spyOn(OpenAiImageGenerator.prototype, "generate")
      .mockResolvedValue({
        imageUrl: "https://example.com/identity-visionary.jpg",
        proof: {
          incomingLen: 0,
          incomingSha256: "0",
          openaiInputLen: 0,
          openaiInputSha256: "0",
        },
        metrics: { totalMs: 8 },
      });

    try {
      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: psid, locale: "en_US" },
                postback: {
                  payload: "GET_STARTED",
                  referral: {
                    ref: "game:identity-ai-v1?locale=en",
                  },
                },
              },
            ],
          },
        ],
      });

      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: psid, locale: "en_US" },
                message: {
                  mid: "mid-q1",
                  quick_reply: { payload: "q1_vision" },
                },
              },
            ],
          },
        ],
      });
      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: psid, locale: "en_US" },
                message: {
                  mid: "mid-q2",
                  quick_reply: { payload: "q2_vision" },
                },
              },
            ],
          },
        ],
      });

      sendTextMock.mockClear();
      sendQuickRepliesMock.mockClear();

      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: psid, locale: "en_US" },
                message: {
                  mid: "mid-q3",
                  quick_reply: { payload: "q3_vision" },
                },
              },
            ],
          },
        ],
      });

      const completedState = getState(anonymizePsid(psid));
      expect(completedState?.activeExperience).toBeNull();

      sendTextMock.mockClear();
      sendQuickRepliesMock.mockClear();

      await processFacebookWebhookPayload({
        entry: [
          {
            messaging: [
              {
                sender: { id: psid, locale: "en_US" },
                message: {
                  mid: "mid-after-complete",
                  text: "hi",
                },
              },
            ],
          },
        ],
      });

      expect(getState(anonymizePsid(psid))?.activeExperience).toBeNull();
      expect(sendTextMock).not.toHaveBeenCalledWith(
        psid,
        expect.stringContaining("You are:")
      );
    } finally {
      generateSpy.mockRestore();
    }
  });
});
