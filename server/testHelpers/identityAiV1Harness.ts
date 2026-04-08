import type { ActiveExperience, IdentityGameSession } from "../_core/activeExperience";
import type { EntryIntent } from "../_core/entryIntent";
import { getIdentityGameSessionByUserId } from "../_core/identityGameSessionState";
import {
  processFacebookWebhookPayload,
  resetMessengerEventDedupe,
} from "../_core/messengerWebhook";
import { anonymizePsid, getState } from "../_core/messengerState";

type MockWithCalls = {
  mock: {
    calls: unknown[][];
    invocationCallOrder: number[];
  };
  mockClear?: () => void;
};

export type LoggedOutboundIntent =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "options_prompt";
      prompt: string;
      options: Array<{ id: string; title: string }>;
    }
  | {
      kind: "image";
      imageUrl: string;
    };

export type HarnessSnapshot = {
  step: number;
  action: string;
  entryIntent: EntryIntent | null;
  activeExperience: ActiveExperience | null;
  session: {
    sessionId: string | null;
    status: IdentityGameSession["status"] | null;
    questionIndex: number | null;
    currentQuestionId: string | null;
    answers: Array<{ questionId: string; answerId: string }>;
    resultRef: string | null;
  } | null;
  outboundIntents: LoggedOutboundIntent[];
};

function buildGameRef(ref: string, entryMode = "auto_start"): string {
  if (/^(game:|identity[_-]?game:)/i.test(ref)) {
    return ref;
  }

  return `game:${ref}?entryMode=${encodeURIComponent(entryMode)}`;
}

