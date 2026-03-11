import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("webhook handler module structure", () => {
  it("keeps a single createWebhookHandlers export", () => {
    const sourcePath = resolve(process.cwd(), "server/_core/webhookHandlers.ts");
    const source = readFileSync(sourcePath, "utf8");

    const exportMatches = source.match(/export function createWebhookHandlers\s*\(/g) ?? [];
    expect(exportMatches).toHaveLength(1);
  });
});
