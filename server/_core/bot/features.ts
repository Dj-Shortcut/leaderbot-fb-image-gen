import {
  readScopedState,
  writeScopedState,
  type MaybePromise,
} from "../stateStore";
import type {
  BotErrorContext,
  BotImageContext,
  BotPayloadContext,
  BotTextContext,
  FeatureResult,
} from "../botContext";

export type BotFeature = {
  name: string;
  onText?(ctx: BotTextContext): Promise<FeatureResult | void> | FeatureResult | void;
  onPayload?(
    ctx: BotPayloadContext
  ): Promise<FeatureResult | void> | FeatureResult | void;
  onImage?(ctx: BotImageContext): Promise<FeatureResult | void> | FeatureResult | void;
  onError?(ctx: BotErrorContext): Promise<void> | void;
};

type RateLimitBucket = {
  count: number;
};

const RATE_LIMIT_SCOPE = "bot-feature-rate-limit";
const RATE_LIMIT_TTL_SECONDS = 60;
const RATE_LIMIT_MAX_MESSAGES = 10;

async function getRateLimitBucket(senderId: string): Promise<RateLimitBucket> {
  const bucket = await Promise.resolve(
    readScopedState<RateLimitBucket>(RATE_LIMIT_SCOPE, senderId)
  );

  return bucket ?? { count: 0 };
}

function setRateLimitBucket(
  senderId: string,
  bucket: RateLimitBucket
): MaybePromise<void> {
  return writeScopedState(
    RATE_LIMIT_SCOPE,
    senderId,
    bucket,
    RATE_LIMIT_TTL_SECONDS
  );
}

export const rateLimitFeature: BotFeature = {
  name: "rateLimit",
  async onText(ctx) {
    const bucket = await getRateLimitBucket(ctx.senderId);
    const nextCount = bucket.count + 1;
    await Promise.resolve(
      setRateLimitBucket(ctx.senderId, {
        count: nextCount,
      })
    );

    if (nextCount <= RATE_LIMIT_MAX_MESSAGES) {
      return { handled: false };
    }

    ctx.logger.warn("bot_feature_rate_limited", {
      user: ctx.userId,
      count: nextCount,
    });
    await ctx.sendText("Slow down a bit before sending more messages.");
    return { handled: true };
  },
};

const botFeatures: BotFeature[] = [rateLimitFeature];

export function getBotFeatures(): readonly BotFeature[] {
  return botFeatures;
}

export function registerBotFeature(feature: BotFeature): void {
  if (botFeatures.some(existing => existing.name === feature.name)) {
    throw new Error(`Bot feature "${feature.name}" is already registered`);
  }

  botFeatures.push(feature);
}