function getQuestionIndex(questionId: string | undefined): number | null {
  if (!questionId) {
    return null;
  }

  const match = /-q(\d+)$/i.exec(questionId);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatValue(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export class IdentityAiV1Harness {
  private sequence = 0;
  private step = 0;
  private textCursor = 0;
  private quickReplyCursor = 0;
  private imageCursor = 0;

  constructor(
    private readonly deps: {
      sendTextMock: MockWithCalls;
      sendQuickRepliesMock: MockWithCalls;
      sendImageMock: MockWithCalls;
      logger?: (line: string) => void;
      locale?: string;
    }
  ) {}

  reset(): void {
    resetMessengerEventDedupe();
    this.deps.sendTextMock.mockClear?.();
    this.deps.sendQuickRepliesMock.mockClear?.();
    this.deps.sendImageMock.mockClear?.();
    this.sequence = 0;
    this.step = 0;
    this.textCursor = 0;
    this.quickReplyCursor = 0;
    this.imageCursor = 0;
  }

  private async waitForObservedMutation(
    userId: string,
    before: HarnessSnapshot,
    beforeCursors = {
      text: this.textCursor,
      quickReply: this.quickReplyCursor,
      image: this.imageCursor,
    }
  ): Promise<void> {
    const deadline = Date.now() + 500;

    while (Date.now() < deadline) {
      const snapshot = await this.capture(userId, "stabilize", false, false);

      const outboundAdvanced =
        this.deps.sendTextMock.mock.calls.length > beforeCursors.text ||
        this.deps.sendQuickRepliesMock.mock.calls.length > beforeCursors.quickReply ||
        this.deps.sendImageMock.mock.calls.length > beforeCursors.image;

      if (outboundAdvanced) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * If `ref` already starts with `game:` or `identity_game:`, it is passed through
   * as-is and `entryMode` is not injected.
   */
  async sendReferral(
    userId: string,
    ref: string,
    entryMode = "auto_start"
  ): Promise<HarnessSnapshot> {
    const before = await this.capture(
      userId,
      `before sendReferral(${userId}, ${ref}, ${entryMode})`,
      false,
      false
    );
    const beforeCursors = {
      text: this.textCursor,
      quickReply: this.quickReplyCursor,
      image: this.imageCursor,
    };
    const timestamp = this.nextTimestamp();
    await processFacebookWebhookPayload({
      entry: [
        {
          id: `page-${this.sequence}`,
          messaging: [
            {
              timestamp,
              sender: {
                id: userId,
                locale: this.deps.locale ?? "en_US",
              },
              postback: {
                payload: "GET_STARTED",
                referral: {
                  ref: buildGameRef(ref, entryMode),
                },
              },
            },
          ],
        },
      ],
    });

    await this.waitForObservedMutation(userId, before, beforeCursors);
    return this.capture(userId, `sendReferral(${userId}, ${ref}, ${entryMode})`);
  }

  async sendChoice(
    userId: string,
    questionId: string,
    answerId: string
  ): Promise<HarnessSnapshot> {
    const before = await this.capture(
      userId,
      `before sendChoice(${userId}, ${questionId}, ${answerId})`,
      false,
      false
    );
    const beforeCursors = {
      text: this.textCursor,
      quickReply: this.quickReplyCursor,
      image: this.imageCursor,
    };
    const timestamp = this.nextTimestamp();
    await processFacebookWebhookPayload({
      entry: [
        {
          id: `page-${this.sequence}`,
          messaging: [
            {
              timestamp,
              sender: {
                id: userId,
                locale: this.deps.locale ?? "en_US",
              },
              message: {
                mid: `mid-${this.sequence}-${userId}-${questionId}`,
                text: answerId,
                quick_reply: {
                  payload: answerId,
                },
              },
            },
          ],
        },
      ],
    });

    await this.waitForObservedMutation(userId, before, beforeCursors);
    return this.capture(userId, `sendChoice(${userId}, ${questionId}, ${answerId})`);
  }

  async sendText(userId: string, text: string): Promise<HarnessSnapshot> {
    const before = await this.capture(
      userId,
      `before sendText(${userId}, ${text})`,
      false,
      false
    );
    const beforeCursors = {
      text: this.textCursor,
      quickReply: this.quickReplyCursor,
      image: this.imageCursor,
    };
    const timestamp = this.nextTimestamp();
    await processFacebookWebhookPayload({
      entry: [
        {
          id: `page-${this.sequence}`,
          messaging: [
            {
              timestamp,
              sender: {
                id: userId,
                locale: this.deps.locale ?? "en_US",
              },
              message: {
                mid: `mid-${this.sequence}-${userId}-text`,
                text,
              },
            },
          ],
        },
      ],
    });

    await this.waitForObservedMutation(userId, before, beforeCursors);
    return this.capture(userId, `sendText(${userId}, ${text})`);
  }

  async getSnapshot(userId: string): Promise<HarnessSnapshot> {
    return this.capture(userId, `snapshot(${userId})`, false, false);
  }

  private nextTimestamp(): number {
    this.sequence += 1;
    return Date.now() + this.sequence;
  }

  private async capture(
    userId: string,
    action: string,
    advanceStep = true,
    drainOutbound = true
  ): Promise<HarnessSnapshot> {
    const userKey = anonymizePsid(userId);
    const state = await Promise.resolve(getState(userKey));
    const session = await Promise.resolve(getIdentityGameSessionByUserId(userKey));
    const outboundIntents = drainOutbound ? this.drainOutboundIntents() : [];
    const snapshot: HarnessSnapshot = {
      step: advanceStep ? ++this.step : this.step,
      action,
      entryIntent: state?.lastEntryIntent ?? null,
      activeExperience: state?.activeExperience ?? null,
      session: session
        ? {
            sessionId: session.sessionId,
            status: session.status,
            questionIndex: getQuestionIndex(session.currentQuestionId),
            currentQuestionId: session.currentQuestionId ?? null,
            answers: session.answers.map(answer => ({
              questionId: answer.questionId,
              answerId: answer.answerId,
            })),
            resultRef: session.resultRef ?? null,
          }
        : null,
      outboundIntents,
    };

    this.logSnapshot(snapshot);
    return snapshot;
  }

  private drainOutboundIntents(): LoggedOutboundIntent[] {
    const ordered: Array<{ order: number; intent: LoggedOutboundIntent }> = [];

    for (
      let index = this.textCursor;
      index < this.deps.sendTextMock.mock.calls.length;
      index += 1
    ) {
      const [, text] = this.deps.sendTextMock.mock.calls[index] as [string, string];
      ordered.push({
        order: this.deps.sendTextMock.mock.invocationCallOrder[index] ?? index,
        intent: {
          kind: "text",
          text,
        },
      });
    }

    for (
      let index = this.quickReplyCursor;
      index < this.deps.sendQuickRepliesMock.mock.calls.length;
      index += 1
    ) {
      const [, prompt, replies] = this.deps.sendQuickRepliesMock.mock.calls[index] as [
        string,
        string,
        Array<{ title: string; payload: string }>
      ];
      ordered.push({
        order:
          this.deps.sendQuickRepliesMock.mock.invocationCallOrder[index] ?? index,
        intent: {
          kind: "options_prompt",
          prompt,
          options: replies.map(reply => ({
            id: reply.payload,
            title: reply.title,
          })),
        },
      });
    }

    for (
      let index = this.imageCursor;
      index < this.deps.sendImageMock.mock.calls.length;
      index += 1
    ) {
      const [, imageUrl] = this.deps.sendImageMock.mock.calls[index] as [
        string,
        string
      ];
      ordered.push({
        order: this.deps.sendImageMock.mock.invocationCallOrder[index] ?? index,
        intent: {
          kind: "image",
          imageUrl,
        },
      });
    }

    this.textCursor = this.deps.sendTextMock.mock.calls.length;
    this.quickReplyCursor = this.deps.sendQuickRepliesMock.mock.calls.length;
    this.imageCursor = this.deps.sendImageMock.mock.calls.length;

    return ordered
      .sort((left, right) => left.order - right.order)
      .map(entry => entry.intent);
  }

  private logSnapshot(snapshot: HarnessSnapshot): void {
    const log = this.deps.logger ?? console.log;
    log(`[identity-ai-v1 harness] Step ${snapshot.step}: ${snapshot.action}`);
    log(`  EntryIntent: ${formatValue(snapshot.entryIntent)}`);
    log(`  ActiveExperience: ${formatValue(snapshot.activeExperience)}`);
    log(`  Session: ${formatValue(snapshot.session)}`);
    log(`  OutboundIntents: ${formatValue(snapshot.outboundIntents)}`);
  }
}
