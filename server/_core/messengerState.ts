import type { Style } from "./messengerStyles";
import { STYLE_CONFIGS } from "./messengerStyles";
import type { Lang } from "./i18n";
import { toUserKey } from "./privacy";
import * as db from "../db";

export type ConversationState = "IDLE" | "AWAITING_PHOTO" | "AWAITING_STYLE" | "PROCESSING" | "RESULT_READY" | "FAILURE";
export type MessengerFlowState = ConversationState;

export type StateQuickReply = {
  title: string;
  payload: string;
};

export type MessengerUserState = {
  psid: string;
  userKey: string;
  stage: MessengerFlowState;
  lastPhotoUrl: string | null;
  selectedStyle: string | null;
  preselectedStyle?: string | null;
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

export async function getOrCreateState(psid: string): Promise<MessengerUserState> {
  const userKey = toUserKey(psid);
  const state = await db.getOrCreateMessengerState(psid, userKey);
  
  if (!state) {
      // Fallback if DB is down (not ideal but keeps it running)
      return {
          psid,
          userKey,
          stage: "IDLE",
          lastPhotoUrl: null,
          selectedStyle: null,
          preferredLang: "nl",
          lastGeneratedUrl: null,
          updatedAt: new Date(),
      };
  }

  return {
      psid: state.psid,
      userKey: state.userKey,
      stage: state.stage as MessengerFlowState,
      lastPhotoUrl: state.lastPhotoUrl,
      selectedStyle: state.selectedStyle,
      preferredLang: (state.preferredLang as Lang) || "nl",
      lastGeneratedUrl: state.lastGeneratedUrl,
      updatedAt: state.updatedAt,
  };
}

export async function setFlowState(psid: string, nextState: MessengerFlowState): Promise<void> {
  await db.updateMessengerState(psid, { stage: nextState });
}

export async function setPendingImage(psid: string, imageUrl: string): Promise<void> {
  await db.updateMessengerState(psid, { 
      lastPhotoUrl: imageUrl,
      stage: "AWAITING_STYLE" 
  });
}

export function clearPendingImageState(userId: string, now = Date.now()): MessengerUserState {
  const state = getOrCreateState(userId);
  state.lastPhoto = null;
  state.lastPhotoUrl = undefined;
  state.pendingImageUrl = undefined;
  state.pendingImageAt = undefined;
  state.selectedStyle = null;
  state.chosenStyle = undefined;
  state.updatedAt = now;
  return state;
}

export function setPreselectedStyle(userId: string, style: string | null, now = Date.now()): MessengerUserState {
  const state = getOrCreateState(userId);
  state.preselectedStyle = style;
  state.updatedAt = now;
  return state;
}

export function setChosenStyle(userId: string, style: string, now = Date.now()): void {
  const state = getOrCreateState(userId);
  state.selectedStyle = style;
  state.chosenStyle = style;
  state.updatedAt = now;
}

export async function setPreferredLang(psid: string, lang: Lang): Promise<void> {
  await db.updateMessengerState(psid, { preferredLang: lang });
}

export async function setLastGenerated(psid: string, resultImageUrl: string): Promise<void> {
  await db.updateMessengerState(psid, { 
      lastGeneratedUrl: resultImageUrl,
      stage: "RESULT_READY"
  });
}

// Pruning is now handled by the database (standard TTL or cleanup jobs)
export function pruneOldState(): void {}
export function resetStateStore(): void {}
