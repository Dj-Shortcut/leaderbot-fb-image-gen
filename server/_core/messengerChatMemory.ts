import {
  deleteScopedState,
  readScopedState,
  writeScopedState,
} from "./stateStore";

export type MessengerChatRole = "user" | "assistant";

export type MessengerChatHistoryItem = {
  role: MessengerChatRole;
  text: string;
  ts: number;
};

const CHAT_HISTORY_SCOPE = "chat:history";
const DEFAULT_HISTORY_LIMIT = 12;
const DEFAULT_HISTORY_TTL_SECONDS = 60 * 60 * 24 * 7;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function getHistoryLimit(): number {
  return parsePositiveInt(
    process.env.MESSENGER_CHAT_HISTORY_LIMIT,
    DEFAULT_HISTORY_LIMIT
  );
}

function getHistoryTtlSeconds(): number {
  return parsePositiveInt(
    process.env.MESSENGER_CHAT_HISTORY_TTL_SECONDS,
    DEFAULT_HISTORY_TTL_SECONDS
  );
}

function normalizeHistory(
  value: unknown
): MessengerChatHistoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const role = (item as MessengerChatHistoryItem).role;
      const text = (item as MessengerChatHistoryItem).text;
      const ts = (item as MessengerChatHistoryItem).ts;

      if (
        (role !== "user" && role !== "assistant") ||
        typeof text !== "string" ||
        typeof ts !== "number"
      ) {
        return null;
      }

      return {
        role,
        text,
        ts,
      };
    })
    .filter((item): item is MessengerChatHistoryItem => Boolean(item));
}

function getChatHistoryStorageKey(userKey: string): string {
  return `${CHAT_HISTORY_SCOPE}:${userKey}`;
}

export async function getMessengerChatHistory(
  userKey: string
): Promise<MessengerChatHistoryItem[]> {
  const history = await Promise.resolve(
    readScopedState<MessengerChatHistoryItem[]>(CHAT_HISTORY_SCOPE, userKey)
  );
  return normalizeHistory(history);
}

export async function appendMessengerChatHistory(
  userKey: string,
  role: MessengerChatRole,
  text: string,
  ts = Date.now()
): Promise<MessengerChatHistoryItem[]> {
  const history = await getMessengerChatHistory(userKey);
  const nextHistory = history.concat([{ role, text, ts }]).slice(-getHistoryLimit());

  await Promise.resolve(
    writeScopedState(
      CHAT_HISTORY_SCOPE,
      userKey,
      nextHistory,
      getHistoryTtlSeconds()
    )
  );

  return nextHistory;
}

export async function clearMessengerChatHistory(userKey: string): Promise<void> {
  await Promise.resolve(deleteScopedState(CHAT_HISTORY_SCOPE, userKey));
}

