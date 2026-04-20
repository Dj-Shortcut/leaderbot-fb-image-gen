import type { Style, StyleCategory } from "./messengerStyles";
import {
  STYLE_CATEGORY_CONFIGS,
  getStylesForCategory,
} from "./messengerStyles";
import type { ActiveExperience } from "./activeExperience";
import type { EntryIntent } from "./entryIntent";
import type { Lang } from "./i18n";
import { toUserKey } from "./privacy";
import {
  clearStateStore,
  findInMemoryState,
  getOrCreateStoredState,
  isPromiseLike,
  isRedisStateStoreEnabled,
  readState,
  type MaybePromise,
  updateStoredState,
  writeState,
} from "./stateStore";

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

export type SourceImageOrigin = "external" | "stored";

export type MessengerUserState = {
  psid: string;
  userKey: string;
  stage: MessengerFlowState;
  state: MessengerFlowState;
  lastEntryIntent?: EntryIntent | null;
  activeExperience?: ActiveExperience | null;
  lastUserMessageAt?: number;
  lastPhotoUrl: string | null;
  lastPhoto: string | null;
  lastPhotoSource?: SourceImageOrigin | null;
  selectedStyle: string | null;
  chosenStyle: string | null;
  selectedStyleCategory?: StyleCategory | null;
  preselectedStyle?: string | null;
  preferredLang?: Lang;
  hasSeenIntro: boolean;
  pendingImageUrl?: string;
  pendingImageAt?: number;
  faceMemoryConsent?: {
    given: boolean;
    timestamp: number;
    version: string;
  } | null;
  lastSourceImageUrl?: string | null;
  lastSourceImageUpdatedAt?: number | null;
  pendingSourceImageDeleteUrl?: string | null;
  lastImageUrl?: string;
  lastGeneratedUrl?: string | null;
  lastStyle?: Style;
  lastPrompt?: string;
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
  AWAITING_STYLE: STYLE_CATEGORY_CONFIGS.map(category => ({
    title: category.label,
    payload: category.payload,
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

function looksLikeUserKey(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function getUserKey(psid: string): string {
  return looksLikeUserKey(psid) ? psid : toUserKey(psid);
}

function createDefaultState(psid: string, now = Date.now()): MessengerUserState {
  return {
    psid,
    userKey: getUserKey(psid),
    stage: "IDLE",
    state: "IDLE",
    lastEntryIntent: null,
    activeExperience: null,
    lastUserMessageAt: undefined,
    lastPhotoUrl: null,
    lastPhoto: null,
    lastPhotoSource: null,
    selectedStyle: null,
    chosenStyle: null,
    selectedStyleCategory: null,
    preselectedStyle: null,
    preferredLang: "nl",
    hasSeenIntro: false,
    pendingImageUrl: undefined,
    pendingImageAt: undefined,
    faceMemoryConsent: null,
    lastSourceImageUrl: null,
    lastSourceImageUpdatedAt: null,
    pendingSourceImageDeleteUrl: null,
    lastImageUrl: undefined,
    lastGeneratedUrl: null,
    lastStyle: undefined,
    lastPrompt: undefined,
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
  const resolvedPsid = value?.psid ?? psid;
  const fallback = createDefaultState(resolvedPsid);
  const stage = value?.stage ?? value?.state ?? fallback.stage;
  const lastPhoto = value?.lastPhotoUrl ?? value?.lastPhoto ?? fallback.lastPhoto;
  const selectedStyle = value?.selectedStyle ?? value?.chosenStyle ?? fallback.selectedStyle;
  const lastGeneratedUrl = value?.lastGeneratedUrl ?? value?.lastImageUrl ?? fallback.lastGeneratedUrl;

  return {
    ...fallback,
    ...value,
    psid: resolvedPsid,
    userKey: value?.userKey ?? fallback.userKey,
    hasSeenIntro: value?.hasSeenIntro ?? fallback.hasSeenIntro,
    stage,
    state: stage,
    lastEntryIntent: value?.lastEntryIntent ?? fallback.lastEntryIntent,
    activeExperience: value?.activeExperience ?? fallback.activeExperience,
    lastUserMessageAt: value?.lastUserMessageAt ?? fallback.lastUserMessageAt,
    lastPhotoUrl: lastPhoto,
    lastPhoto,
    lastPhotoSource: value?.lastPhotoSource ?? fallback.lastPhotoSource,
    selectedStyle,
    chosenStyle: selectedStyle,
    selectedStyleCategory:
      value?.selectedStyleCategory ?? fallback.selectedStyleCategory,
    lastImageUrl: value?.lastImageUrl ?? lastGeneratedUrl ?? fallback.lastImageUrl,
    lastGeneratedUrl,
    faceMemoryConsent: value?.faceMemoryConsent ?? fallback.faceMemoryConsent,
    lastSourceImageUrl: value?.lastSourceImageUrl ?? fallback.lastSourceImageUrl,
    lastSourceImageUpdatedAt:
      value?.lastSourceImageUpdatedAt ?? fallback.lastSourceImageUpdatedAt,
    pendingSourceImageDeleteUrl:
      value?.pendingSourceImageDeleteUrl ?? fallback.pendingSourceImageDeleteUrl,
    quota: {
      dayKey: value?.quota?.dayKey ?? fallback.quota.dayKey,
      count: value?.quota?.count ?? fallback.quota.count,
    },
    updatedAt: value?.updatedAt ?? fallback.updatedAt,
  };
}

function saveState(psid: string, nextState: MessengerUserState): MaybePromise<MessengerUserState> {
  const result = writeState(psid, nextState);
  if (isPromiseLike(result)) {
    return result.then(() => nextState);
  }

  return nextState;
}

function getStateFromMemory(psid: string): MessengerUserState | null {
  const direct = readState<PartialState>(psid);
  if (isPromiseLike(direct)) {
    throw new Error("Unexpected async state read in memory mode");
  }

  if (direct) {
    return normalizeState(psid, direct);
  }

  const userKey = getUserKey(psid);
  const legacyState = findInMemoryState<PartialState>(state => state.userKey === userKey);
  return legacyState ? normalizeState(legacyState.psid ?? psid, legacyState) : null;
}

function getStateFromRedis(psid: string): Promise<MessengerUserState | null> {
  return Promise.resolve(readState<PartialState>(psid)).then(state => {
    return state ? normalizeState(psid, state) : null;
  });
}

function patchStateInMemory(psid: string, patch: PartialState, now = Date.now()): MessengerUserState {
  const current = getOrCreateState(psid);
  if (isPromiseLike(current)) {
    throw new Error("Unexpected async state patch in memory mode");
  }

  const nextState = normalizeState(psid, {
    ...current,
    ...patch,
    updatedAt: now,
  });

  const saved = saveState(psid, nextState);
  if (isPromiseLike(saved)) {
    throw new Error("Unexpected async state save in memory mode");
  }

  return saved;
}

function patchStateInRedis(psid: string, patch: PartialState, now = Date.now()): Promise<MessengerUserState> {
  return Promise.resolve(
    updateStoredState<PartialState>(psid, current => {
      const nextState = normalizeState(psid, {
        ...normalizeState(psid, current),
        ...patch,
        updatedAt: now,
      });
      return nextState;
    }),
  ).then(state => normalizeState(psid, state));
}

function patchState(psid: string, patch: PartialState, now = Date.now()): MaybePromise<MessengerUserState> {
  if (!isRedisStateStoreEnabled()) {
    return patchStateInMemory(psid, patch, now);
  }

  return patchStateInRedis(psid, patch, now);
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

function getMessengerResponseWindowMs(): number {
  const configured = Number(process.env.MESSENGER_RESPONSE_WINDOW_MS);
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.floor(configured);
  }

  return 24 * 60 * 60 * 1000;
}

export function getState(psid: string): MaybePromise<MessengerUserState | null> {
  if (!isRedisStateStoreEnabled()) {
    return getStateFromMemory(psid);
  }

  return getStateFromRedis(psid);
}

export function hasOpenMessengerResponseWindow(psid: string, now = Date.now()): MaybePromise<boolean> {
  const state = getState(psid);

  if (isPromiseLike(state)) {
    return state.then(current => {
      if (!current?.lastUserMessageAt) {
        return false;
      }

      return now - current.lastUserMessageAt <= getMessengerResponseWindowMs();
    });
  }

  if (!state?.lastUserMessageAt) {
    return false;
  }

  return now - state.lastUserMessageAt <= getMessengerResponseWindowMs();
}

export function getOrCreateState(psid: string): MaybePromise<MessengerUserState> {
  if (!isRedisStateStoreEnabled()) {
    const state = getStateFromMemory(psid);
    if (state) {
      return state;
    }

    const createdState = createDefaultState(psid);
    return saveState(psid, createdState);
  }

  return Promise.resolve(getOrCreateStoredState(psid, () => createDefaultState(psid))).then(state => {
    return normalizeState(psid, state);
  });
}

export function setFlowState(psid: string, nextState: MessengerFlowState): MaybePromise<void> {
  const result = patchState(psid, {
    stage: nextState,
    state: nextState,
  });

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function setLastEntryIntent(
  psid: string,
  entryIntent: EntryIntent | null,
  now = Date.now()
): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      lastEntryIntent: entryIntent,
    },
    now
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function setActiveExperience(
  psid: string,
  activeExperience: ActiveExperience | null,
  now = Date.now()
): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      activeExperience,
    },
    now
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

function clearActiveExperience(
  psid: string,
  now = Date.now()
): MaybePromise<void> {
  return setActiveExperience(psid, null, now);
}

export function setPendingImage(
  psid: string,
  imageUrl: string,
  now = Date.now(),
  source: SourceImageOrigin = "external"
): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      lastPhotoUrl: imageUrl,
      lastPhoto: imageUrl,
      lastPhotoSource: source,
      pendingImageUrl: imageUrl,
      pendingImageAt: now,
      stage: "AWAITING_STYLE",
      state: "AWAITING_STYLE",
    },
    now,
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function setPendingStoredImage(
  psid: string,
  imageUrl: string,
  now = Date.now()
): MaybePromise<void> {
  return setPendingImage(psid, imageUrl, now, "stored");
}

export function rememberFaceSourceImage(
  psid: string,
  imageUrl: string,
  now = Date.now()
): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      faceMemoryConsent: { given: true, timestamp: now, version: "v1" },
      lastSourceImageUrl: imageUrl,
      lastSourceImageUpdatedAt: now,
      pendingSourceImageDeleteUrl: null,
      lastPhotoUrl: imageUrl,
      lastPhoto: imageUrl,
      lastPhotoSource: "stored",
    },
    now
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function setFaceMemoryConsentGiven(
  psid: string,
  now = Date.now()
): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      faceMemoryConsent: { given: true, timestamp: now, version: "v1" },
    },
    now
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function declineFaceMemory(psid: string, now = Date.now()): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      faceMemoryConsent: { given: false, timestamp: now, version: "v1" },
      lastSourceImageUrl: null,
      lastSourceImageUpdatedAt: null,
    },
    now
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function clearFaceMemoryState(
  psid: string,
  now = Date.now(),
  pendingDeleteUrl: string | null = null
): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      faceMemoryConsent: null,
      lastSourceImageUrl: null,
      lastSourceImageUpdatedAt: null,
      pendingSourceImageDeleteUrl: pendingDeleteUrl,
      lastPhotoUrl: null,
      lastPhoto: null,
      lastPhotoSource: null,
      pendingImageUrl: undefined,
      pendingImageAt: undefined,
    },
    now
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function clearPendingImageState(psid: string, now = Date.now()): MaybePromise<MessengerUserState> {
  return patchState(
    psid,
    {
      lastPhotoUrl: null,
      lastPhoto: null,
      lastPhotoSource: null,
      pendingImageUrl: undefined,
      pendingImageAt: undefined,
      selectedStyle: null,
      chosenStyle: null,
      selectedStyleCategory: null,
    },
    now,
  );
}

