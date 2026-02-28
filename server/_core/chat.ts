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
import { ENV } from "./env";
import { createPatchedFetch } from "./patchedFetch";

/**
 * Creates an OpenAI-compatible provider with patched fetch.
 */
function createLLMProvider() {
  const baseURL = ENV.forgeApiUrl.endsWith("/v1")
    ? ENV.forgeApiUrl
    : `${ENV.forgeApiUrl}/v1`;

  return createOpenAI({
    baseURL,
    apiKey: ENV.forgeApiKey,
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

function isModelMessage(value: unknown): value is ModelMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { role?: unknown; content?: unknown };
  return typeof candidate.role === "string" && "content" in candidate;
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
      (i === 0 || previous === "(" || (previous !== undefined && /[+\-*/%]/.test(previous)))
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
  const openai = createLLMProvider();

  app.post("/api/chat", (req, res) => {
    try {
      const requestBody: unknown = req.body;

      if (typeof requestBody !== "object" || requestBody === null) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      const messagesValue = (requestBody as { messages?: unknown }).messages;

      if (!Array.isArray(messagesValue)) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      if (!messagesValue.every(isModelMessage)) {
        res.status(400).json({ error: "messages must be valid model messages" });
        return;
      }

      const messages: ModelMessage[] = messagesValue;

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

export { tools };
