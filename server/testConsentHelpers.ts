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

export async function processConsentedFacebookWebhookPayload(
  processPayload: (payload: unknown) => Promise<void>,
  payload: unknown
): Promise<void> {
  await grantConsent(getMessengerSenderIds(payload));
  await processPayload(payload);
}

export async function processConsentedWhatsAppWebhookPayload(
  processPayload: (payload: unknown) => Promise<void>,
  payload: unknown
): Promise<void> {
  await grantConsent(getWhatsAppSenderIds(payload));
  await processPayload(payload);
}
