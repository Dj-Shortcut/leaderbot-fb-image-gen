import type { StyleId } from "./messengerStyles";

type QuotaState = {
  dayKey: string;
  count: number;
};

export type MessengerUserState = {
  pendingImageUrl?: string;
  pendingImageAt?: number;
  lastImageUrl?: string;
  lastStyle?: StyleId;
  lastGeneratedAt?: number;
  lastVariantCursor?: number;
  quota: QuotaState;
  updatedAt: number;
};

const DEFAULT_DAY_KEY = "1970-01-01";
const stateByPsid = new Map<string, MessengerUserState>();

export function getDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function getOrCreateState(psid: string): MessengerUserState {
  const existing = stateByPsid.get(psid);

  if (existing) {
    existing.updatedAt = Date.now();
    return existing;
  }

  const created: MessengerUserState = {
    quota: {
      dayKey: DEFAULT_DAY_KEY,
      count: 0,
    },
    updatedAt: Date.now(),
  };

  stateByPsid.set(psid, created);
  return created;
}

export function setPendingImage(psid: string, imageUrl: string, now = Date.now()): void {
  const state = getOrCreateState(psid);
  state.pendingImageUrl = imageUrl;
  state.pendingImageAt = now;
  state.updatedAt = now;
}

export function setLastGenerated(psid: string, style: StyleId, resultImageUrl: string, now = Date.now()): void {
  const state = getOrCreateState(psid);
  state.lastStyle = style;
  state.lastImageUrl = resultImageUrl;
  state.lastGeneratedAt = now;
  state.updatedAt = now;
}

export function getState(psid: string): MessengerUserState | undefined {
  return stateByPsid.get(psid);
}

export function pruneOldState(maxAgeMs = 1000 * 60 * 60 * 24 * 7, now = Date.now()): void {
  for (const [psid, state] of Array.from(stateByPsid.entries())) {
    if (now - state.updatedAt > maxAgeMs) {
      stateByPsid.delete(psid);
    }
  }
}
