/**
 * Chat API Handler
 *
 * Express endpoint for AI SDK streaming chat with tool calling support.
 * Uses patched fetch to fix OpenAI-compatible proxy issues.
 */

import { streamText, stepCountIs } from "ai";
import { tool } from "ai";
import type { ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Express } from "express";
import { z } from "zod/v4";
import { createPatchedFetch } from "./patchedFetch";

let hasLoggedChatDisabledOnStartup = false;

function getChatConfig() {
  const apiUrl = (process.env.BUILT_IN_FORGE_API_URL ?? "").trim();
  const apiKey = (process.env.BUILT_IN_FORGE_API_KEY ?? "").trim();

  return {
    apiUrl,
    apiKey,
  };
}

export function isChatConfigured(): boolean {
  const { apiUrl, apiKey } = getChatConfig();
  return apiUrl.length > 0 && apiKey.length > 0;
}

/**
 * Creates an OpenAI-compatible provider with patched fetch.
 */
function createLLMProvider() {
  const { apiUrl, apiKey } = getChatConfig();
  const baseURL = apiUrl.endsWith("/v1") ? apiUrl : `${apiUrl}/v1`;

  return createOpenAI({
    baseURL,
    apiKey,
    fetch: createPatchedFetch(fetch),
  });
}

/**
 * Example tool registry - customize these for your app.
 */
const tools = {
  getWeather: tool({
    description: "Get the current weather for a location",
    inputSchema: z.object({
      location: z
        .string()
        .describe("The city and country, e.g. 'Tokyo, Japan'"),
      unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius"),
    }),
    execute: ({ location, unit }) => {
      // Simulate weather API call
      const temp = Math.floor(Math.random() * 30) + 5;
      const conditions = ["sunny", "cloudy", "rainy", "partly cloudy"][
        Math.floor(Math.random() * 4)
      ];
      return {
        location,
        temperature: unit === "fahrenheit" ? Math.round(temp * 1.8 + 32) : temp,
        unit,
        conditions,
        humidity: Math.floor(Math.random() * 50) + 30,
      };
    },
  }),

  calculate: tool({
    description: "Perform a mathematical calculation",
    inputSchema: z.object({
      expression: z
        .string()
        .describe("The math expression to evaluate, e.g. '2 + 2'"),
    }),
    execute: ({ expression }) => {
      try {
        const result = evaluateMathExpression(expression);
        return { expression, result };
      } catch {
        return { expression, error: "Invalid expression" };
      }
    },
  }),
};

const modelMessageSchema = z
  .object({
    role: z.string().min(1),
    content: z.unknown(),
  })
  .passthrough();

const chatRequestSchema = z
  .object({
    messages: z.array(modelMessageSchema),
  })
  .passthrough();

function parseChatRequestBody(body: unknown): { messages: ModelMessage[] } {
  if (typeof body !== "object" || body === null) {
    throw new Error("messages array is required");
  }

  const parsed = chatRequestSchema.safeParse(body);

  if (!parsed.success) {
    const missingMessages = parsed.error.issues.some(
      issue =>
        issue.path.length === 1 &&
        issue.path[0] === "messages" &&
        (issue.code === "invalid_type" ||
          issue.code === "unrecognized_keys" ||
          issue.code === "custom")
    );

    const invalidMessages = parsed.error.issues.some(
      issue => issue.path[0] === "messages" && issue.path.length > 1
    );

    if (missingMessages && !invalidMessages) {
      throw new Error("messages array is required");
    }

    throw new Error("messages must be valid model messages");
  }

  return {
    messages: parsed.data.messages as ModelMessage[],
  };
}

function evaluateMathExpression(expression: string): number {
  const sanitized = expression.replace(/\s+/g, "");
  if (!/^[0-9+\-*/().%]+$/.test(sanitized)) {
    throw new Error("Invalid characters in expression");
  }

  const tokens = sanitized.match(/\d+(?:\.\d+)?|[()+\-*/%]/g);
  if (!tokens) {
    throw new Error("Empty expression");
  }

  const values: number[] = [];
  const operators: string[] = [];

  const precedence = (operator: string): number => {
    if (operator === "+" || operator === "-") {
      return 1;
    }

    if (operator === "*" || operator === "/" || operator === "%") {
      return 2;
    }

    return 0;
  };

  const applyOperator = () => {
    const operator = operators.pop();
    const right = values.pop();
    const left = values.pop();

    if (!operator || right === undefined || left === undefined) {
      throw new Error("Malformed expression");
    }

    switch (operator) {
      case "+":
        values.push(left + right);
        break;
      case "-":
        values.push(left - right);
        break;
      case "*":
        values.push(left * right);
        break;
      case "/":
        if (right === 0) {
          throw new Error("Division by zero");
        }
        values.push(left / right);
        break;
      case "%":
        if (right === 0) {
          throw new Error("Division by zero");
        }
        values.push(left % right);
        break;
      default:
        throw new Error("Unsupported operator");
    }
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const previous = i > 0 ? tokens[i - 1] : undefined;

    if (/^\d/.test(token)) {
      values.push(Number(token));
      continue;
    }

    if (token === "(") {
      operators.push(token);
      continue;
    }

    if (token === ")") {
      while (operators.at(-1) !== "(") {
        applyOperator();
      }
      operators.pop();
      continue;
    }

    if (
      token === "-" &&
      (i === 0 ||
        previous === "(" ||
        (previous !== undefined && /[+\-*/%]/.test(previous)))
    ) {
      values.push(0);
    }

    while (
      operators.length > 0 &&
      precedence(operators[operators.length - 1]) >= precedence(token)
    ) {
      applyOperator();
    }

    operators.push(token);
  }

  while (operators.length > 0) {
    if (operators[operators.length - 1] === "(") {
      throw new Error("Mismatched parentheses");
    }
    applyOperator();
  }

  const result = values[0];
  if (!Number.isFinite(result) || values.length !== 1) {
    throw new Error("Invalid expression result");
  }

  return result;
}

/**
 * Registers the /api/chat endpoint for streaming AI responses.
 *
 * @example
 * ```ts
 * // In server/_core/index.ts
 * import { registerChatRoutes } from "./chat";
 *
 * registerChatRoutes(app);
 * ```
 */
export function registerChatRoutes(app: Express) {
  if (!isChatConfigured()) {
    if (!hasLoggedChatDisabledOnStartup) {
      console.info(
        "[Chat] /api/chat disabled: missing BUILT_IN_FORGE_API_URL and/or BUILT_IN_FORGE_API_KEY"
      );
      hasLoggedChatDisabledOnStartup = true;
    }

    app.post("/api/chat", (_req, res) => {
      res.status(503).json({
        error:
          "Chat API is disabled: configure BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
      });
    });

    return;
  }

  const openai = createLLMProvider();

  app.post("/api/chat", (req, res) => {
    try {
      let messages: ModelMessage[];
      try {
        ({ messages } = parseChatRequestBody(req.body));
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
          return;
        }

        throw error;
      }

      const result = streamText({
        model: openai.chat("gpt-4o"),
        system:
          "You are a helpful assistant. You have access to tools for getting weather and doing calculations. Use them when appropriate.",
        messages,
        tools,
        stopWhen: stepCountIs(5),
      });

      result.pipeUIMessageStreamToResponse(res);
    } catch (error) {
      console.error("[/api/chat] Error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });
}

export { parseChatRequestBody, tools };
