import { describe, expect, it } from "vitest";
import { getGreetingResponse } from "./_core/messengerWebhook";

describe("greeting handling by conversation state", () => {
  it("returns processing text while PROCESSING", () => {
    expect(getGreetingResponse("PROCESSING")).toEqual({
      mode: "text",
      text: "Ik ben nog bezig met je vorige afbeelding.",
    });
  });

  it("returns plain photo prompt while AWAITING_PHOTO", () => {
    expect(getGreetingResponse("AWAITING_PHOTO")).toEqual({
      mode: "text",
      text: "Stuur gerust een foto, dan kan ik een stijl voor je maken.",
    });
  });

  it("returns style picker prompt while AWAITING_STYLE", () => {
    expect(getGreetingResponse("AWAITING_STYLE")).toEqual({
      mode: "quick_replies",
      state: "AWAITING_STYLE",
      text: "Dank je. Kies hieronder een stijl.",
    });
  });

  it("returns follow-up options while RESULT_READY", () => {
    expect(getGreetingResponse("RESULT_READY")).toEqual({
      mode: "quick_replies",
      state: "RESULT_READY",
      text: "Klaar. Je kan de afbeelding opslaan door erop te tikken.",
    });
  });

  it("returns recovery options while FAILURE", () => {
    expect(getGreetingResponse("FAILURE")).toEqual({
      mode: "quick_replies",
      state: "FAILURE",
      text: "Er ging iets mis bij het maken van je afbeelding. Kies gerust opnieuw een stijl.",
    });
  });

  it("returns quick start welcome only in IDLE", () => {
    expect(getGreetingResponse("IDLE")).toEqual({
      mode: "quick_replies",
      state: "IDLE",
      text: "Stuur een foto en ik maak er een speciale versie van in een andere stijl — het is gratis.",
    });
  });
});
