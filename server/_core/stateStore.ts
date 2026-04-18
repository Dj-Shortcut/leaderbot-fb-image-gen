const STATE_TTL_SECONDS = 172800;

type RedisLike = {
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  del(key: string): Promise<number>;
};

type RedisModule = {
  default: new (url: string, ...args: unknown[]) => RedisLike;
};

export type MaybePromise<T> = T | Promise<T>;

const memoryState = new Map<string, string>();
const memoryStateExpiresAt = new Map<string, number>();
const memoryEphemeral = new Map<string, number>();

let redisClientPromise: Promise<RedisLike> | null = null;

function getRedisUrl(): string | null {
  return process.env.REDIS_URL?.trim() || null;
}

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return typeof (value as Promise<T> | undefined)?.then === "function";
}

async function importRedisModule(): Promise<RedisModule> {
  return (await import("ioredis")) as unknown as RedisModule;
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

function getStateKey(psid: string): string {
  return getScopedStateKey("psid", psid);
}

function getScopedStateKey(scope: string, key: string): string {
  return `${scope}:${key}`;
}

export function isRedisStateStoreEnabled(): boolean {
  return Boolean(getRedisUrl());
}

export function assertProductionStateStoreConfig(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  if (!isRedisStateStoreEnabled()) {
    throw new Error("REDIS_URL must be configured in production for state consistency");
  }
}

export async function ensureStateStoreReady(): Promise<void> {
  if (!isRedisStateStoreEnabled()) {
    return;
  }

  const redis = await getRedisClient();
  await redis.ping();
}

function readRawState<T>(storageKey: string): MaybePromise<T | null> {
  if (!isRedisStateStoreEnabled()) {
    clearExpiredMemoryState();
    const payload = memoryState.get(storageKey);
    return payload ? (JSON.parse(payload) as T) : null;
  }

  return getRedisClient().then(async redis => {
    const payload = await redis.get(storageKey);
    return payload ? (JSON.parse(payload) as T) : null;
  });
}

function writeRawState<T>(
  storageKey: string,
  value: T,
  ttlSeconds = STATE_TTL_SECONDS
): MaybePromise<void> {
  const payload = JSON.stringify(value);

  if (!isRedisStateStoreEnabled()) {
    clearExpiredMemoryState();
    if (ttlSeconds <= 0) {
      memoryState.delete(storageKey);
      memoryStateExpiresAt.delete(storageKey);
      return;
    }
    memoryState.set(storageKey, payload);
    memoryStateExpiresAt.set(storageKey, Date.now() + ttlSeconds * 1000);
    return;
  }

  return getRedisClient().then(redis => {
    return redis
      .set(storageKey, payload, "EX", ttlSeconds)
      .then(() => undefined);
  });
}

function deleteRawState(storageKey: string): MaybePromise<void> {
  if (!isRedisStateStoreEnabled()) {
    memoryState.delete(storageKey);
    memoryStateExpiresAt.delete(storageKey);
    return;
  }

  return getRedisClient().then(redis => redis.del(storageKey).then(() => undefined));
}

export function readScopedState<T>(scope: string, key: string): MaybePromise<T | null> {
  return readRawState<T>(getScopedStateKey(scope, key));
}

export function writeScopedState<T>(
  scope: string,
  key: string,
  value: T,
  ttlSeconds = STATE_TTL_SECONDS
): MaybePromise<void> {
  return writeRawState(getScopedStateKey(scope, key), value, ttlSeconds);
}

export function deleteScopedState(scope: string, key: string): MaybePromise<void> {
  return deleteRawState(getScopedStateKey(scope, key));
}

export function readState<T>(psid: string): MaybePromise<T | null> {
  return readRawState<T>(getStateKey(psid));
}

export function writeState<T>(psid: string, value: T): MaybePromise<void> {
  return writeRawState(getStateKey(psid), value, STATE_TTL_SECONDS);
}

export function getOrCreateStoredState<T>(
  psid: string,
  createValue: () => T
): MaybePromise<T> {
  const current = readState<T>(psid);

  if (isPromiseLike(current)) {
    return current.then(existing => {
      if (existing) {
        return existing;
      }

      const created = createValue();
      return Promise.resolve(writeState(psid, created)).then(() => created);
    });
  }

  if (current) {
    return current;
  }

  const created = createValue();
  const saved = writeState(psid, created);

  if (isPromiseLike(saved)) {
    return saved.then(() => created);
  }

  return created;
}

export function updateStoredState<T>(
  psid: string,
  updater: (current: T | null) => T
): MaybePromise<T> {
  const current = readState<T>(psid);

  if (isPromiseLike(current)) {
    return current.then(existing => {
      const next = updater(existing);
      return Promise.resolve(writeState(psid, next)).then(() => next);
    });
  }

  const next = updater(current);
  const saved = writeState(psid, next);

  if (isPromiseLike(saved)) {
    return saved.then(() => next);
  }

  return next;
}

export function findInMemoryState<T>(
  predicate: (value: T) => boolean
): T | null {
  if (isRedisStateStoreEnabled()) {
    return null;
  }

  clearExpiredMemoryState();

  for (const payload of memoryState.values()) {
    const value = JSON.parse(payload) as T;
    if (predicate(value)) {
      return value;
    }
  }

  return null;
}

export function clearStateStore(): void {
  memoryState.clear();
  memoryStateExpiresAt.clear();
  memoryEphemeral.clear();
}

function clearExpiredMemoryState(now = Date.now()): void {
  for (const [key, expiresAt] of memoryStateExpiresAt.entries()) {
    if (expiresAt <= now) {
      memoryStateExpiresAt.delete(key);
      memoryState.delete(key);
    }
  }
}

function clearExpiredMemoryEphemeral(now = Date.now()): void {
  for (const [key, expiresAt] of memoryEphemeral.entries()) {
    if (expiresAt <= now) {
      memoryEphemeral.delete(key);
    }
  }
}

export async function hasEphemeralKey(key: string): Promise<boolean> {
  if (!isRedisStateStoreEnabled()) {
    clearExpiredMemoryEphemeral();
    return memoryEphemeral.has(key);
  }

  const redis = await getRedisClient();
  return (await redis.get(key)) !== null;
}

export async function setEphemeralKey(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  if (!isRedisStateStoreEnabled()) {
    memoryEphemeral.set(key, Date.now() + ttlSeconds * 1000);
    return;
  }

  const redis = await getRedisClient();
  await redis.set(key, value, "EX", ttlSeconds);
}

export async function setEphemeralKeyIfAbsent(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<boolean> {
  if (!isRedisStateStoreEnabled()) {
    clearExpiredMemoryEphemeral();
    if (memoryEphemeral.has(key)) {
      return false;
    }

    memoryEphemeral.set(key, Date.now() + ttlSeconds * 1000);
    return true;
  }

  const redis = await getRedisClient();
  const response = await redis.set(key, value, "EX", ttlSeconds, "NX");
  return response === "OK";
}

export async function deleteEphemeralKey(key: string): Promise<void> {
  if (!isRedisStateStoreEnabled()) {
    memoryEphemeral.delete(key);
    return;
  }

  const redis = await getRedisClient();
  await redis.del(key);
}

export { isPromiseLike };
