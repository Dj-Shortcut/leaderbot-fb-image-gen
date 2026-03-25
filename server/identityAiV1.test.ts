import { describe, expect, it } from "vitest";
import {
  getIdentityAiV1AnswerIdsByQuestion,
  resolveIdentityAiV1Archetype,
} from "./_core/identityAiV1";

describe("identityAiV1 resolver", () => {
  it("resolves every valid answer triple deterministically to one archetype", () => {
    const [q1Answers, q2Answers, q3Answers] = getIdentityAiV1AnswerIdsByQuestion();

    for (const q1 of q1Answers) {
      for (const q2 of q2Answers) {
        for (const q3 of q3Answers) {
          expect(
            resolveIdentityAiV1Archetype([q1, q2, q3])
          ).toMatch(/^(builder|visionary|analyst|operator)$/);
        }
      }
    }
  });
});
