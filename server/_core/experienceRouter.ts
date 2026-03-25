import { randomUUID } from "node:crypto";
import type { ActiveExperience, IdentityGameSession } from "./activeExperience";
import type { BotResponse } from "./botResponse";
import type { EntryIntent } from "./entryIntent";
import {
  getIdentityGameSessionByActiveExperience,
  upsertIdentityGameSession,
} from "./identityGameSessionState";
import type { MessengerUserState } from "./messengerState";

type ExperienceRouteResult = {
  handled: boolean;
  response?: BotResponse | null;
};

type ExperienceRouterInput = {
  state: MessengerUserState;
  entryIntent?: EntryIntent | null;
  setLastEntryIntent: (entryIntent: EntryIntent | null) => Promise<void>;
  setActiveExperience: (activeExperience: ActiveExperience | null) => Promise<void>;
};

function buildPlaceholderSession(
  state: MessengerUserState,
  entryIntent: EntryIntent,
  activeExperience?: ActiveExperience | null
): IdentityGameSession {
  const startedAt = entryIntent.receivedAt;
  const sessionId = activeExperience?.sessionId ?? randomUUID();

  return {
    sessionId,
    userId: state.userKey,
    gameId: entryIntent.targetExperienceId,
    gameVersion: "v1",
    entryIntent,
    status: "started",
    answers: [],
    derivedTraits: {},
    startedAt,
    updatedAt: startedAt,
    expiresAt: startedAt + 24 * 60 * 60 * 1000,
  };
}

export async function routeEntryIntent(
  input: ExperienceRouterInput
): Promise<ExperienceRouteResult> {
  if (!input.entryIntent || input.entryIntent.targetExperienceType !== "identity_game") {
    return { handled: false };
  }

  await input.setLastEntryIntent(input.entryIntent);

  const existingSession = await Promise.resolve(
    getIdentityGameSessionByActiveExperience(input.state.activeExperience)
  );
  const session =
    existingSession?.gameId === input.entryIntent.targetExperienceId
      ? {
          ...existingSession,
          entryIntent: input.entryIntent,
          updatedAt: input.entryIntent.receivedAt,
        }
      : buildPlaceholderSession(
          input.state,
          input.entryIntent,
          input.state.activeExperience
        );

  await Promise.resolve(upsertIdentityGameSession(session));
  await input.setActiveExperience({
    type: "identity_game",
    id: session.gameId,
    sessionId: session.sessionId,
    status: session.status,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
  });

  if (input.entryIntent.entryMode === "confirm_first") {
    return {
      handled: true,
      response: {
        kind: "options_prompt",
        prompt: "Deze game-entry is herkend. Klaar om later te starten?",
        options: [
          { id: "START_GAME", title: "Start game" },
          { id: "LATER", title: "Later" },
        ],
        selectionMode: "single",
        fallbackText: "Antwoord met START_GAME of LATER.",
      },
    };
  }

  return {
    handled: true,
    response: {
      kind: "text",
      text: "Deze identity game-entry is herkend. De game flow zelf volgt in de volgende fase.",
    },
  };
}

export async function routeActiveExperience(
  input: Omit<ExperienceRouterInput, "entryIntent">
): Promise<ExperienceRouteResult> {
  const activeExperience = input.state.activeExperience;
  if (!activeExperience || activeExperience.type !== "identity_game") {
    return { handled: false };
  }

  const activeSession = await Promise.resolve(
    getIdentityGameSessionByActiveExperience(activeExperience)
  );

  if (!activeSession) {
    await input.setActiveExperience(null);
    return { handled: false };
  }

  return {
    handled: true,
    response: {
      kind: "error",
      text: "Je identity game-sessie is herkend, maar de game flow zelf is nog niet geactiveerd in deze fase.",
    },
  };
}
