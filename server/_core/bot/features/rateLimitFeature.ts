import type { BotFeature } from "../features";
import { readScopedState, writeScopedState } from "../../stateStore";

const RATE_WINDOW_SECONDS = 60;
const RATE_LIMIT = 10;

export const rateLimitFeature: BotFeature = {
  name: "rate_limit",
  async onText(context) {
    if (!context.text?.trim()) {
      return false;
    }

    const key = `rate:${context.psid}`;
    const current = (await Promise.resolve(readScopedState<number>("bot", key))) ?? 0;
    const nextCount = current + 1;

    await Promise.resolve(writeScopedState("bot", key, nextCount, RATE_WINDOW_SECONDS));

    if (nextCount <= RATE_LIMIT) {
      return false;
    }

    await context.sendText("⏳ Slow down a bit.");
    return true;
  },
};
