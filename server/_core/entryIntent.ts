import type { BotChannel } from "./normalizedInboundMessage";

export type EntryMode = "auto_start" | "confirm_first";

export type EntrySourceType =
  | "deep_link"
  | "postback"
  | "organic_message"
  | "referral"
  | "ad"
  | "unknown";

export type ExperienceType = "identity_game";

export type EntryIntent = {
  sourceChannel: BotChannel;
  sourceType: EntrySourceType;
  targetExperienceType: ExperienceType;
  targetExperienceId: string;
  entryMode?: EntryMode;
  campaignId?: string;
  creativeId?: string;
  entryVariant?: string;
  localeHint?: string;
  rawRef?: string;
  receivedAt: number;
};

function normalizeExperienceId(value: string): string {
  const normalized = value.trim().toLowerCase();
  let result = "";
  let lastWasSeparator = false;

  for (const character of normalized) {
    const isAlphaNumeric =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9");
    const isPreservedSeparator = character === "_" || character === "-";

    if (isAlphaNumeric) {
      result += character;
      lastWasSeparator = false;
      continue;
    }

    if (!lastWasSeparator) {
      result += "-";
      lastWasSeparator = true;
    }
  }

  if (result.endsWith("-")) {
    result = result.slice(0, -1);
  }

  return result.startsWith("-") ? result.slice(1) : result;
}

function resolveSourceType(value: string | null): EntrySourceType {
  switch ((value ?? "").trim().toLowerCase()) {
    case "deep_link":
    case "deeplink":
      return "deep_link";
    case "postback":
      return "postback";
    case "organic_message":
      return "organic_message";
    case "referral":
      return "referral";
    case "ad":
      return "ad";
    default:
      return "unknown";
  }
}

function resolveEntryMode(value: string | null): EntryMode | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "auto_start" || value === "confirm_first") {
    return value;
  }

  return undefined;
}

export function parseGameEntryIntent(input: {
  channel: BotChannel;
  ref?: string | null;
  sourceType?: EntrySourceType;
  localeHint?: string;
  receivedAt?: number;
}): EntryIntent | null {
  const rawRef = input.ref?.trim();
  if (!rawRef) {
    return null;
  }

  const [head, query = ""] = rawRef.split("?", 2);
  const normalizedHead = head.trim();
  let gameId = "";

  if (/^game:/i.test(normalizedHead)) {
    gameId = normalizedHead.slice("game:".length);
  } else if (/^identity[_-]?game:/i.test(normalizedHead)) {
    gameId = normalizedHead.slice(normalizedHead.indexOf(":") + 1);
  } else {
    return null;
  }

  const targetExperienceId = normalizeExperienceId(gameId);
  if (!targetExperienceId) {
    return null;
  }

  const params = new URLSearchParams(query);
  const localeFromQuery = params.get("locale")?.trim();

  return {
    sourceChannel: input.channel,
    sourceType:
      input.sourceType ??
      resolveSourceType(params.get("sourceType") ?? params.get("source")),
    targetExperienceType: "identity_game",
    targetExperienceId,
    entryMode: resolveEntryMode(params.get("entryMode")),
    campaignId: params.get("campaignId") ?? undefined,
    creativeId: params.get("creativeId") ?? undefined,
    entryVariant: params.get("entryVariant") ?? undefined,
    localeHint: localeFromQuery || input.localeHint || undefined,
    rawRef,
    receivedAt: input.receivedAt ?? Date.now(),
  };
}