export function setPreselectedStyle(psid: string, style: string | null, now = Date.now()): MaybePromise<MessengerUserState> {
  return patchState(
    psid,
    {
      preselectedStyle: style,
    },
    now,
  );
}

export function setChosenStyle(psid: string, style: string, now = Date.now()): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      selectedStyle: style,
      chosenStyle: style,
      selectedStyleCategory: null,
    },
    now,
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function setSelectedStyleCategory(
  psid: string,
  category: StyleCategory | null,
  now = Date.now()
): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      selectedStyleCategory: category,
    },
    now
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function getStyleRepliesForCategory(category: StyleCategory): StateQuickReply[] {
  return [
    ...getStylesForCategory(category).map(style => ({
      title: style.label,
      payload: style.payload,
    })),
    {
      title: "↩️ Categorieen",
      payload: "CHOOSE_STYLE",
    },
  ];
}

export function setPreferredLang(psid: string, lang: Lang, now = Date.now()): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      preferredLang: lang,
    },
    now,
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function setLastUserMessageAt(psid: string, timestamp = Date.now()): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      lastUserMessageAt: timestamp,
    },
    timestamp,
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function markIntroSeen(psid: string, now = Date.now()): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      hasSeenIntro: true,
      stage: "AWAITING_PHOTO",
      state: "AWAITING_PHOTO",
    },
    now,
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function setLastGenerated(psid: string, resultImageUrl: string, now = Date.now()): MaybePromise<void> {
  const result = patchState(
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

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

export function setLastGenerationContext(
  psid: string,
  context: { style?: Style; prompt?: string },
  now = Date.now()
): MaybePromise<void> {
  const result = patchState(
    psid,
    {
      lastStyle: context.style,
      lastPrompt: context.prompt,
    },
    now,
  );

  if (isPromiseLike(result)) {
    return result.then(() => undefined);
  }
}

function pruneOldState(): void {}

export function resetStateStore(): void {
  clearStateStore();
}
