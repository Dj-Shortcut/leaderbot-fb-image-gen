import { afterEach, describe, expect, it, vi } from "vitest";
import {
  interpretConversationalEdit,
  looksLikePossibleEditRequest,
} from "./_core/conversationalEditInterpreter";

describe("conversational edit interpreter", () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_EDIT_INTERPRETER_MODEL;

  afterEach(() => {
    global.fetch = originalFetch;

    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }

    if (originalModel === undefined) {
      delete process.env.OPENAI_EDIT_INTERPRETER_MODEL;
    } else {
      process.env.OPENAI_EDIT_INTERPRETER_MODEL = originalModel;
    }
  });

  it("detects likely edit requests before calling the model", () => {
    expect(looksLikePossibleEditRequest("make it darker")).toBe(true);
    expect(looksLikePossibleEditRequest("meer cinematic")).toBe(true);
    expect(looksLikePossibleEditRequest("what can you do?")).toBe(false);
  });

  it("parses an edit decision from the responses api", async () => {
    process.env.OPENAI_API_KEY = "dummy-key";

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text:
            '{"shouldEdit":true,"style":"gold","promptHint":"make it darker with warm glow"}',
        }),
        { status: 200 }
      )
    );

    global.fetch = fetchMock;

    const result = await interpretConversationalEdit({
      text: "make it darker and more gold",
      lang: "en",
      lastStyle: "disco",
    });

    expect(result).toEqual({
      shouldEdit: true,
      style: "gold",
      promptHint: "make it darker with warm glow",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
