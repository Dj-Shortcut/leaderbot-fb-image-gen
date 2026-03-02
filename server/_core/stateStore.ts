const STATE_TTL_SECONDS = 172800;

type RedisLike = {
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
};

type RedisModule = {
  default: new (url: string) => RedisLike;
};

let redisClientPromise: Promise<RedisLike> | null = null;

function getRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error("REDIS_URL is required");
  }

  return redisUrl;
}

async function importRedisModule(): Promise<RedisModule> {
  const dynamicImport = Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  return (await dynamicImport("ioredis")) as RedisModule;
}

async function createRedisClient(): Promise<RedisLike> {
  const { default: Redis } = await importRedisModule();
  return new Redis(getRedisUrl());
}

async function getRedisClient(): Promise<RedisLike> {
  if (!redisClientPromise) {
    redisClientPromise = createRedisClient();
  }

  return redisClientPromise;
}

function getStateKey(psid: string): string {
  return `psid:${psid}`;
}

export async function ensureStateStoreReady(): Promise<void> {
  const redis = await getRedisClient();
  await redis.ping();
}

export async function readState<T>(psid: string): Promise<T | null> {
  const redis = await getRedisClient();
  const payload = await redis.get(getStateKey(psid));
  if (!payload) {
    return null;
  }

  return JSON.parse(payload) as T;
}

export async function writeState<T>(psid: string, value: T): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(getStateKey(psid), JSON.stringify(value), "EX", STATE_TTL_SECONDS);
}

export { STATE_TTL_SECONDS };
