import type { Style } from "./messengerStyles";
import { STYLE_CONFIGS } from "./messengerStyles";
import type { Lang } from "./i18n";
import { toUserKey } from "./privacy";

export type ConversationState = "IDLE" | "AWAITING_PHOTO" | "AWAITING_STYLE" | "PROCESSING" | "RESULT_READY" | "FAILURE";
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
  preferredLang?: Lang;
  // legacy fields kept to avoid breaking current modules
  state: MessengerFlowState;
  lastPhotoUrl?: string;
  chosenStyle?: string;
  pendingImageUrl?: string;
  pendingImageAt?: number;
  lastImageUrl?: string;
  lastStyle?: Style;
  lastGeneratedAt?: number;
  lastVariantCursor?: number;
  quota: QuotaState;
  updatedAt: number;
};

const DEFAULT_DAY_KEY = "1970-01-01";
const stateByUserId = new Map<string, MessengerUserState>();

const QUICK_REPLIES_BY_STATE: Record<ConversationState, StateQuickReply[]> = {
  IDLE: [
    { title: "Wat doe ik?", payload: "WHAT_IS_THIS" },
    { title: "Privacy", payload: "PRIVACY_INFO" },
  ],
  AWAITING_PHOTO: [],
  AWAITING_STYLE: STYLE_CONFIGS.map(style => ({
    title: style.label,
    payload: style.payload,
  })),
  PROCESSING: [],
  RESULT_READY: [
    { title: "Nieuwe stijl", payload: "CHOOSE_STYLE" },
    { title: "Privacy", payload: "PRIVACY_INFO" },
  ],
  FAILURE: [
    { title: "Probeer opnieuw", payload: "RETRY_STYLE" },
    { title: "Andere stijl", payload: "CHOOSE_STYLE" },
  ],
};

export function getQuickRepliesForState(state: ConversationState): StateQuickReply[] {
  return QUICK_REPLIES_BY_STATE[state];
}

export function anonymizePsid(psid: string): string {
  return toUserKey(psid);
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

export function setPreferredLang(userId: string, lang: Lang, now = Date.now()): void {
  const state = getOrCreateState(userId);
  state.preferredLang = lang;
  state.updatedAt = now;
}

export function setLastGenerated(userId: string, style: Style, resultImageUrl: string, now = Date.now()): void {
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
