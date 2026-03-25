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
} from "./_core/identityGameSessionState";

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
});
