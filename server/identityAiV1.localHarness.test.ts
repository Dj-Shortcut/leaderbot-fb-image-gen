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

import { describe, expect, it, vi, beforeEach } from "vitest";

import { OpenAiImageGenerator } from "./_core/imageService";
import { resetMessengerEventDedupe } from "./_core/messengerWebhook";
import { resetStateStore } from "./_core/messengerState";
import { IdentityAiV1Harness } from "./testHelpers/identityAiV1Harness";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe.sequential("identity-ai-v1 local webhook harness", () => {
  let harness: IdentityAiV1Harness;

  beforeEach(() => {
    process.env.PRIVACY_PEPPER = "ci-test-pepper";
    resetStateStore();
    resetMessengerEventDedupe();
    sendImageMock.mockClear();
    sendQuickRepliesMock.mockClear();
    sendTextMock.mockClear();
    safeLogMock.mockClear();

    harness = new IdentityAiV1Harness({
      sendTextMock,
      sendQuickRepliesMock,
      sendImageMock,
      logger: () => undefined,
    });
  });

  it("runs the happy path through the production webhook path", async () => {
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
      const step1 = await harness.sendReferral(
        "test-user",
        "identity-ai-v1",
        "auto_start"
      );
      const step2 = await harness.sendChoice(
        "test-user",
        "identity-ai-v1-q1",
        "q1_build"
      );
      const step3 = await harness.sendChoice(
        "test-user",
        "identity-ai-v1-q2",
        "q2_build"
      );
      const step4 = await harness.sendChoice(
        "test-user",
        "identity-ai-v1-q3",
        "q3_build"
      );

      expect(step1.outboundIntents).toEqual([
        {
          kind: "options_prompt",
          prompt: "When a new AI tool drops, what do you do first?",
          options: [
            {
              id: "q1_build",
              title: "Open it and start making something",
            },
            {
              id: "q1_vision",
              title: "Imagine what it could become",
            },
            {
              id: "q1_analyst",
              title: "Figure out how it actually works",
            },
            {
              id: "q1_operate",
              title: "See where it fits in a system",
            },
          ],
        },
      ]);
      expect(step2.outboundIntents[0]).toMatchObject({
        kind: "options_prompt",
        prompt: "What kind of result feels most satisfying to you?",
      });
      expect(step3.outboundIntents[0]).toMatchObject({
        kind: "options_prompt",
        prompt: "What role do you naturally take in a smart team?",
      });
      expect(step4.outboundIntents).toEqual([
        {
          kind: "text",
          text: [
            "You are: Builder",
            "Your dominant AI instinct is to turn momentum into something real.",
            "Your answers kept leaning toward making, shipping, and moving fast.",
            "Want another round? Open the game link again.",
          ].join("\n\n"),
        },
        {
          kind: "text",
          text: "You are: Builder",
        },
        {
          kind: "image",
          imageUrl: "https://example.com/identity-builder.jpg",
        },
      ]);

      const fullResults = [step1, step2, step3, step4]
        .flatMap(step => step.outboundIntents)
        .filter(
          intent =>
            intent.kind === "text" &&
            intent.text.includes("Your dominant AI instinct is")
        );
      expect(fullResults).toHaveLength(1);
      expect(step1.session?.questionIndex).toBe(1);
      expect(step2.session?.questionIndex).toBe(2);
      expect(step3.session?.questionIndex).toBe(3);
      expect(["resolving", "completed"]).toContain(step4.session?.status ?? null);
      expect(step4.session?.answers).toEqual([
        { questionId: "identity-ai-v1-q1", answerId: "q1_build" },
        { questionId: "identity-ai-v1-q2", answerId: "q2_build" },
        { questionId: "identity-ai-v1-q3", answerId: "q3_build" },
      ]);
    } finally {
      generateSpy.mockRestore();
    }
  });

  it("re-prompts the same question on invalid text input", async () => {
    const step1 = await harness.sendReferral(
      "invalid-user",
      "identity-ai-v1",
      "auto_start"
    );
    const step2 = await harness.sendText("invalid-user", "random");

    expect(step1.session?.questionIndex).toBe(1);
    expect(step2.session?.questionIndex).toBe(1);
    expect(step2.session?.answers).toEqual([]);
    expect(step2.outboundIntents).toEqual([
      {
        kind: "options_prompt",
        prompt:
          "That answer does not match one of the 4 choices.\n\nWhen a new AI tool drops, what do you do first?",
        options: [
          {
            id: "q1_build",
            title: "Open it and start making something",
          },
          {
            id: "q1_vision",
            title: "Imagine what it could become",
          },
          {
            id: "q1_analyst",
            title: "Figure out how it actually works",
          },
          {
            id: "q1_operate",
            title: "See where it fits in a system",
          },
        ],
      },
    ]);
  });

  it("keeps the completion flow stable while async follow-up work is pending", async () => {
    const completionDeferred = createDeferred<{
      imageUrl: string;
      proof: {
        incomingLen: number;
        incomingSha256: string;
        openaiInputLen: number;
        openaiInputSha256: string;
      };
      metrics: { totalMs: number };
    }>();
    const generateSpy = vi
      .spyOn(OpenAiImageGenerator.prototype, "generate")
      .mockImplementation(() => {
        return completionDeferred.promise;
      });

    try {
      await harness.sendReferral("resolving-user", "identity-ai-v1", "auto_start");
      await harness.sendChoice("resolving-user", "identity-ai-v1-q1", "q1_build");
      await harness.sendChoice("resolving-user", "identity-ai-v1-q2", "q2_build");

      const completionPromise = harness.sendChoice(
        "resolving-user",
        "identity-ai-v1-q3",
        "q3_build"
      );

      await vi.waitFor(async () => {
        const pendingSnapshot = await harness.getSnapshot("resolving-user");
        expect(["in_progress", "resolving", "completed"]).toContain(
          pendingSnapshot.session?.status ?? null
        );
      });

      completionDeferred.resolve({
        imageUrl: "https://example.com/identity-builder-resolving.jpg",
        proof: {
          incomingLen: 0,
          incomingSha256: "0",
          openaiInputLen: 0,
          openaiInputSha256: "0",
        },
        metrics: { totalMs: 25 },
      });

      await completionPromise;

      await vi.waitFor(async () => {
        const settledSnapshot = await harness.getSnapshot("resolving-user");
        expect(settledSnapshot.session?.status).toBe("completed");
        expect(settledSnapshot.activeExperience).toBeNull();
      });

      expect(sendTextMock.mock.calls).toEqual(
        expect.arrayContaining([
          [
            "resolving-user",
            [
              "You are: Builder",
              "Your dominant AI instinct is to turn momentum into something real.",
              "Your answers kept leaning toward making, shipping, and moving fast.",
              "Want another round? Open the game link again.",
            ].join("\n\n"),
          ],
          ["resolving-user", "You are: Builder"],
        ])
      );
      expect(sendImageMock).toHaveBeenCalledWith(
        "resolving-user",
        "https://example.com/identity-builder-resolving.jpg"
      );
    } finally {
      generateSpy.mockRestore();
    }
  });

  it("starts a fresh session after completion when the referral is opened again", async () => {
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
        metrics: { totalMs: 12 },
      });

    try {
      await harness.sendReferral("replay-user", "identity-ai-v1", "auto_start");
      await harness.sendChoice("replay-user", "identity-ai-v1-q1", "q1_vision");
      await harness.sendChoice("replay-user", "identity-ai-v1-q2", "q2_vision");
      const completed = await harness.sendChoice(
        "replay-user",
        "identity-ai-v1-q3",
        "q3_vision"
      );

      await vi.waitFor(async () => {
        const settledSnapshot = await harness.getSnapshot("replay-user");
        expect(settledSnapshot.session?.status).toBe("completed");
        expect(settledSnapshot.activeExperience).toBeNull();
      });

      const replay = await harness.sendReferral(
        "replay-user",
        "identity-ai-v1",
        "auto_start"
      );

      expect(replay.outboundIntents[0]).toMatchObject({
        kind: "options_prompt",
        prompt: "When a new AI tool drops, what do you do first?",
      });
      expect(replay.session?.status).toBe("in_progress");
      expect(replay.session?.questionIndex).toBe(1);
      expect(replay.session?.answers).toEqual([]);
    } finally {
      generateSpy.mockRestore();
    }
  });

  it("keeps sessions isolated between users", async () => {
    const userAStart = await harness.sendReferral(
      "session-user-a",
      "identity-ai-v1",
      "auto_start"
    );
    const userBStart = await harness.sendReferral(
      "session-user-b",
      "identity-ai-v1",
      "auto_start"
    );
    const userAAfterAnswer = await harness.sendChoice(
      "session-user-a",
      "identity-ai-v1-q1",
      "q1_analyst"
    );
    await vi.waitFor(async () => {
      const settledUserA = await harness.getSnapshot("session-user-a");
      expect(settledUserA.session?.answers).toEqual([
        { questionId: "identity-ai-v1-q1", answerId: "q1_analyst" },
      ]);
    });
    const userBState = await harness.getSnapshot("session-user-b");

    expect(userAStart.session?.sessionId).not.toBe(userBStart.session?.sessionId);
    expect(userAAfterAnswer.session?.answers).toEqual([
      { questionId: "identity-ai-v1-q1", answerId: "q1_analyst" },
    ]);
    expect(userBState.session?.answers).toEqual([]);
    expect(userBState.session?.questionIndex).toBe(1);
    expect(userBState.activeExperience?.sessionId).toBe(userBStart.session?.sessionId);
  });
});
