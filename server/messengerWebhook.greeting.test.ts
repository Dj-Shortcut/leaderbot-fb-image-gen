import { describe, expect, it } from "vitest";
import { getGreetingResponse } from "./_core/messengerWebhook";

describe("greeting handling by conversation state", () => {
  it("returns processing text while GENERATING", () => {
    expect(getGreetingResponse("GENERATING")).toEqual({
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

  it("returns follow-up options while SUCCESS", () => {
    expect(getGreetingResponse("SUCCESS")).toEqual({
      mode: "quick_replies",
      state: "SUCCESS",
      text: "Yo 👋 Wil je nog een style proberen op dezelfde foto, of een nieuwe sturen?",
    });
  });

  it("returns recovery options while FAILURE", () => {
    expect(getGreetingResponse("FAILURE")).toEqual({
      mode: "quick_replies",
      state: "FAILURE",
      text: "That one failed. Want to retry or pick another style?",
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
