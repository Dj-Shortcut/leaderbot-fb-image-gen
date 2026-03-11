import { appendMessengerChatHistory, getMessengerChatHistory } from "./messengerChatMemory";
import { t, type Lang } from "./i18n";
import { safeLog } from "./messengerApi";
import type { ConversationState } from "./messengerState";
import { toLogUser } from "./privacy";

type GenerateMessengerReplyInput = {
  psid: string;
  userKey: string;
  lang: Lang;
  stage: ConversationState;
  text: string;
  hasPhoto: boolean;
};

type GenerateMessengerReplyOutput = {
  text: string;
  source: "responses" | "fallback";
};

type ResponsesApiPayload = {
  model: string;
  input: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature: number;
  max_output_tokens: number;
};

const RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_TEXT_MODEL = "gpt-4.1-mini";
const DEFAULT_MAX_OUTPUT_TOKENS = 160;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RETRIES = 1;
const MAX_ALLOWED_RETRIES = 2;
const MAX_USER_TEXT_LENGTH = 1000;

function getTextModel(): string {
  return process.env.OPENAI_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL;
}

function getFallbackText(lang: Lang, hasPhoto: boolean): string {
  return hasPhoto ? t(lang, "flowExplanation") : t(lang, "textWithoutPhoto");
}

function getTextRequestTimeoutMs(): number {
  const configured = Number(process.env.OPENAI_TEXT_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }

  return DEFAULT_TIMEOUT_MS;
}

function getTextMaxRetries(): number {
  const configured = Number(process.env.OPENAI_TEXT_MAX_RETRIES);
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.min(Math.floor(configured), MAX_ALLOWED_RETRIES);
  }

  return DEFAULT_MAX_RETRIES;
}

function getTextMaxOutputTokens(): number {
  const configured = Number(process.env.OPENAI_TEXT_MAX_OUTPUT_TOKENS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(Math.floor(configured), 200);
  }

  return DEFAULT_MAX_OUTPUT_TOKENS;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sanitizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_USER_TEXT_LENGTH);
}

function toErrorCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "timeout";
    }

    if (error.message.startsWith("responses_http_")) {
      return error.message.split(":")[0];
    }

    if (error.message === "responses_retry_exhausted") {
      return "responses_retry_exhausted";
    }

    return "request_failed";
  }

  return "unknown_error";
}

function getRetryDelayMs(attempt: number): number {
  return 300 * 2 ** attempt;
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function buildSystemPrompt(input: {
  lang: Lang;
  stage: ConversationState;
  hasPhoto: boolean;
}): string {
  const language = input.lang === "en" ? "English" : "Dutch";
  const photoStatus = input.hasPhoto ? "yes" : "no";

  return [
    "You are Leaderbot on Facebook Messenger.",
    `Reply in ${language}.`,
    "Keep replies short and practical.",
    "Never claim an image was generated or queued.",
    "Never mention prompts, tools, APIs, or internals.",
    `Stage: ${input.stage}.`,
    `Has photo: ${photoStatus}.`,
    "If no photo, ask for a photo first.",
    "If photo exists, guide the user to style buttons when relevant.",
  ].join(" ");
}

function extractResponseText(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const outputText = (raw as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText.trim();
  }

  const output = (raw as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const directText = (item as { text?: unknown }).text;
    if (typeof directText === "string" && directText.trim()) {
      return directText.trim();
    }

    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const partText = (part as { text?: unknown }).text;
      if (typeof partText === "string" && partText.trim()) {
        return partText.trim();
      }
    }
  }

  return null;
}

async function callResponsesApi(
  payload: ResponsesApiPayload,
  apiKey: string
): Promise<unknown> {
  const timeoutMs = getTextRequestTimeoutMs();
  const maxRetries = getTextMaxRetries();

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(RESPONSES_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (attempt < maxRetries && isRetryableStatus(response.status)) {
          await sleep(getRetryDelayMs(attempt));
          continue;
        }

        const errorBody = await response.text();
        throw new Error(`responses_http_${response.status}:${errorBody.slice(0, 120)}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("responses_retry_exhausted");
}

export async function generateMessengerReply(
  input: GenerateMessengerReplyInput
): Promise<GenerateMessengerReplyOutput> {
  const fallbackText = getFallbackText(input.lang, input.hasPhoto);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const cleanText = sanitizeText(input.text);

  if (!apiKey) {
    safeLog("messenger_chat_fallback", {
      user: toLogUser(input.userKey),
      reason: "missing_openai_api_key",
    });
    return { text: fallbackText, source: "fallback" };
  }

  if (!cleanText) {
    return { text: fallbackText, source: "fallback" };
  }

  try {
    const history = await getMessengerChatHistory(input.userKey);
    await appendMessengerChatHistory(input.userKey, "user", cleanText);

    const payload: ResponsesApiPayload = {
      model: getTextModel(),
      input: [
        {
          role: "system",
          content: buildSystemPrompt(input),
        },
        ...history.map(item => ({
          role: item.role,
          content: item.text,
        })),
        {
          role: "user",
          content: cleanText,
        },
      ],
      temperature: 0.5,
      max_output_tokens: getTextMaxOutputTokens(),
    };

    const rawResponse = await callResponsesApi(payload, apiKey);
    const responseText = sanitizeText(extractResponseText(rawResponse) ?? "");

    if (!responseText) {
      safeLog("messenger_chat_fallback", {
        user: toLogUser(input.userKey),
        reason: "empty_output",
      });
      return { text: fallbackText, source: "fallback" };
    }

    await appendMessengerChatHistory(input.userKey, "assistant", responseText);
    return {
      text: responseText,
      source: "responses",
    };
  } catch (error) {
    safeLog("messenger_chat_fallback", {
      user: toLogUser(input.userKey),
      reason: toErrorCode(error),
    });
    return { text: fallbackText, source: "fallback" };
  }
}
