const WEBHOOK_INGRESS_QUEUE_KEY = "meta-webhook-ingress";

type WebhookChannel = "facebook" | "whatsapp";

type QueuedWebhookDelivery = {
  channel: WebhookChannel;
  payload: unknown;
  receivedAt: string;
};

type RedisLike = {
  ping(): Promise<string>;
  lPop(key: string): Promise<string | null>;
  rPush(key: string, value: string): Promise<number>;
};

type RedisModule = {
  default: new (url: string, ...args: unknown[]) => RedisLike;
};

let redisClientPromise: Promise<RedisLike> | null = null;
let drainPromise: Promise<void> | null = null;

function getRedisUrl(): string | null {
  return process.env.REDIS_URL?.trim() || null;
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

function processWhatsAppWebhookPayloadSafely(payload: unknown): void {
  void import("../whatsappWebhook")
    .then(module => module.processWhatsAppWebhookPayload(payload))
    .catch(error => {
      console.error("[whatsapp webhook] async processing failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function processFacebookWebhookPayloadSafely(payload: unknown): void {
  void import("../messengerWebhook")
    .then(module => module.processFacebookWebhookPayload(payload))
    .catch(error => {
      console.error("[messenger webhook] async processing failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function processQueuedWebhookDelivery(delivery: QueuedWebhookDelivery): void {
  if (delivery.channel === "whatsapp") {
    processWhatsAppWebhookPayloadSafely(delivery.payload);
    return;
  }

  processFacebookWebhookPayloadSafely(delivery.payload);
}

export function isWebhookIngressQueueEnabled(): boolean {
  return Boolean(getRedisUrl());
}

export async function ensureWebhookIngressQueueReady(): Promise<void> {
  if (!isWebhookIngressQueueEnabled()) {
    return;
  }

  const redis = await getRedisClient();
  await redis.ping();
}

export async function enqueueWebhookIngressDelivery(
  channel: WebhookChannel,
  payload: unknown,
): Promise<void> {
  const redis = await getRedisClient();
  const delivery: QueuedWebhookDelivery = {
    channel,
    payload,
    receivedAt: new Date().toISOString(),
  };

  await redis.rPush(WEBHOOK_INGRESS_QUEUE_KEY, JSON.stringify(delivery));
}

export function scheduleWebhookIngressDrain(): void {
  if (!isWebhookIngressQueueEnabled()) {
    return;
  }

  if (!drainPromise) {
    drainPromise = (async () => {
      try {
        const redis = await getRedisClient();

        while (true) {
          const rawDelivery = await redis.lPop(WEBHOOK_INGRESS_QUEUE_KEY);
          if (!rawDelivery) {
            return;
          }

          try {
            processQueuedWebhookDelivery(
              JSON.parse(rawDelivery) as QueuedWebhookDelivery,
            );
          } catch (error) {
            console.error("[meta webhook] failed to process queued delivery", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        console.error("[meta webhook] ingress queue drain failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        drainPromise = null;
      }
    })();
  }
}

export function processWebhookDeliveryInline(
  channel: WebhookChannel,
  payload: unknown,
): void {
  setImmediate(() => {
    processQueuedWebhookDelivery({
      channel,
      payload,
      receivedAt: new Date().toISOString(),
    });
  });
}

export function resetWebhookIngressQueueForTests(): void {
  redisClientPromise = null;
  drainPromise = null;
}
