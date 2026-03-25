import { describe, expect, it } from "vitest";
import type { ActiveExperience } from "./_core/activeExperience";
import {
  clearIdentityGameSession,
  getIdentityGameSessionByActiveExperience,
  getIdentityGameSessionBySessionId,
  getIdentityGameSessionByUserId,
  upsertIdentityGameSession,
} from "./_core/identityGameSessionState";
import { resetStateStore } from "./_core/messengerState";

describe("identityGameSessionState", () => {
  it("retrieves sessions by userId, sessionId, and activeExperience reference", () => {
    resetStateStore();

    const session = {
      sessionId: "session-1",
      userId: "user-1",
      gameId: "party-alter-ego",
      gameVersion: "v1",
      entryIntent: {
        sourceChannel: "messenger" as const,
        sourceType: "referral" as const,
        targetExperienceType: "identity_game" as const,
        targetExperienceId: "party-alter-ego",
        receivedAt: 1710000000000,
      },
      status: "started" as const,
      answers: [],
      derivedTraits: {},
      startedAt: 1710000000000,
      updatedAt: 1710000000000,
      expiresAt: 1710086400000,
    };

    upsertIdentityGameSession(session);

    expect(getIdentityGameSessionBySessionId("session-1")).toEqual(session);
    expect(getIdentityGameSessionByUserId("user-1")).toEqual(session);

    const activeExperience: ActiveExperience = {
      type: "identity_game",
      id: "party-alter-ego",
      sessionId: "session-1",
      status: "started",
      startedAt: 1710000000000,
      updatedAt: 1710000000000,
    };

    expect(getIdentityGameSessionByActiveExperience(activeExperience)).toEqual(
      session
    );

    clearIdentityGameSession("session-1", "user-1");
    expect(getIdentityGameSessionBySessionId("session-1")).toBeNull();
    expect(getIdentityGameSessionByUserId("user-1")).toBeNull();
  });
});
