import { randomUUID } from "node:crypto";
import type { ActiveExperience, IdentityGameSession } from "./activeExperience";
import type { BotResponse } from "./botResponse";
import type { EntryIntent } from "./entryIntent";
import { normalizeLang, t } from "./i18n";
import {
  applyIdentityAiV1Answer,
  buildIdentityAiV1QuestionResponse,
  createIdentityAiV1Session,
  generateIdentityAiV1ImageResponse,
  isIdentityAiV1GameId,
  isIdentityAiV1SessionResumable,
} from "./identityAiV1";
import {
  getIdentityGameSessionByActiveExperience,
  getIdentityGameSessionByUserId,
  upsertIdentityGameSession,
} from "./identityGameSessionState";
import type { MessengerUserState } from "./messengerState";

type ExperienceRouteResult = {
  handled: boolean;
  response?: BotResponse | null;
  afterSend?: (() => Promise<BotResponse | null>) | undefined;
};

type ExperienceRouterInput = {
  state: MessengerUserState;
  entryIntent?: EntryIntent | null;
  action?: string | null;
  setLastEntryIntent: (entryIntent: EntryIntent | null) => Promise<void>;
  setActiveExperience: (activeExperience: ActiveExperience | null) => Promise<void>;
};

function normalizeAction(action: string | null | undefined): string | null {
  const normalized = action?.trim();
  return normalized ? normalized : null;
}

function resolveRouterLang(input: ExperienceRouterInput): "nl" | "en" {
  return normalizeLang(
    input.entryIntent?.localeHint ??
      input.state.preferredLang ??
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

function isIdentityGameSessionActive(session: IdentityGameSession): boolean {
  if (session.expiresAt <= Date.now()) {
    return false;
  }

  return session.status === "started" || session.status === "in_progress";
}

async function findResumableSession(
  state: MessengerUserState,
  entryIntent: EntryIntent
): Promise<IdentityGameSession | null> {
  const activeSession = await Promise.resolve(
    getIdentityGameSessionByActiveExperience(state.activeExperience)
  );

  if (
    activeSession &&
    activeSession.gameId === entryIntent.targetExperienceId &&
    isIdentityGameSessionActive(activeSession)
  ) {
    return activeSession;
  }

  const existingSession = await Promise.resolve(
    getIdentityGameSessionByUserId(state.userKey)
  );

  if (
    existingSession &&
    existingSession.gameId === entryIntent.targetExperienceId &&
    isIdentityGameSessionActive(existingSession)
  ) {
    return existingSession;
  }

  return null;
}

function toActiveExperience(session: IdentityGameSession): ActiveExperience {
  return {
    type: "identity_game",
    id: session.gameId,
    sessionId: session.sessionId,
    status: session.status,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
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

  const resumableSession = await findResumableSession(input.state, input.entryIntent);
  const isAutoStart = input.entryIntent.entryMode !== "confirm_first";

  if (isIdentityAiV1GameId(input.entryIntent.targetExperienceId)) {
    const baseSession =
      resumableSession && isIdentityAiV1SessionResumable(resumableSession)
        ? {
            ...resumableSession,
            entryIntent: input.entryIntent,
            updatedAt: input.entryIntent.receivedAt,
          }
        : createIdentityAiV1Session(input.state, input.entryIntent);

    const session =
      isAutoStart && baseSession.status === "started"
        ? {
            ...baseSession,
            status: "in_progress" as const,
            updatedAt: input.entryIntent.receivedAt,
          }
        : baseSession;

    await Promise.resolve(upsertIdentityGameSession(session));
    await input.setActiveExperience(toActiveExperience(session));

    if (!isAutoStart) {
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
      response: buildIdentityAiV1QuestionResponse(session, lang),
    };
  }

  const session =
    resumableSession?.gameId === input.entryIntent.targetExperienceId
      ? {
          ...resumableSession,
          entryIntent: input.entryIntent,
          updatedAt: input.entryIntent.receivedAt,
        }
      : buildPlaceholderSession(input.state, input.entryIntent);

  await Promise.resolve(upsertIdentityGameSession(session));
  await input.setActiveExperience(toActiveExperience(session));

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
  const normalizedAction = action?.toUpperCase() ?? null;
  const lang = resolveRouterLang({
    ...input,
    entryIntent: input.state.lastEntryIntent,
  });

  if (normalizedAction === "LATER") {
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

  if (isIdentityAiV1GameId(activeSession.gameId)) {
    if (activeSession.status === "resolving" || activeSession.status === "completed") {
      return {
        handled: true,
        response: {
          kind: "error",
          text: t(lang, "identityGameSessionPending"),
        },
      };
    }

    if (normalizedAction === "START_GAME" && activeSession.status === "started") {
      const inProgressSession: IdentityGameSession = {
        ...activeSession,
        status: "in_progress",
        updatedAt: Date.now(),
      };
      await Promise.resolve(upsertIdentityGameSession(inProgressSession));
      await input.setActiveExperience(toActiveExperience(inProgressSession));
      return {
        handled: true,
        response: buildIdentityAiV1QuestionResponse(inProgressSession, lang),
      };
    }

    if (activeSession.status === "started") {
      return {
        handled: true,
        response: {
          kind: "error",
          text: t(lang, "identityGameSessionPending"),
        },
      };
    }

    if (!action) {
      return {
        handled: true,
        response: buildIdentityAiV1QuestionResponse(activeSession, lang, true),
      };
    }

    const answerResult = applyIdentityAiV1Answer(activeSession, action, Date.now(), lang);

    if (answerResult.kind === "invalid") {
      return {
        handled: true,
        response: answerResult.response,
      };
    }

    if (answerResult.kind === "question") {
      await Promise.resolve(upsertIdentityGameSession(answerResult.session));
      await input.setActiveExperience(toActiveExperience(answerResult.session));
      return {
        handled: true,
        response: answerResult.response,
      };
    }

    const resolvingSession = answerResult.session;
    await Promise.resolve(upsertIdentityGameSession(resolvingSession));
    await input.setActiveExperience(toActiveExperience(resolvingSession));

    return {
      handled: true,
      response: answerResult.response,
      afterSend: async () => {
        const imageResponse = await generateIdentityAiV1ImageResponse({
          session: resolvingSession,
          result: answerResult.result,
        });
        const completedAt = Date.now();
        const completedSession: IdentityGameSession = {
          ...resolvingSession,
          status: "completed",
          updatedAt: completedAt,
          resultRef: answerResult.result.archetype.id,
        };
        await Promise.resolve(upsertIdentityGameSession(completedSession));
        await input.setActiveExperience(null);
        return imageResponse;
      },
    };
  }

  if (normalizedAction === "START_GAME") {
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
