const DEFAULT_REPLAY_TTL_SECONDS = 300;
const DEFAULT_MAX_REPLAY_KEYS = 10000;
const REPLAY_KEY_PREFIX = "webhook-replay:";

type RedisLike = {
  ping(): Promise<string>;
  set(key: string, value: string, mode: "EX", seconds: number, condition: "NX"): Promise<"OK" | null>;
};

type RedisModule = {
  default: new (url: string) => RedisLike;
};

const memoryReplayKeys = new Map<string, number>();

let redisClientPromise: Promise<RedisLike> | null = null;

function getRedisUrl(): string | null {
  return process.env.REDIS_URL?.trim() || null;
}

function getReplayTtlSeconds(): number {
  const raw = Number(process.env.WEBHOOK_REPLAY_TTL_SECONDS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }

  return DEFAULT_REPLAY_TTL_SECONDS;
}

async function importRedisModule(): Promise<RedisModule> {
  const dynamicImport = Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  return (await dynamicImport("ioredis")) as RedisModule;
}

async function createRedisClient(): Promise<RedisLike> {
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }

  const { default: Redis } = await importRedisModule();
  return new Redis(redisUrl);
}

async function getRedisClient(): Promise<RedisLike> {
  if (!redisClientPromise) {
    redisClientPromise = createRedisClient();
  }

  return redisClientPromise;
}

function pruneMemoryReplayKeys(now: number): void {
  memoryReplayKeys.forEach((expiresAt, key) => {
    if (expiresAt <= now) {
      memoryReplayKeys.delete(key);
    }
  });

  while (memoryReplayKeys.size > DEFAULT_MAX_REPLAY_KEYS) {
    const oldestKey = memoryReplayKeys.keys().next().value;
    if (!oldestKey) {
      break;
    }

    memoryReplayKeys.delete(oldestKey);
  }
}

function toRedisReplayKey(key: string): string {
  return `${REPLAY_KEY_PREFIX}${key}`;
}

export function isRedisReplayProtectionEnabled(): boolean {
  return Boolean(getRedisUrl());
}

export async function ensureWebhookReplayProtectionReady(): Promise<void> {
  if (!isRedisReplayProtectionEnabled()) {
    return;
  }

  const redis = await getRedisClient();
  await redis.ping();
}

export async function claimWebhookReplayKey(key: string): Promise<boolean> {
  const ttlSeconds = getReplayTtlSeconds();

  if (!isRedisReplayProtectionEnabled()) {
    const now = Date.now();
    pruneMemoryReplayKeys(now);

    const expiresAt = memoryReplayKeys.get(key);
    if (expiresAt && expiresAt > now) {
      return false;
    }

    memoryReplayKeys.set(key, now + ttlSeconds * 1000);
    pruneMemoryReplayKeys(now);
    return true;
  }

  const redis = await getRedisClient();
  const result = await redis.set(toRedisReplayKey(key), "1", "EX", ttlSeconds, "NX");
  return result === "OK";
}

export function resetWebhookReplayProtection(): void {
  memoryReplayKeys.clear();
}

export { DEFAULT_REPLAY_TTL_SECONDS, DEFAULT_MAX_REPLAY_KEYS };
