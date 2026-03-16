import { createHash } from "node:crypto";
import { normalizeLang, t, type Lang } from "./i18n";
import { getQuickRepliesForState, type ConversationState } from "./messengerState";
import { type Style } from "./messengerStyles";

export type FacebookWebhookEvent = {
  sender?: { id?: string; locale?: string };
  referral?: { ref?: string };
  message?: {
    mid?: string;
    is_echo?: boolean;
    text?: string;
    quick_reply?: { payload?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  postback?: {
    title?: string;
    payload?: string;
    referral?: { ref?: string };
  };
  timestamp?: number;
};

export type FacebookWebhookEntry = {
  id?: string;
  messaging?: FacebookWebhookEvent[];
};

export type WebhookSummaryEvent = {
  type: "message" | "postback" | "read" | "delivery" | "unknown";
  hasText: boolean;
  attachmentTypes: string[];
  isEcho: boolean;
  hasRead: boolean;
  hasDelivery: boolean;
  hasPostback: boolean;
};

export type WebhookSummary = {
  object?: string;
  entryCount: number;
  events: WebhookSummaryEvent[];
};

export const STYLE_OPTIONS: Style[] = [
  "caricature",
  "petals",
  "gold",
  "cinematic",
  "oil-paint",
  "cyberpunk",
  "disco",
  "clouds",
];

export const STYLE_LABELS: Record<Style, string> = {
  caricature: "Caricature",
  petals: "Petals",
  gold: "Gold",
  cinematic: "Cinematic",
  "oil-paint": "Oil Paint",
  cyberpunk: "Cyberpunk",
  disco: "Disco",
  clouds: "Clouds",
};

const STYLE_ALIASES: Record<string, Style> = {
  "oil paint": "oil-paint",
  "oil painting": "oil-paint",
  "oil-paint": "oil-paint",
};

function normalizeStyleToken(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export type AckKind = "like" | "ok" | "thanks" | "emoji";

type GreetingResponse =
  | { mode: "text"; text: string }
  | { mode: "quick_replies"; state: ConversationState; text: string };

export function getEventDedupeKey(
  event: FacebookWebhookEvent,
  userKey: string,
  entryId?: string,
): string | undefined {
  const messageId = event.message?.mid?.trim();
  if (messageId) {
    return `mid:${messageId}`;
  }

  const hashToken = (value: string | undefined): string => {
    const normalizedValue = value?.trim();
    if (!normalizedValue) {
      return "none";
    }

    return createHash("sha256").update(normalizedValue).digest("hex").slice(0, 12);
  };

  const eventType = event.message ? "message" : event.postback ? "postback" : "other";
  const postbackPayloadHash = hashToken(event.postback?.payload);
  const quickReplyPayloadHash = hashToken(event.message?.quick_reply?.payload);
  const hasText = event.message?.text?.trim() ? "1" : "0";
  const attachmentTypeCounts = (() => {
    const counts = new Map<string, number>();
    for (const attachment of event.message?.attachments ?? []) {
      const type = attachment.type?.trim() || "unknown";
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, count]) => `${type}:${count}`)
      .join(",") || "none";
  })();
  const fallbackEventFingerprint = [
    eventType,
    `postback:${postbackPayloadHash}`,
    `quickReply:${quickReplyPayloadHash}`,
    `hasText:${hasText}`,
    `attachments:${attachmentTypeCounts}`,
  ].join("|");

  const timestamp = event.timestamp;
  const normalizedEntryId = entryId?.trim();
  if (normalizedEntryId && Number.isFinite(timestamp)) {
    return `entry:${normalizedEntryId}:user:${userKey}:ts:${timestamp}:event:${fallbackEventFingerprint}`;
  }

  if (Number.isFinite(timestamp)) {
    return `fallback:${userKey}:${timestamp}:event:${fallbackEventFingerprint}`;
  }

  return undefined;
}

export function summarizeWebhook(payload: unknown): WebhookSummary {
  const entries = Array.isArray((payload as { entry?: unknown[] } | null | undefined)?.entry)
    ? (payload as { entry: Array<{ messaging?: FacebookWebhookEvent[] }> }).entry
    : [];

  const events = entries.flatMap(entry => {
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];

    return messaging.map<WebhookSummaryEvent>(event => {
      const attachmentTypes = Array.from(
        new Set(
          (event.message?.attachments ?? [])
            .map(attachment => attachment.type?.trim())
            .filter((type): type is string => Boolean(type)),
        ),
      );

      let type: WebhookSummaryEvent["type"] = "unknown";
      if (event.message) {
        type = "message";
      } else if (event.postback) {
        type = "postback";
      } else if ((event as { read?: unknown }).read) {
        type = "read";
      } else if ((event as { delivery?: unknown }).delivery) {
        type = "delivery";
      }

      return {
        type,
        hasText: Boolean(event.message?.text),
        attachmentTypes,
        isEcho: Boolean(event.message?.is_echo),
        hasRead: Boolean((event as { read?: unknown }).read),
        hasDelivery: Boolean((event as { delivery?: unknown }).delivery),
        hasPostback: Boolean(event.postback),
      };
    });
  });

  return {
    object:
      typeof (payload as { object?: unknown } | null | undefined)?.object === "string"
        ? ((payload as { object: string }).object)
        : undefined,
    entryCount: entries.length,
    events,
  };
}

