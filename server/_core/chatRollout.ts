import { createHash } from "node:crypto";

export type MessengerChatEngine = "legacy" | "responses";

type RolloutDecision = {
  engine: MessengerChatEngine;
  canaryPercent: number;
  bucket: number;
  useResponses: boolean;
};

function normalizeEngine(raw: string | undefined): MessengerChatEngine {
  return raw?.trim().toLowerCase() === "responses" ? "responses" : "legacy";
}

function parseCanaryPercent(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(100, parsed));
}

function bucketForUserKey(userKey: string): number {
  const digest = createHash("sha256").update(userKey).digest();
  const raw =
    ((digest[0] ?? 0) << 24) |
    ((digest[1] ?? 0) << 16) |
    ((digest[2] ?? 0) << 8) |
    (digest[3] ?? 0);

  return Math.abs(raw) % 100;
}

function getMessengerChatEngine(): MessengerChatEngine {
  return normalizeEngine(process.env.MESSENGER_CHAT_ENGINE);
}

function getMessengerChatCanaryPercent(): number {
  return parseCanaryPercent(process.env.MESSENGER_CHAT_CANARY_PERCENT);
}

export function getChatRolloutDecision(userKey: string): RolloutDecision {
  const engine = getMessengerChatEngine();
  const canaryPercent = getMessengerChatCanaryPercent();
  const bucket = bucketForUserKey(userKey);
  const useResponses =
    engine === "responses" &&
    (canaryPercent >= 100 || (canaryPercent > 0 && bucket < canaryPercent));

  return {
    engine,
    canaryPercent,
    bucket,
    useResponses,
  };
}

