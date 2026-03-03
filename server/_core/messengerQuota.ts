import { getDayKey, getOrCreateState, type MessengerUserState } from "./messengerState";
import { updateStoredState } from "./stateStore";

const FREE_DAILY_LIMIT = 1;

function withSyncedQuota(state: MessengerUserState, now = Date.now()): MessengerUserState {
  const dayKey = getDayKey(now);

  if (state.quota.dayKey === dayKey) {
    return state;
  }

  return {
    ...state,
    quota: {
      dayKey,
      count: 0,
    },
    updatedAt: now,
  };
}

async function syncQuotaState(psid: string, now = Date.now()): Promise<MessengerUserState> {
  const current = withSyncedQuota(await Promise.resolve(getOrCreateState(psid)), now);

  return Promise.resolve(
    updateStoredState<MessengerUserState>(psid, storedState => {
      if (!storedState) {
        return current;
      }

      return withSyncedQuota(storedState, now);
    }),
  );
}

export async function canGenerate(psid: string): Promise<boolean> {
  const state = await syncQuotaState(psid);
  return state.quota.count < FREE_DAILY_LIMIT;
}

export async function increment(psid: string): Promise<void> {
  const now = Date.now();
  const current = await syncQuotaState(psid, now);

  await Promise.resolve(
    updateStoredState<MessengerUserState>(psid, storedState => {
      const baseState = withSyncedQuota(storedState ?? current, now);

      return {
        ...baseState,
        quota: {
          ...baseState.quota,
          count: baseState.quota.count + 1,
        },
        updatedAt: now,
      };
    }),
  );
}
