import type { Lang } from "./i18n";
import type { Style } from "./messengerStyles";

type ResponsesApiPayload = {
  model: string;
  input: Array<{ role: "system" | "user"; content: string }>;
  temperature: number;
  max_output_tokens: number;
};

export type ConversationalEditDecision = {
  shouldEdit: boolean;
  style?: Style;
  promptHint?: string;
};

const RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RETRIES = 1;
const MAX_INPUT_LENGTH = 240;

function getModel(): string {
  return (
    process.env.OPENAI_EDIT_INTERPRETER_MODEL?.trim() ||
    process.env.OPENAI_TEXT_MODEL?.trim() ||
    DEFAULT_MODEL
  );
}

function getTimeoutMs(): number {
  const configured = Number(process.env.OPENAI_EDIT_INTERPRETER_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }

  return DEFAULT_TIMEOUT_MS;
}

function getMaxRetries(): number {
  const configured = Number(process.env.OPENAI_EDIT_INTERPRETER_MAX_RETRIES);
  if (Number.isFinite(configured) && configured >= 0) {
    return Math.min(Math.floor(configured), 2);
  }

  return DEFAULT_MAX_RETRIES;
}

function sanitizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_INPUT_LENGTH);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function getRetryDelayMs(attempt: number): number {
  return 250 * 2 ** attempt;
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
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
  const timeoutMs = getTimeoutMs();
  const maxRetries = getMaxRetries();

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

        throw new Error(`edit_interpreter_http_${response.status}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("edit_interpreter_retry_exhausted");
}

function buildSystemPrompt(input: { lang: Lang; lastStyle?: Style }): string {
  const language = input.lang === "en" ? "English" : "Dutch";
  const lastStyle = input.lastStyle ?? "unknown";

  return [
    "You classify whether a user wants to edit the latest generated image.",
    `The user language is ${language}.`,
    `The last known style is ${lastStyle}.`,
    "Only return JSON with no markdown.",
    'Schema: {"shouldEdit":boolean,"style":"caricature"|"storybook-anime"|"gold"|"petals"|"clouds"|"cinematic"|"disco"|"cyberpunk"|"norman-blackwell"|null,"promptHint":string|null}.',
    "Set shouldEdit=true only when the user is asking to change the previous image.",
    "Use style only when the user explicitly asks for a known style or it is clearly implied.",
    'Treat "ghibli", "ghibli style", "studio ghibli", "storybook anime", and "whimsical anime" as requests for "storybook-anime".',
    "Put the visual change request into promptHint in concise plain text.",
    "If it is normal chat, a question, or unclear, return shouldEdit=false.",
  ].join(" ");
}

function parseDecision(rawText: string): ConversationalEditDecision | null {
  try {
    const parsed = JSON.parse(rawText) as {
      shouldEdit?: unknown;
      style?: unknown;
      promptHint?: unknown;
    };

    if (typeof parsed.shouldEdit !== "boolean") {
      return null;
    }

    const style =
      parsed.style === "caricature" ||
      parsed.style === "storybook-anime" ||
      parsed.style === "gold" ||
      parsed.style === "petals" ||
      parsed.style === "clouds" ||
      parsed.style === "cinematic" ||
      parsed.style === "disco" ||
      parsed.style === "cyberpunk" ||
      parsed.style === "norman-blackwell"
        ? parsed.style
        : undefined;

    const promptHint =
      typeof parsed.promptHint === "string" && parsed.promptHint.trim()
        ? sanitizeText(parsed.promptHint)
        : undefined;

    return {
      shouldEdit: parsed.shouldEdit,
      style,
      promptHint,
    };
  } catch {
    return null;
  }
}

export function looksLikePossibleEditRequest(text: string): boolean {
  const normalized = sanitizeText(text).toLowerCase();
  if (!normalized || normalized.startsWith("/")) {
    return false;
  }

  return [
    "make it",
    "make this",
    "edit",
    "more ",
    "less ",
    "whimsical",
    "darker",
    "lighter",
    "softer",
    "stronger",
    "ghibli",
    "storybook anime",
    "cinematic",
    "gold",
    "petals",
    "clouds",
    "disco",
    "cyberpunk",
    "norman blackwell",
    "caricature",
    "background",
    "remove",
    "add",
    "maak",
    "meer",
    "minder",
    "donker",
    "lichter",
    "zachter",
    "sterker",
  ].some(fragment => normalized.includes(fragment));
}

export async function interpretConversationalEdit(input: {
  text: string;
  lang: Lang;
  lastStyle?: Style;
}): Promise<ConversationalEditDecision | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const cleanText = sanitizeText(input.text);

  if (!apiKey || !cleanText || !looksLikePossibleEditRequest(cleanText)) {
    return null;
  }

  const payload: ResponsesApiPayload = {
    model: getModel(),
    input: [
      {
        role: "system",
        content: buildSystemPrompt(input),
      },
      {
        role: "user",
        content: cleanText,
      },
    ],
    temperature: 0,
    max_output_tokens: 120,
  };

  try {
    const rawResponse = await callResponsesApi(payload, apiKey);
    const responseText = extractResponseText(rawResponse);
    if (!responseText) {
      return null;
    }

    return parseDecision(responseText);
  } catch {
    return null;
  }
}
