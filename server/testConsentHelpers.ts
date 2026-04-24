import { setConsentState } from "./_core/messengerState";

function getMessengerSenderIds(payload: unknown): string[] {
  const ids = new Set<string>();
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) {
    return [];
  }

  for (const entry of entries) {
    const events = (entry as { messaging?: unknown[] })?.messaging;
    if (!Array.isArray(events)) {
      continue;
    }

    for (const event of events) {
      const senderId = (event as { sender?: { id?: unknown } })?.sender?.id;
      if (typeof senderId === "string") {
        ids.add(senderId);
      }
    }
  }

  return Array.from(ids);
}

function getWhatsAppSenderIds(payload: unknown): string[] {
  const ids = new Set<string>();
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) {
    return [];
  }

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) {
      continue;
    }

    for (const change of changes) {
      const messages = (change as { value?: { messages?: unknown[] } })?.value
        ?.messages;
      if (!Array.isArray(messages)) {
        continue;
      }

      for (const message of messages) {
        const senderId = (message as { from?: unknown })?.from;
        if (typeof senderId === "string") {
          ids.add(senderId);
        }
      }
    }
  }

  return Array.from(ids);
}

async function grantConsent(senderIds: string[]): Promise<void> {
  await Promise.all(senderIds.map(senderId => setConsentState(senderId, true)));
}

type WebhookPayloadProcessor = (payload: unknown) => Promise<void>;

export function processConsentedFacebookWebhookPayload(
  processPayload: WebhookPayloadProcessor
): WebhookPayloadProcessor;
export function processConsentedFacebookWebhookPayload(
  processPayload: WebhookPayloadProcessor,
  payload: unknown
): Promise<void>;
export function processConsentedFacebookWebhookPayload(
  processPayload: (payload: unknown) => Promise<void>,
  payload?: unknown
): Promise<void> | WebhookPayloadProcessor {
  async function processConsentedPayload(nextPayload: unknown): Promise<void> {
    await grantConsent(getMessengerSenderIds(nextPayload));
    await processPayload(nextPayload);
  }

  if (arguments.length === 1) {
    return processConsentedPayload;
  }

  return processConsentedPayload(payload);
}

export function processConsentedWhatsAppWebhookPayload(
  processPayload: WebhookPayloadProcessor
): WebhookPayloadProcessor;
export function processConsentedWhatsAppWebhookPayload(
  processPayload: WebhookPayloadProcessor,
  payload: unknown
): Promise<void>;
export function processConsentedWhatsAppWebhookPayload(
  processPayload: WebhookPayloadProcessor,
  payload?: unknown
): Promise<void> | WebhookPayloadProcessor {
  async function processConsentedPayload(nextPayload: unknown): Promise<void> {
    await grantConsent(getWhatsAppSenderIds(nextPayload));
    await processPayload(nextPayload);
  }

  if (arguments.length === 1) {
    return processConsentedPayload;
  }

  return processConsentedPayload(payload);
}
