import type { IdentityGameSession } from "./activeExperience";
import type { BotResponse } from "./botResponse";
import type { EntryIntent } from "./entryIntent";
import type { Lang } from "./i18n";
import type { MessengerUserState } from "./messengerState";
import {
  applyIdentityAiV1Answer,
  buildIdentityAiV1QuestionResponse,
  createIdentityAiV1Session,
  generateIdentityAiV1ImageResponse,
  IDENTITY_AI_V1_GAME_ID,
  isIdentityAiV1SessionResumable,
} from "./identityAiV1";

export type GameControlAction = "START_GAME" | "LATER";

export type StartGameInput = {
  state: MessengerUserState;
  entryIntent: EntryIntent;
  resumableSession: IdentityGameSession | null;
  lang: Lang;
  isAutoStart: boolean;
};

export type StartGameResult = {
  session: IdentityGameSession;
  response: BotResponse;
};

export type HandleGameActionInput = {
  session: IdentityGameSession;
  action: string | null;
  controlAction: GameControlAction | null;
  lang: Lang;
};

export type HandleGameActionResult = {
  session: IdentityGameSession | null;
  clearActiveExperience?: boolean;
  response: BotResponse;
  afterSend?: (() => Promise<BotResponse | null>) | undefined;
};

export type IdentityGameHandler = {
  gameId: string;
  isResumable: (session: IdentityGameSession | null) => session is IdentityGameSession;
  startSession: (input: StartGameInput) => Promise<StartGameResult>;
  handleAction: (input: HandleGameActionInput) => Promise<HandleGameActionResult>;
};

function buildConfirmFirstResponse(lang: Lang): BotResponse {
  return {
    kind: "options_prompt",
    prompt:
      lang === "en"
        ? "This game entry was recognized. Ready to start later?"
        : "Deze game-entry is herkend. Klaar om later te starten?",
    options: [
      { id: "START_GAME", title: lang === "en" ? "Start game" : "Start game" },
      { id: "LATER", title: lang === "en" ? "Later" : "Later" },
    ],
    selectionMode: "single",
    fallbackText:
      lang === "en"
        ? "Reply with START_GAME or LATER."
        : "Antwoord met START_GAME of LATER.",
  };
}

const identityAiV1Handler: IdentityGameHandler = {
  gameId: IDENTITY_AI_V1_GAME_ID,
  isResumable: isIdentityAiV1SessionResumable,
  async startSession(input) {
    const baseSession =
      input.resumableSession && isIdentityAiV1SessionResumable(input.resumableSession)
        ? {
            ...input.resumableSession,
            entryIntent: input.entryIntent,
            updatedAt: input.entryIntent.receivedAt,
          }
        : createIdentityAiV1Session(input.state, input.entryIntent);

    const session =
      input.isAutoStart && baseSession.status === "started"
        ? {
            ...baseSession,
            status: "in_progress" as const,
            updatedAt: input.entryIntent.receivedAt,
          }
        : baseSession;

    if (!input.isAutoStart) {
      return {
        session,
        response: buildConfirmFirstResponse(input.lang),
      };
    }

    return {
      session,
      response: buildIdentityAiV1QuestionResponse(session, input.lang),
    };
  },
  async handleAction(input) {
    if (input.session.status === "resolving" || input.session.status === "completed") {
      return {
        session: input.session,
        response: {
          kind: "error",
          text:
            input.lang === "en"
              ? "Your identity game session was recognized, but the actual game flow is not enabled in this phase yet."
              : "Je identity game-sessie is herkend, maar de game flow zelf is nog niet geactiveerd in deze fase.",
        },
      };
    }

    if (input.controlAction === "START_GAME" && input.session.status === "started") {
      const inProgressSession: IdentityGameSession = {
        ...input.session,
        status: "in_progress",
        updatedAt: Date.now(),
      };
      return {
        session: inProgressSession,
        response: buildIdentityAiV1QuestionResponse(inProgressSession, input.lang),
      };
    }

    if (input.session.status === "started") {
      return {
        session: input.session,
        response: {
          kind: "error",
          text:
            input.lang === "en"
              ? "Your identity game session was recognized, but the actual game flow is not enabled in this phase yet."
              : "Je identity game-sessie is herkend, maar de game flow zelf is nog niet geactiveerd in deze fase.",
        },
      };
    }

    if (!input.action) {
      return {
        session: input.session,
        response: buildIdentityAiV1QuestionResponse(input.session, input.lang, true),
      };
    }

    const answerResult = applyIdentityAiV1Answer(
      input.session,
      input.action,
      Date.now(),
      input.lang
    );

    if (answerResult.kind === "invalid") {
      return {
        session: input.session,
        response: answerResult.response,
      };
    }

    if (answerResult.kind === "question") {
      return {
        session: answerResult.session,
        response: answerResult.response,
      };
    }

    const resolvingSession = answerResult.session;
    return {
      session: resolvingSession,
      response: answerResult.response,
      clearActiveExperience: false,
      afterSend: async () => {
        const imageResponse = await generateIdentityAiV1ImageResponse({
          session: resolvingSession,
          result: answerResult.result,
        });
        return imageResponse;
      },
    };
  },
};

const handlers = new Map<string, IdentityGameHandler>([
  [identityAiV1Handler.gameId, identityAiV1Handler],
]);

export function getIdentityGameHandler(
  gameId: string | null | undefined
): IdentityGameHandler | null {
  if (!gameId) {
    return null;
  }

  return handlers.get(gameId) ?? null;
}

export function listIdentityGameHandlers(): readonly IdentityGameHandler[] {
  return Array.from(handlers.values());
}
