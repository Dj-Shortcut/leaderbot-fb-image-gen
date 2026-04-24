import { setConsentState } from "./_core/messengerState";

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function collectSenderIds(
  values: unknown[],
  getSenderId: (value: unknown) => unknown
): string[] {
  const ids = new Set<string>();

  for (const value of values) {
    const senderId = getSenderId(value);
    if (typeof senderId === "string") {
      ids.add(senderId);
    }
  }

  return Array.from(ids);
}

function getPayloadEntries(payload: unknown): unknown[] {
  return asArray((payload as { entry?: unknown[] })?.entry);
}

function getMessengerEvents(payload: unknown): unknown[] {
  return getPayloadEntries(payload).flatMap(entry =>
    asArray((entry as { messaging?: unknown[] })?.messaging)
  );
}

function getWhatsAppMessages(payload: unknown): unknown[] {
  return getPayloadEntries(payload)
    .flatMap(entry => asArray((entry as { changes?: unknown[] })?.changes))
    .flatMap(change =>
      asArray((change as { value?: { messages?: unknown[] } })?.value?.messages)
    );
}

function getMessengerSenderIds(payload: unknown): string[] {
  return collectSenderIds(
    getMessengerEvents(payload),
    event => (event as { sender?: { id?: unknown } })?.sender?.id
  );
}

function getWhatsAppSenderIds(payload: unknown): string[] {
  return collectSenderIds(
    getWhatsAppMessages(payload),
    message => (message as { from?: unknown })?.from
  );
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
  processPayload: WebhookPayloadProcessor,
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
