import { toUserKey } from "../privacy";
import type { NormalizedInboundMessage } from "../normalizedInboundMessage";

export function isWhatsAppWebhookPayload(
  payload: unknown
): payload is { object: "whatsapp_business_account" } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { object?: unknown }).object === "whatsapp_business_account"
  );
}

export function logWhatsAppWebhookPayload(payload: unknown): void {
  const entries = Array.isArray((payload as { entry?: unknown[] } | null)?.entry)
    ? (payload as { entry: unknown[] }).entry.length
    : 0;
  const summary =
    typeof payload === "object" && payload !== null
      ? {
          object: (payload as { object?: unknown }).object ?? null,
          entryCount: entries,
        }
      : { object: null, entryCount: 0 };

  if (process.env.WEBHOOK_DEBUG_LOGS === "1") {
    console.log("[whatsapp webhook] inbound payload", summary);
    return;
  }

  console.log("[whatsapp webhook] inbound payload summary", summary);
}

export function extractWhatsAppEvents(
  payload: unknown
): NormalizedInboundMessage[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const entries = Array.isArray((payload as { entry?: unknown[] }).entry)
    ? (payload as { entry: unknown[] }).entry
    : [];

  return entries.flatMap(entry => {
    const changes = Array.isArray(
      (entry as { changes?: unknown[] } | null)?.changes
    )
      ? ((entry as { changes: unknown[] }).changes ?? [])
      : [];

    return changes.flatMap(change => {
      const value =
        typeof change === "object" && change !== null
          ? ((change as { value?: unknown }).value ?? null)
          : null;
      const messages = Array.isArray(
        (value as { messages?: unknown[] } | null)?.messages
      )
        ? ((value as { messages: unknown[] }).messages ?? [])
        : [];

      return messages.flatMap(message => {
        if (typeof message !== "object" || message === null) {
          return [];
        }

        const from =
          typeof (message as { from?: unknown }).from === "string"
            ? (message as { from: string }).from
            : "";
        const messageType =
          typeof (message as { type?: unknown }).type === "string"
            ? (message as { type: string }).type
            : "unknown";
        const textBody =
          typeof (message as { text?: { body?: unknown } }).text?.body ===
          "string"
            ? (message as { text: { body: string } }).text.body
            : null;
        const interactiveReplyId =
          typeof (message as {
            interactive?: {
              button_reply?: { id?: unknown };
              list_reply?: { id?: unknown };
            };
          }).interactive?.button_reply?.id === "string"
            ? (message as {
                interactive: { button_reply: { id: string } };
              }).interactive.button_reply.id
            : typeof (message as {
                  interactive?: { list_reply?: { id?: unknown } };
                }).interactive?.list_reply?.id === "string"
              ? (message as {
                  interactive: { list_reply: { id: string } };
                }).interactive.list_reply.id
              : null;
        const interactiveReplyTitle =
          typeof (message as {
            interactive?: {
              button_reply?: { title?: unknown };
              list_reply?: { title?: unknown };
            };
          }).interactive?.button_reply?.title === "string"
            ? (message as {
                interactive: { button_reply: { title: string } };
              }).interactive.button_reply.title
            : typeof (message as {
                  interactive?: { list_reply?: { title?: unknown } };
                }).interactive?.list_reply?.title === "string"
              ? (message as {
                  interactive: { list_reply: { title: string } };
                }).interactive.list_reply.title
              : null;
        const imageId =
          typeof (message as { image?: { id?: unknown } }).image?.id ===
          "string"
            ? (message as { image: { id: string } }).image.id
            : null;
        const timestampRaw =
          typeof (message as { timestamp?: unknown }).timestamp === "string"
            ? Number((message as { timestamp: string }).timestamp)
            : null;

        if (!from) {
          return [];
        }

        return [
          {
            channel: "whatsapp",
            senderId: from,
            userId: toUserKey(from),
            channelCapabilities: {
              quickReplies: false,
              richTemplates: false,
            },
            rawMessageType: messageType,
            messageType:
              messageType === "text" || messageType === "interactive"
                ? "text"
                : messageType === "image"
                  ? "image"
                  : "unknown",
            textBody:
              interactiveReplyId ??
              interactiveReplyTitle ??
              textBody ??
              undefined,
            imageId: imageId ?? undefined,
            timestamp: Number.isFinite(timestampRaw) ? timestampRaw! * 1000 : undefined,
            ...(interactiveReplyId || interactiveReplyTitle
              ? {
                  rawEventMeta: {
                    interactiveReplyId: interactiveReplyId ?? undefined,
                    interactiveReplyTitle: interactiveReplyTitle ?? undefined,
                  },
                }
              : {}),
          },
        ];
      });
    });
  });
}
