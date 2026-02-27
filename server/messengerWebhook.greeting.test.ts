import { describe, expect, it } from "vitest";
import { getGreetingResponse } from "./_core/messengerWebhook";

describe("greeting handling by conversation state", () => {
  it("returns processing text while PROCESSING", () => {
    expect(getGreetingResponse("PROCESSING")).toEqual({
      mode: "text",
      text: "I’m still working on it—few seconds.",
    });
  });

  it("returns plain photo prompt while AWAITING_PHOTO", () => {
    expect(getGreetingResponse("AWAITING_PHOTO")).toEqual({
      mode: "text",
      text: "Send a photo when you're ready 📷",
    });
  });

  it("returns style picker prompt while AWAITING_STYLE", () => {
    expect(getGreetingResponse("AWAITING_STYLE")).toEqual({
      mode: "quick_replies",
      state: "AWAITING_STYLE",
      text: "🎨 Pick a style to transform your image:",
    });
  });

  it("returns follow-up options while RESULT_READY", () => {
    expect(getGreetingResponse("RESULT_READY")).toEqual({
      mode: "quick_replies",
      state: "RESULT_READY",
      text: "✨ Your image is ready.",
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
      text: "✨ I turn your photos into stylized images.\nSend me a picture to get started.",
    });
  });
});
