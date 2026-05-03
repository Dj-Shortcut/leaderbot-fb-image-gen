import { ensureRedisReady, getRedisClient, isRedisEnabled, resetRedisClientForTests } from "../redis";
import { safeLog } from "../messengerApi";

const WEBHOOK_INGRESS_QUEUE_KEY = "meta-webhook-ingress";

type WebhookChannel = "facebook" | "whatsapp";

type QueuedWebhookDelivery = {
  channel: WebhookChannel;
  payload: unknown;
  receivedAt: string;
};

let drainPromise: Promise<void> | null = null;

function processWhatsAppWebhookPayloadSafely(payload: unknown): void {
  void import("../whatsappWebhook")
    .then(module => module.processWhatsAppWebhookPayload(payload))
    .catch(error => {
      safeLog("webhook_async_processing_failed", {
        channel: "whatsapp",
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function processFacebookWebhookPayloadSafely(payload: unknown): void {
  void import("../messengerWebhook")
    .then(module => module.processFacebookWebhookPayload(payload))
    .catch(error => {
      safeLog("webhook_async_processing_failed", {
        channel: "facebook",
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
  return isRedisEnabled();
}

export async function ensureWebhookIngressQueueReady(): Promise<void> {
  await ensureRedisReady();
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

  await redis.rpush(WEBHOOK_INGRESS_QUEUE_KEY, JSON.stringify(delivery));
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
          const rawDelivery = await redis.lpop(WEBHOOK_INGRESS_QUEUE_KEY);
          if (!rawDelivery) {
            return;
          }

          try {
            processQueuedWebhookDelivery(
              JSON.parse(rawDelivery) as QueuedWebhookDelivery,
            );
          } catch (error) {
            safeLog("webhook_queued_delivery_failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        safeLog("webhook_ingress_queue_drain_failed", {
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
  resetRedisClientForTests();
  drainPromise = null;
}
