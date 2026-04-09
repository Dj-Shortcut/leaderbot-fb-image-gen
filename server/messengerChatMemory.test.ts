import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetStateStore } from "./_core/messengerState";
import {
  appendMessengerChatHistory,
  getMessengerChatHistory,
} from "./_core/messengerChatMemory";

const originalHistoryLimit = process.env.MESSENGER_CHAT_HISTORY_LIMIT;
const originalHistoryTtl = process.env.MESSENGER_CHAT_HISTORY_TTL_SECONDS;
const originalRedisUrl = process.env.REDIS_URL;

describe("messenger chat memory", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    process.env.MESSENGER_CHAT_HISTORY_LIMIT = "2";
    process.env.MESSENGER_CHAT_HISTORY_TTL_SECONDS = "120";
    resetStateStore();
  });

  afterEach(() => {
    if (originalHistoryLimit === undefined) {
      delete process.env.MESSENGER_CHAT_HISTORY_LIMIT;
    } else {
      process.env.MESSENGER_CHAT_HISTORY_LIMIT = originalHistoryLimit;
    }

    if (originalHistoryTtl === undefined) {
      delete process.env.MESSENGER_CHAT_HISTORY_TTL_SECONDS;
    } else {
      process.env.MESSENGER_CHAT_HISTORY_TTL_SECONDS = originalHistoryTtl;
    }

    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  });

  it("trims history to configured limit and keeps latest messages", async () => {
    const userKey = "abc123userkey";
    await appendMessengerChatHistory(userKey, "user", "first");
    await appendMessengerChatHistory(userKey, "assistant", "second");
    await appendMessengerChatHistory(userKey, "user", "third");

    const history = await getMessengerChatHistory(userKey);
    expect(history).toHaveLength(2);
    expect(history[0]?.text).toBe("second");
    expect(history[1]?.text).toBe("third");
  });

  it("keeps histories isolated per user", async () => {
    await appendMessengerChatHistory("user-a", "user", "hello");
    await appendMessengerChatHistory("user-b", "assistant", "world");

    expect(await getMessengerChatHistory("user-a")).toEqual([
      expect.objectContaining({ role: "user", text: "hello" }),
    ]);
    expect(await getMessengerChatHistory("user-b")).toEqual([
      expect.objectContaining({ role: "assistant", text: "world" }),
    ]);
  });
});

