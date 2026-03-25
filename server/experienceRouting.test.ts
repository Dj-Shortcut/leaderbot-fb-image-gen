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

import {
  processFacebookWebhookPayload,
  resetMessengerEventDedupe,
} from "./_core/messengerWebhook";
import { anonymizePsid, getState, resetStateStore } from "./_core/messengerState";
import {
  getIdentityGameSessionByActiveExperience,
  upsertIdentityGameSession,
} from "./_core/identityGameSessionState";
import { parseGameEntryIntent } from "./_core/entryIntent";
import { routeActiveExperience, routeEntryIntent } from "./_core/experienceRouter";

describe("experience routing", () => {
  beforeEach(() => {
    process.env.PRIVACY_PEPPER = "ci-test-pepper";
    resetStateStore();
    resetMessengerEventDedupe();
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();
  });

  it("prioritizes EntryIntent over generic onboarding for direct game links", async () => {
    const psid = "deep-link-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid, locale: "nl_BE" },
              postback: {
                payload: "GET_STARTED",
                referral: {
                  ref: "game:party-alter-ego?entryMode=confirm_first&campaignId=camp-1",
                },
              },
            },
          ],
        },
      ],
    });

    const state = getState(anonymizePsid(psid));
    expect(state?.lastEntryIntent?.targetExperienceId).toBe("party-alter-ego");
    expect(state?.activeExperience?.type).toBe("identity_game");
    expect(sendQuickRepliesMock).toHaveBeenCalledWith(
      psid,
      "Deze game-entry is herkend. Klaar om later te starten?",
      [
        { content_type: "text", title: "Start game", payload: "START_GAME" },
        { content_type: "text", title: "Later", payload: "LATER" },
      ]
    );
    expect(sendTextMock).not.toHaveBeenCalledWith(
      psid,
      expect.stringContaining("Stuur een foto")
    );
  });

  it("prioritizes ActiveExperience over greeting fallback once a game entry exists", async () => {
    const psid = "resume-game-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              postback: {
                payload: "GET_STARTED",
                referral: {
                  ref: "game:party-alter-ego?campaignId=camp-2",
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
              sender: { id: psid },
              message: {
                mid: "mid-follow-up",
                text: "hi",
              },
            },
          ],
        },
      ],
    });

    const state = getState(anonymizePsid(psid));
    expect(
      getIdentityGameSessionByActiveExperience(state?.activeExperience)
    ).not.toBeNull();
    expect(sendTextMock).toHaveBeenCalledWith(
      psid,
      "Je identity game-sessie is herkend, maar de game flow zelf is nog niet geactiveerd in deze fase."
    );
    expect(sendQuickRepliesMock).not.toHaveBeenCalled();
  });

  it("handles START_GAME within the active experience instead of dropping the quick reply", async () => {
    const psid = "confirm-game-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              postback: {
                payload: "GET_STARTED",
                referral: {
                  ref: "game:party-alter-ego?entryMode=confirm_first",
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
              sender: { id: psid },
              message: {
                mid: "mid-start-game",
                quick_reply: { payload: "START_GAME" },
              },
            },
          ],
        },
      ],
    });

    const state = getState(anonymizePsid(psid));
    expect(state?.activeExperience?.status).toBe("in_progress");
    expect(sendTextMock).toHaveBeenCalledWith(
      psid,
      "De game-start is bevestigd. De echte vraagflow volgt in de volgende fase."
    );
  });

  it("handles LATER within the active experience and releases thread ownership", async () => {
    const psid = "later-game-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              postback: {
                payload: "GET_STARTED",
                referral: {
                  ref: "game:party-alter-ego?entryMode=confirm_first",
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
              sender: { id: psid },
              message: {
                mid: "mid-later-game",
                quick_reply: { payload: "LATER" },
              },
            },
          ],
        },
      ],
    });

    const state = getState(anonymizePsid(psid));
    expect(state?.activeExperience).toBeNull();
    expect(sendTextMock).toHaveBeenCalledWith(
      psid,
      "Geen probleem. Deze game-link blijft herkenbaar voor later."
    );
  });

  it("creates a fresh session id when a different game entry replaces the current active experience", async () => {
    const state = {
      ...getState(anonymizePsid("replace-game-user"))!,
      psid: anonymizePsid("replace-game-user"),
      userKey: anonymizePsid("replace-game-user"),
      activeExperience: {
        type: "identity_game" as const,
        id: "party-alter-ego",
        sessionId: "existing-session-id",
        status: "started" as const,
        startedAt: 1710000000000,
        updatedAt: 1710000000000,
      },
    };

    const setLastEntryIntent = vi.fn(async () => {});
    const setActiveExperience = vi.fn(async () => {});

    const result = await routeEntryIntent({
      state,
      entryIntent: parseGameEntryIntent({
        channel: "messenger",
        ref: "game:which-vibe-are-you",
        receivedAt: 1710000100000,
      }),
      setLastEntryIntent,
      setActiveExperience,
    });

    expect(result.handled).toBe(true);
    expect(setActiveExperience).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "which-vibe-are-you",
        sessionId: expect.not.stringMatching(/^existing-session-id$/),
      })
    );
  });

  it("prefers entryIntent localeHint over preferredLang when resolving router copy", async () => {
    const setLastEntryIntent = vi.fn(async () => {});
    const setActiveExperience = vi.fn(async () => {});

    const result = await routeEntryIntent({
      state: {
        ...getState(anonymizePsid("locale-priority-user"))!,
        psid: anonymizePsid("locale-priority-user"),
        userKey: anonymizePsid("locale-priority-user"),
        preferredLang: "nl",
      },
      entryIntent: parseGameEntryIntent({
        channel: "messenger",
        ref: "game:party-alter-ego?entryMode=confirm_first&locale=en",
        receivedAt: 1710000200000,
      }),
      setLastEntryIntent,
      setActiveExperience,
    });

    expect(result).toEqual({
      handled: true,
      response: {
        kind: "options_prompt",
        prompt: "This game entry was recognized. Ready to start later?",
        options: [
          { id: "START_GAME", title: "Start game" },
          { id: "LATER", title: "Later" },
        ],
        selectionMode: "single",
        fallbackText: "Reply with START_GAME or LATER.",
      },
    });
  });

  it("treats expired active sessions as missing", async () => {
    const userKey = anonymizePsid("expired-session-user");
    upsertIdentityGameSession({
      sessionId: "expired-session-id",
      userId: userKey,
      gameId: "party-alter-ego",
      gameVersion: "v1",
      entryIntent: {
        sourceChannel: "messenger",
        sourceType: "referral",
        targetExperienceType: "identity_game",
        targetExperienceId: "party-alter-ego",
        receivedAt: 1710000000000,
      },
      status: "started",
      answers: [],
      derivedTraits: {},
      startedAt: 1710000000000,
      updatedAt: 1710000000000,
      expiresAt: Date.now() - 1000,
    });

    const setLastEntryIntent = vi.fn(async () => {});
    const setActiveExperience = vi.fn(async () => {});

    const result = await routeActiveExperience({
      state: {
        ...getState(userKey)!,
        psid: userKey,
        userKey,
        activeExperience: {
          type: "identity_game",
          id: "party-alter-ego",
          sessionId: "expired-session-id",
          status: "started",
          startedAt: 1710000000000,
          updatedAt: 1710000000000,
        },
      },
      action: null,
      setLastEntryIntent,
      setActiveExperience,
    });

    expect(result).toEqual({ handled: false });
    expect(setActiveExperience).toHaveBeenCalledWith(null);
  });

  it("keeps mandatory routing order by letting ActiveExperience win over explicit legacy commands", async () => {
    const psid = "active-before-command-user";

    await processFacebookWebhookPayload({
      entry: [
        {
          messaging: [
            {
              sender: { id: psid },
              postback: {
                payload: "GET_STARTED",
                referral: {
                  ref: "game:party-alter-ego",
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
              sender: { id: psid },
              postback: { payload: "CHOOSE_STYLE" },
            },
          ],
        },
      ],
    });

    const state = getState(anonymizePsid(psid));
    expect(state?.activeExperience?.type).toBe("identity_game");
    expect(sendTextMock).toHaveBeenCalledWith(
      psid,
      "Je identity game-sessie is herkend, maar de game flow zelf is nog niet geactiveerd in deze fase."
    );
    expect(sendQuickRepliesMock).not.toHaveBeenCalled();
  });
});
