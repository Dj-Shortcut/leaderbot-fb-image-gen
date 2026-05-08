import type { DownloadedSourceImage } from "../sourceImageFetcher";

type ResponsesApiPayload = {
  model: string;
  input: Array<{
    role: "system" | "user";
    content:
      | string
      | Array<
          | { type: "input_text"; text: string }
          | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" }
        >;
  }>;
  temperature: number;
  max_output_tokens: number;
};

const RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_ANALYSIS_LENGTH = 700;

function getModel(): string {
  return process.env.OPENAI_DIRECTOR_ANALYSIS_MODEL?.trim() || DEFAULT_MODEL;
}

function getTimeoutMs(): number {
  const configured = Number(process.env.OPENAI_DIRECTOR_ANALYSIS_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }

  return DEFAULT_TIMEOUT_MS;
}

function sanitizeAnalysis(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_ANALYSIS_LENGTH);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function trimmedText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textProperty(value: unknown, key: string): string | null {
  return trimmedText(objectValue(value)?.[key]);
}

function extractContentText(item: unknown): string | null {
  const content = objectValue(item)?.content;
  if (!Array.isArray(content)) {
    return null;
  }

  for (const part of content) {
    const text = textProperty(part, "text");
    if (text) {
      return text;
    }
  }

  return null;
}

function extractOutputItemText(item: unknown): string | null {
  return textProperty(item, "text") ?? extractContentText(item);
}

function extractOutputText(raw: unknown): string | null {
  const output = objectValue(raw)?.output;
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    const text = extractOutputItemText(item);
    if (text) {
      return text;
    }
  }

  return null;
}

function extractResponseText(raw: unknown): string | null {
  return textProperty(raw, "output_text") ?? extractOutputText(raw);
}

function toDataUrl(sourceImage: DownloadedSourceImage): string {
  return `data:${sourceImage.contentType};base64,${sourceImage.buffer.toString("base64")}`;
}

function buildAnalysisPayload(sourceImage: DownloadedSourceImage): ResponsesApiPayload {
  return {
    model: getModel(),
    input: [
      {
        role: "system",
        content: [
          "You are a photo analysis assistant for an AI creative director.",
          "Describe only visual facts and useful transformation guidance.",
          "Do not identify the person, infer sensitive traits, or make demographic guesses beyond visible styling and apparent pose.",
          "Return concise plain text with notes about subject, pose, lighting, background, framing, image quality, and improvement opportunities.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Analyze this uploaded photo for a social-ready creative restyle. Keep it concise and practical.",
          },
          {
            type: "input_image",
            image_url: toDataUrl(sourceImage),
            detail: "low",
          },
        ],
      },
    ],
    temperature: 0,
    max_output_tokens: 180,
  };
}

export async function analyzeDirectorPhoto(
  sourceImage: DownloadedSourceImage,
  reqId: string
): Promise<string | undefined> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch(RESPONSES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildAnalysisPayload(sourceImage)),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn("director_photo_analysis_failed", {
        reqId,
        status: response.status,
      });
      return undefined;
    }

    const responseText = extractResponseText(await response.json());
    return responseText ? sanitizeAnalysis(responseText) : undefined;
  } catch (error) {
    console.warn("director_photo_analysis_failed", {
      reqId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
