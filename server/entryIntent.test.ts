import { describe, expect, it } from "vitest";
import { parseGameEntryIntent } from "./_core/entryIntent";

describe("entryIntent parsing", () => {
  it("normalizes a Messenger deep link into an identity game entry intent", () => {
    const result = parseGameEntryIntent({
      channel: "messenger",
      ref: "game:party-alter-ego?entryMode=confirm_first&campaignId=camp-1&creativeId=creative-9&entryVariant=feed-a",
      sourceType: "referral",
      localeHint: "nl",
      receivedAt: 1710000000000,
    });

    expect(result).toEqual({
      sourceChannel: "messenger",
      sourceType: "referral",
      targetExperienceType: "identity_game",
      targetExperienceId: "party-alter-ego",
      entryMode: "confirm_first",
      campaignId: "camp-1",
      creativeId: "creative-9",
      entryVariant: "feed-a",
      localeHint: "nl",
      rawRef:
        "game:party-alter-ego?entryMode=confirm_first&campaignId=camp-1&creativeId=creative-9&entryVariant=feed-a",
      receivedAt: 1710000000000,
    });
  });

  it("ignores non-game refs so style deep links can keep their own flow", () => {
    expect(
      parseGameEntryIntent({
        channel: "messenger",
        ref: "style_disco",
      })
    ).toBeNull();
  });

  it("collapses repeated separators when normalizing game ids", () => {
    const result = parseGameEntryIntent({
      channel: "messenger",
      ref: "game: My Game!! ",
    });

    expect(result?.targetExperienceId).toBe("my-game");
  });

  it("collapses repeated preserved separators into a single hyphen", () => {
    const dashed = parseGameEntryIntent({
      channel: "messenger",
      ref: "game:my--game",
    });
    const underscored = parseGameEntryIntent({
      channel: "messenger",
      ref: "game:my__game",
    });

    expect(dashed?.targetExperienceId).toBe("my-game");
    expect(underscored?.targetExperienceId).toBe("my-game");
  });

  it("prefers locale encoded in the ref over the channel-provided locale hint", () => {
    const result = parseGameEntryIntent({
      channel: "messenger",
      ref: "game:party-alter-ego?locale=en",
      localeHint: "nl_BE",
    });

    expect(result?.localeHint).toBe("en");
  });
});
