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
  const stage = value?.stage ?? value?.state ?? fallback.stage;
  const lastPhoto =
    value?.lastPhotoUrl ?? value?.lastPhoto ?? fallback.lastPhoto;
  const selectedStyle =
    value?.selectedStyle ?? value?.chosenStyle ?? fallback.selectedStyle;
  const lastGeneratedUrl =
    value?.lastGeneratedUrl ?? value?.lastImageUrl ?? fallback.lastGeneratedUrl;

  return { stage, lastPhoto, selectedStyle, lastGeneratedUrl };
}

function resolveConsentState(
  value: PartialState | null | undefined,
  fallback: MessengerUserState
): Pick<
  MessengerUserState,
  "consentGiven" | "consentTimestamp" | "pendingDeleteConfirm" | "hasSeenIntro"
> {
  return {
    consentGiven: value?.consentGiven ?? fallback.consentGiven,
    consentTimestamp: value?.consentTimestamp ?? fallback.consentTimestamp,
    pendingDeleteConfirm:
      value?.pendingDeleteConfirm ?? fallback.pendingDeleteConfirm,
    hasSeenIntro: value?.hasSeenIntro ?? fallback.hasSeenIntro,
  };
}

function resolveConversationContext(
  value: PartialState | null | undefined,
  fallback: MessengerUserState
): Pick<
  MessengerUserState,
  "lastEntryIntent" | "activeExperience" | "lastUserMessageAt"
> {
  return {
    lastEntryIntent: value?.lastEntryIntent ?? fallback.lastEntryIntent,
    activeExperience: value?.activeExperience ?? fallback.activeExperience,
    lastUserMessageAt: value?.lastUserMessageAt ?? fallback.lastUserMessageAt,
  };
}

function resolvePhotoAndStyleState(
  value: PartialState | null | undefined,
  fallback: MessengerUserState,
  legacyFields: Pick<LegacyStateFields, "lastPhoto" | "selectedStyle">
): Pick<
  MessengerUserState,
  | "lastPhotoUrl"
  | "lastPhoto"
  | "lastPhotoSource"
  | "selectedStyle"
  | "chosenStyle"
  | "selectedStyleCategory"
> {
  const { lastPhoto, selectedStyle } = legacyFields;

  return {
    lastPhotoUrl: lastPhoto,
    lastPhoto,
    lastPhotoSource: value?.lastPhotoSource ?? fallback.lastPhotoSource,
    selectedStyle,
    chosenStyle: selectedStyle,
    selectedStyleCategory:
      value?.selectedStyleCategory ?? fallback.selectedStyleCategory,
  };
}

function resolveGeneratedImageState(
  value: PartialState | null | undefined,
  fallback: MessengerUserState,
  lastGeneratedUrl: LegacyStateFields["lastGeneratedUrl"]
): Pick<MessengerUserState, "lastImageUrl" | "lastGeneratedUrl"> {
  return {
    lastImageUrl: value?.lastImageUrl ?? lastGeneratedUrl ?? fallback.lastImageUrl,
    lastGeneratedUrl,
  };
}

function resolveSourceImageState(
  value: PartialState | null | undefined,
  fallback: MessengerUserState
): Pick<
  MessengerUserState,
  | "faceMemoryConsent"
  | "lastSourceImageUrl"
  | "lastSourceImageUpdatedAt"
  | "pendingSourceImageDeleteUrl"
> {
  return {
    faceMemoryConsent: value?.faceMemoryConsent ?? fallback.faceMemoryConsent,
    lastSourceImageUrl: value?.lastSourceImageUrl ?? fallback.lastSourceImageUrl,
    lastSourceImageUpdatedAt:
      value?.lastSourceImageUpdatedAt ?? fallback.lastSourceImageUpdatedAt,
    pendingSourceImageDeleteUrl:
      value?.pendingSourceImageDeleteUrl ?? fallback.pendingSourceImageDeleteUrl,
  };
}

function resolveQuotaState(
  value: PartialState | null | undefined,
  fallback: MessengerUserState
): MessengerUserState["quota"] {
  return {
    dayKey: value?.quota?.dayKey ?? fallback.quota.dayKey,
    count: value?.quota?.count ?? fallback.quota.count,
  };
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
    userKey: value?.userKey ?? fallback.userKey,
    ...resolveConsentState(value, fallback),
    stage,
    state: stage,
    ...resolveConversationContext(value, fallback),
    ...resolvePhotoAndStyleState(value, fallback, { lastPhoto, selectedStyle }),
    ...resolveGeneratedImageState(value, fallback, lastGeneratedUrl),
    ...resolveSourceImageState(value, fallback),
    quota: resolveQuotaState(value, fallback),
    updatedAt: value?.updatedAt ?? fallback.updatedAt,
  };
}