export function getGreetingResponse(state: ConversationState, lang: Lang = normalizeLang(process.env.DEFAULT_MESSENGER_LANG)): GreetingResponse {
  switch (state) {
    case "PROCESSING":
      return { mode: "text", text: t(lang, "processingBlocked") };
    case "AWAITING_STYLE":
      return { mode: "quick_replies", state: "AWAITING_STYLE", text: t(lang, "stylePicker") };
    case "RESULT_READY":
      return {
        mode: "quick_replies",
        state: "RESULT_READY",
        text: t(lang, "success"),
      };
    case "FAILURE":
      return {
        mode: "quick_replies",
        state: "FAILURE",
        text: t(lang, "failure"),
      };
    case "AWAITING_PHOTO":
      return { mode: "text", text: t(lang, "textWithoutPhoto") };
    case "IDLE":
    default:
      return { mode: "quick_replies", state: "IDLE", text: t(lang, "flowExplanation") };
  }
}

export function normalizeStyle(input: string): Style | undefined {
  const normalized = normalizeStyleToken(input);
  const alias = STYLE_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  return STYLE_OPTIONS.find(style => normalizeStyleToken(style) === normalized);
}

export function stylePayloadToStyle(payload: string): Style | undefined {
  const canonicalPayloadStyle = normalizeStyle(payload);
  if (canonicalPayloadStyle) {
    return canonicalPayloadStyle;
  }

  if (!payload.startsWith("STYLE_")) {
    return undefined;
  }

  const styleKey = payload.slice("STYLE_".length).toLowerCase().replace(/_/g, "-");
  return normalizeStyle(styleKey);
}

export function parseStyle(text: string): Style | undefined {
  return normalizeStyle(text);
}

export function parseReferralStyle(ref: string | undefined): Style | undefined {
  if (!ref?.startsWith("style_")) {
    return undefined;
  }

  return normalizeStyle(ref.slice("style_".length));
}

export function detectAck(raw: string | undefined | null): AckKind | null {
  if (!raw) {
    return null;
  }

  const text = raw.trim();
  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();

  if (/^\(\s*y\s*\)$/.test(lower)) {
    return "like";
  }

  if (/^(ok|oke|k|kk|yes|yep|ja|jep)$/.test(lower)) {
    return "ok";
  }

  if (/^(thanks|thx|merci|tks)$/.test(lower)) {
    return "thanks";
  }

  if (text.length > 0 && Array.from(text).every(char => /[\p{Extended_Pictographic}\s]/u.test(char))) {
    return "emoji";
  }

  return null;
}

export function toMessengerReplies(state: ConversationState) {
  return getQuickRepliesForState(state).map(reply => ({
    content_type: "text" as const,
    title: reply.title,
    payload: reply.payload,
  }));
}
