import { createHash } from "crypto";
import type { StyleId } from "./messengerStyles";

export type ConversationState = "IDLE" | "AWAITING_PHOTO" | "AWAITING_STYLE" | "PROCESSING" | "RESULT_READY";
export type MessengerFlowState = ConversationState;

export type StateQuickReply = {
  title: string;
  payload: string;
};

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

const QUICK_REPLIES_BY_STATE: Record<ConversationState, StateQuickReply[]> = {
  IDLE: [
    { title: "Send photo", payload: "START_PHOTO" },
    { title: "What is this?", payload: "WHAT_IS_THIS" },
  ],
  AWAITING_PHOTO: [{ title: "Send photo", payload: "SEND_PHOTO" }],
  AWAITING_STYLE: [
    { title: "Disco", payload: "STYLE_DISCO" },
    { title: "Gold", payload: "STYLE_GOLD" },
    { title: "Anime", payload: "STYLE_ANIME" },
    { title: "Clouds", payload: "STYLE_CLOUDS" },
  ],
  PROCESSING: [],
  RESULT_READY: [
    { title: "Choose style", payload: "CHOOSE_STYLE" },
    { title: "Send new photo", payload: "SEND_PHOTO" },
  ],
};

export function getQuickRepliesForState(state: ConversationState): StateQuickReply[] {
  return QUICK_REPLIES_BY_STATE[state];
}

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
    stage: "IDLE",
    state: "IDLE",
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
  state.stage = "AWAITING_STYLE";
  state.state = "AWAITING_STYLE";
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
