import type { Style } from "./messengerStyles";
import { STYLE_CONFIGS } from "./messengerStyles";
import type { Lang } from "./i18n";
import { toUserKey } from "./privacy";
import { readState, writeState } from "./stateStore";

export type ConversationState =
  | "IDLE"
  | "AWAITING_PHOTO"
  | "AWAITING_STYLE"
  | "PROCESSING"
  | "RESULT_READY"
  | "FAILURE";
export type MessengerFlowState = ConversationState;

export type StateQuickReply = {
  title: string;
  payload: string;
};

export type QuotaState = {
  dayKey: string;
  count: number;
};

export type MessengerUserState = {
  psid: string;
  userKey: string;
  stage: MessengerFlowState;
  state: MessengerFlowState;
  lastPhotoUrl: string | null;
  lastPhoto: string | null;
  selectedStyle: string | null;
  chosenStyle: string | null;
  preselectedStyle?: string | null;
  preferredLang?: Lang;
  pendingImageUrl?: string;
  pendingImageAt?: number;
  lastImageUrl?: string;
  lastGeneratedUrl?: string | null;
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

type PartialState = Partial<MessengerUserState>;

function createDefaultState(psid: string, now = Date.now()): MessengerUserState {
  return {
    psid,
    userKey: toUserKey(psid),
    stage: "IDLE",
    state: "IDLE",
    lastPhotoUrl: null,
    lastPhoto: null,
    selectedStyle: null,
    chosenStyle: null,
    preselectedStyle: null,
    preferredLang: "nl",
    pendingImageUrl: undefined,
    pendingImageAt: undefined,
    lastImageUrl: undefined,
    lastGeneratedUrl: null,
    lastStyle: undefined,
    lastGeneratedAt: undefined,
    lastVariantCursor: undefined,
    quota: {
      dayKey: getDayKey(now),
      count: 0,
    },
    updatedAt: now,
  };
}

function normalizeState(psid: string, value: PartialState | null | undefined): MessengerUserState {
  const fallback = createDefaultState(psid);
  const stage = value?.stage ?? value?.state ?? fallback.stage;
  const lastPhoto = value?.lastPhoto ?? value?.lastPhotoUrl ?? fallback.lastPhoto;
  const selectedStyle = value?.selectedStyle ?? value?.chosenStyle ?? fallback.selectedStyle;

  return {
    ...fallback,
    ...value,
    psid,
    userKey: value?.userKey ?? fallback.userKey,
    stage,
    state: stage,
    lastPhotoUrl: lastPhoto,
    lastPhoto,
    selectedStyle,
    chosenStyle: selectedStyle,
    quota: {
      dayKey: value?.quota?.dayKey ?? fallback.quota.dayKey,
      count: value?.quota?.count ?? fallback.quota.count,
    },
    updatedAt: value?.updatedAt ?? fallback.updatedAt,
  };
}

async function saveState(psid: string, nextState: MessengerUserState): Promise<MessengerUserState> {
  await writeState(psid, nextState);
  return nextState;
}

async function patchState(psid: string, patch: PartialState, now = Date.now()): Promise<MessengerUserState> {
  const current = await getOrCreateState(psid);
  const nextState = normalizeState(psid, {
    ...current,
    ...patch,
    updatedAt: now,
  });
  return saveState(psid, nextState);
}

export function getQuickRepliesForState(state: ConversationState): StateQuickReply[] {
  return QUICK_REPLIES_BY_STATE[state];
}

export function anonymizePsid(psid: string): string {
  return toUserKey(psid);
}

export function getDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export async function getState(psid: string): Promise<MessengerUserState | null> {
  const state = await readState<PartialState>(psid);
  return state ? normalizeState(psid, state) : null;
}

export async function getOrCreateState(psid: string): Promise<MessengerUserState> {
  const state = await getState(psid);
  if (state) {
    return state;
  }

  return saveState(psid, createDefaultState(psid));
}

export async function setFlowState(psid: string, nextState: MessengerFlowState): Promise<void> {
  await patchState(psid, {
    stage: nextState,
    state: nextState,
  });
}

export async function setPendingImage(psid: string, imageUrl: string, now = Date.now()): Promise<void> {
  await patchState(
    psid,
    {
      lastPhotoUrl: imageUrl,
      lastPhoto: imageUrl,
      pendingImageUrl: imageUrl,
      pendingImageAt: now,
      stage: "AWAITING_STYLE",
      state: "AWAITING_STYLE",
    },
    now,
  );
}

export async function clearPendingImageState(psid: string, now = Date.now()): Promise<MessengerUserState> {
  return patchState(
    psid,
    {
      lastPhotoUrl: null,
      lastPhoto: null,
      pendingImageUrl: undefined,
      pendingImageAt: undefined,
      selectedStyle: null,
      chosenStyle: null,
    },
    now,
  );
}

export async function setPreselectedStyle(psid: string, style: string | null, now = Date.now()): Promise<MessengerUserState> {
  return patchState(
    psid,
    {
      preselectedStyle: style,
    },
    now,
  );
}

export async function setChosenStyle(psid: string, style: string, now = Date.now()): Promise<void> {
  await patchState(
    psid,
    {
      selectedStyle: style,
      chosenStyle: style,
    },
    now,
  );
}

export async function setPreferredLang(psid: string, lang: Lang, now = Date.now()): Promise<void> {
  await patchState(
    psid,
    {
      preferredLang: lang,
    },
    now,
  );
}

export async function setLastGenerated(psid: string, resultImageUrl: string, now = Date.now()): Promise<void> {
  await patchState(
    psid,
    {
      lastImageUrl: resultImageUrl,
      lastGeneratedUrl: resultImageUrl,
      lastGeneratedAt: now,
      stage: "RESULT_READY",
      state: "RESULT_READY",
    },
    now,
  );
}

export function pruneOldState(): void {}
export function resetStateStore(): void {}
