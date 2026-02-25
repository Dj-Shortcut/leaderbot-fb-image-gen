import { createHash } from "crypto";
import type { StyleId } from "./messengerStyles";

export type MessengerFlowState = "idle" | "awaiting_style" | "processing";

type QuotaState = {
  dayKey: string;
  count: number;
};

export type MessengerUserState = {
  stage: MessengerFlowState;
  lastPhoto: string | null;
  selectedStyle: string | null;
  // legacy fields kept to avoid breaking current modules
  state: MessengerFlowState;
  lastPhotoUrl?: string;
  chosenStyle?: string;
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
const DEFAULT_HASH_SALT = "local-dev-salt";
const stateByUserId = new Map<string, MessengerUserState>();

export function anonymizePsid(psid: string): string {
  const salt = process.env.MESSENGER_PSID_SALT ?? DEFAULT_HASH_SALT;
  return createHash("sha256").update(`${psid}${salt}`).digest("hex");
}

export function getDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function getOrCreateState(userId: string): MessengerUserState {
  const existing = stateByUserId.get(userId);

  if (existing) {
    existing.updatedAt = Date.now();
    return existing;
  }

  const created: MessengerUserState = {
    stage: "idle",
    state: "idle",
    lastPhoto: null,
    selectedStyle: null,
    quota: {
      dayKey: DEFAULT_DAY_KEY,
      count: 0,
    },
    updatedAt: Date.now(),
  };

  stateByUserId.set(userId, created);
  return created;
}

export function setFlowState(userId: string, nextState: MessengerFlowState, now = Date.now()): MessengerUserState {
  const state = getOrCreateState(userId);
  state.stage = nextState;
  state.state = nextState;
  state.updatedAt = now;
  return state;
}

export function setPendingImage(userId: string, imageUrl: string, now = Date.now()): void {
  const state = getOrCreateState(userId);
  state.lastPhoto = imageUrl;
  state.lastPhotoUrl = imageUrl;
  state.pendingImageUrl = imageUrl;
  state.pendingImageAt = now;
  state.stage = "awaiting_style";
  state.state = "awaiting_style";
  state.updatedAt = now;
}

export function setChosenStyle(userId: string, style: string, now = Date.now()): void {
  const state = getOrCreateState(userId);
  state.selectedStyle = style;
  state.chosenStyle = style;
  state.updatedAt = now;
}

export function setLastGenerated(userId: string, style: StyleId, resultImageUrl: string, now = Date.now()): void {
  const state = getOrCreateState(userId);
  state.lastStyle = style;
  state.lastImageUrl = resultImageUrl;
  state.lastGeneratedAt = now;
  state.updatedAt = now;
}

export function getState(userId: string): MessengerUserState | undefined {
  return stateByUserId.get(userId);
}

export function pruneOldState(maxAgeMs = 1000 * 60 * 60 * 24 * 7, now = Date.now()): void {
  for (const [userId, state] of Array.from(stateByUserId.entries())) {
    if (now - state.updatedAt > maxAgeMs) {
      stateByUserId.delete(userId);
    }
  }
}

export function resetStateStore(): void {
  stateByUserId.clear();
}
