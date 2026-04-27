import { toUserKey } from "./privacy";
import type {
  MessengerFlowState,
  MessengerUserState,
} from "./messengerState";

type PartialState = Partial<MessengerUserState>;

type StateNormalizationBase = {
  resolvedPsid: string;
  fallback: MessengerUserState;
};

type LegacyStateFields = {
  stage: MessengerFlowState;
  lastPhoto: string | null;
  selectedStyle: string | null;
  lastGeneratedUrl: string | null | undefined;
};

function looksLikeUserKey(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function firstDefined<T>(...values: Array<T | null | undefined>): T {
  for (let index = 0; index < values.length - 1; index += 1) {
    const value = values[index];
    if (value !== null && value !== undefined) {
      return value;
    }
  }

  return values[values.length - 1] as T;
}

export function getUserKey(psid: string): string {
  return looksLikeUserKey(psid) ? psid : toUserKey(psid);
}

export function getDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function createDefaultState(
  psid: string,
  now = Date.now()
): MessengerUserState {
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
    consentGiven: false,
    consentTimestamp: undefined,
    pendingDeleteConfirm: false,
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

export function normalizeState(
  psid: string,
  value: PartialState | null | undefined
): MessengerUserState {
  const base = createStateNormalizationBase(psid, value);
  const legacyFields = resolveLegacyStateFields(value, base.fallback);

  return applyNormalizedStateShape(value, base, legacyFields);
}

function createStateNormalizationBase(
  psid: string,
  value: PartialState | null | undefined
): StateNormalizationBase {
  const resolvedPsid = value?.psid ?? psid;
  const fallback = createDefaultState(resolvedPsid);
  return { resolvedPsid, fallback };
}

function resolveLegacyStateFields(
  value: PartialState | null | undefined,
  fallback: MessengerUserState
): LegacyStateFields {
  const stage = firstDefined(value?.stage, value?.state, fallback.stage);
  const lastPhoto = firstDefined(
    value?.lastPhotoUrl,
    value?.lastPhoto,
    fallback.lastPhoto
  );
  const selectedStyle = firstDefined(
    value?.selectedStyle,
    value?.chosenStyle,
    fallback.selectedStyle
  );
  const lastGeneratedUrl = firstDefined(
    value?.lastGeneratedUrl,
    value?.lastImageUrl,
    fallback.lastGeneratedUrl
  );

  return { stage, lastPhoto, selectedStyle, lastGeneratedUrl };
}

function applyNormalizedStateShape(
  value: PartialState | null | undefined,
  base: StateNormalizationBase,
  legacyFields: LegacyStateFields
): MessengerUserState {
  const { resolvedPsid, fallback } = base;
  const { stage, lastPhoto, selectedStyle, lastGeneratedUrl } = legacyFields;

  return {
    ...fallback,
    ...value,
    psid: resolvedPsid,
    userKey: firstDefined(value?.userKey, fallback.userKey),
    consentGiven: firstDefined(value?.consentGiven, fallback.consentGiven),
    consentTimestamp: firstDefined(
      value?.consentTimestamp,
      fallback.consentTimestamp
    ),
    pendingDeleteConfirm:
      firstDefined(value?.pendingDeleteConfirm, fallback.pendingDeleteConfirm),
    hasSeenIntro: firstDefined(value?.hasSeenIntro, fallback.hasSeenIntro),
    stage,
    state: stage,
    lastEntryIntent: firstDefined(
      value?.lastEntryIntent,
      fallback.lastEntryIntent
    ),
    activeExperience: firstDefined(
      value?.activeExperience,
      fallback.activeExperience
    ),
    lastUserMessageAt: firstDefined(
      value?.lastUserMessageAt,
      fallback.lastUserMessageAt
    ),
    lastPhotoUrl: lastPhoto,
    lastPhoto,
    lastPhotoSource: firstDefined(
      value?.lastPhotoSource,
      fallback.lastPhotoSource
    ),
    selectedStyle,
    chosenStyle: selectedStyle,
    selectedStyleCategory:
      firstDefined(value?.selectedStyleCategory, fallback.selectedStyleCategory),
    lastImageUrl: firstDefined(
      value?.lastImageUrl,
      lastGeneratedUrl,
      fallback.lastImageUrl
    ),
    lastGeneratedUrl,
    faceMemoryConsent: firstDefined(
      value?.faceMemoryConsent,
      fallback.faceMemoryConsent
    ),
    lastSourceImageUrl: firstDefined(
      value?.lastSourceImageUrl,
      fallback.lastSourceImageUrl
    ),
    lastSourceImageUpdatedAt: firstDefined(
      value?.lastSourceImageUpdatedAt,
      fallback.lastSourceImageUpdatedAt
    ),
    pendingSourceImageDeleteUrl: firstDefined(
      value?.pendingSourceImageDeleteUrl,
      fallback.pendingSourceImageDeleteUrl
    ),
    quota: {
      dayKey: firstDefined(value?.quota?.dayKey, fallback.quota.dayKey),
      count: firstDefined(value?.quota?.count, fallback.quota.count),
    },
    updatedAt: firstDefined(value?.updatedAt, fallback.updatedAt),
  };
}
