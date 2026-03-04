import { describe, expect, it } from "vitest";

import { parseChatRequestBody } from "./_core/chat";

describe("chat request validation", () => {
  it("rejects payloads without a messages array", () => {
    expect(() => parseChatRequestBody({})).toThrow("messages array is required");
    expect(() => parseChatRequestBody(null)).toThrow("messages array is required");
  });

  it("rejects payloads with invalid model messages", () => {
    expect(() =>
      parseChatRequestBody({
        messages: [{ content: "hello" }],
      }),
    ).toThrow("messages must be valid model messages");
  });

  it("accepts payloads with role and content", () => {
    const parsed = parseChatRequestBody({
      messages: [{ role: "user", content: "hello" }],
    });

    expect(parsed.messages).toEqual([{ role: "user", content: "hello" }]);
  });
});
