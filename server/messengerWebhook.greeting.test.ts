import { describe, expect, it } from "vitest";
import { getGreetingResponse } from "./_core/messengerWebhook";

describe("greeting handling by conversation state", () => {
  it("returns processing text while PROCESSING", () => {
    expect(getGreetingResponse("PROCESSING")).toEqual({
      mode: "text",
      text: "I’m still working on it—few seconds.",
    });
  });

  it("returns style picker prompt while AWAITING_STYLE", () => {
    expect(getGreetingResponse("AWAITING_STYLE")).toEqual({
      mode: "quick_replies",
      state: "AWAITING_STYLE",
      text: "What style should I use?",
    });
  });

  it("returns follow-up options while RESULT_READY", () => {
    expect(getGreetingResponse("RESULT_READY")).toEqual({
      mode: "quick_replies",
      state: "RESULT_READY",
      text: "Yo 👋 Wil je nog een style proberen op dezelfde foto, of een nieuwe sturen?",
    });
  });

  it("returns quick start welcome only in IDLE", () => {
    expect(getGreetingResponse("IDLE")).toEqual({
      mode: "quick_replies",
      state: "IDLE",
      text: "Welcome 👋 Pick a quick start.",
    });
  });
});
