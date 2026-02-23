import { getDayKey, getOrCreateState } from "./messengerState";

const FREE_DAILY_LIMIT = 1;

function syncQuotaDay(psid: string, now = Date.now()) {
  const state = getOrCreateState(psid);
  const dayKey = getDayKey(now);

  if (state.quota.dayKey !== dayKey) {
    state.quota.dayKey = dayKey;
    state.quota.count = 0;
  }

  return state;
}

export function canGenerate(psid: string, now = Date.now()): boolean {
  const state = syncQuotaDay(psid, now);
  return state.quota.count < FREE_DAILY_LIMIT;
}

export function increment(psid: string, now = Date.now()): void {
  const state = syncQuotaDay(psid, now);
  state.quota.count += 1;
}
