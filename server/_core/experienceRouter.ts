import { randomUUID } from "node:crypto";
import type { ActiveExperience, IdentityGameSession } from "./activeExperience";
import type { BotResponse } from "./botResponse";
import type { EntryIntent } from "./entryIntent";
import { normalizeLang, t } from "./i18n";
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
  action?: string | null;
  setLastEntryIntent: (entryIntent: EntryIntent | null) => Promise<void>;
  setActiveExperience: (activeExperience: ActiveExperience | null) => Promise<void>;
};

function normalizeAction(action: string | null | undefined): string | null {
  const normalized = action?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function resolveRouterLang(input: ExperienceRouterInput): "nl" | "en" {
  return normalizeLang(
    input.state.preferredLang ??
      input.entryIntent?.localeHint ??
      input.state.lastEntryIntent?.localeHint
  );
}

function buildPlaceholderSession(
  state: MessengerUserState,
  entryIntent: EntryIntent
): IdentityGameSession {
  const startedAt = entryIntent.receivedAt;
  const sessionId = randomUUID();

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
  const lang = resolveRouterLang(input);

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
      : buildPlaceholderSession(input.state, input.entryIntent);

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
        prompt: t(lang, "identityGameConfirmFirstPrompt"),
        options: [
          { id: "START_GAME", title: t(lang, "identityGameConfirmStart") },
          { id: "LATER", title: t(lang, "identityGameConfirmLater") },
        ],
        selectionMode: "single",
        fallbackText:
          lang === "en"
            ? "Reply with START_GAME or LATER."
            : "Antwoord met START_GAME of LATER.",
      },
    };
  }

  return {
    handled: true,
    response: {
      kind: "text",
      text: t(lang, "identityGameEntryRecognized"),
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

  const action = normalizeAction(input.action);
  const lang = resolveRouterLang({
    ...input,
    entryIntent: input.state.lastEntryIntent,
  });

  if (action === "LATER") {
    const abandonedSession: IdentityGameSession = {
      ...activeSession,
      status: "abandoned",
      updatedAt: Date.now(),
    };
    await Promise.resolve(upsertIdentityGameSession(abandonedSession));
    await input.setActiveExperience(null);
    return {
      handled: true,
      response: {
        kind: "text",
        text: t(lang, "identityGameDeferred"),
      },
    };
  }

  if (action === "START_GAME") {
    const inProgressSession: IdentityGameSession = {
      ...activeSession,
      status: "in_progress",
      updatedAt: Date.now(),
    };
    await Promise.resolve(upsertIdentityGameSession(inProgressSession));
    await input.setActiveExperience({
      ...activeExperience,
      status: "in_progress",
      updatedAt: inProgressSession.updatedAt,
    });
    return {
      handled: true,
      response: {
        kind: "text",
        text: t(lang, "identityGameStartConfirmed"),
      },
    };
  }

  return {
    handled: true,
    response: {
      kind: "error",
      text: t(lang, "identityGameSessionPending"),
    },
  };
}
