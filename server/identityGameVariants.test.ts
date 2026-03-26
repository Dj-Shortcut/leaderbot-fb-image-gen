import http from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import {
  assertIdentityGameVariantCatalog,
  registerIdentityGameShareRoutes,
  type GameVariantDefinition,
} from "./_core/identityGameVariants";

async function listen(app: express.Express) {
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to get test server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    requestWithHost: (path: string, host: string) =>
      new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
        (resolve, reject) => {
          const request = http.request(
            {
              hostname: "127.0.0.1",
              port: address.port,
              path,
              method: "GET",
              headers: { host },
            },
            response => {
              let body = "";
              response.setEncoding("utf8");
              response.on("data", chunk => {
                body += chunk;
              });
              response.on("end", () => {
                resolve({
                  status: response.statusCode ?? 0,
                  headers: response.headers,
                  body,
                });
              });
            }
          );
          request.on("error", reject);
          request.end();
        }
      ),
  };
}

describe("identity game variants catalog and share routes", () => {
  it("rejects active variants with missing share metadata", () => {
    const variants: GameVariantDefinition[] = [
      {
        variantId: "identity-broken",
        status: "active",
        version: "v1",
        entryRefs: ["identity-broken"],
      },
    ];

    expect(() => assertIdentityGameVariantCatalog(variants)).toThrow(
      "must define share metadata"
    );
  });

  it("allows active share image urls with benign query params", () => {
    const variants: GameVariantDefinition[] = [
      {
        variantId: "identity-benign-query",
        status: "active",
        version: "v1",
        entryRefs: ["identity-benign-query"],
        share: {
          title: "Test",
          description: "Test",
          imageUrl: "https://leaderbot.live/og/identity-benign.jpg?v=2",
        },
      },
    ];

    expect(() => assertIdentityGameVariantCatalog(variants)).not.toThrow();
  });

  it("serves OG tags and Messenger redirect for canonical share URLs", async () => {
    const app = express();
    registerIdentityGameShareRoutes(app, { pageId: "61587343141159", nodeEnv: "development" });

    const server = await listen(app);
    try {
      const response = await fetch(`${server.baseUrl}/play/identity-ai-v1`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('property="og:title"');
      expect(html).toContain('property="og:description"');
      expect(html).toContain('property="og:image"');
      expect(html).toContain("https://m.me/61587343141159?ref=identity-ai-v1");
    } finally {
      await server.close();
    }
  });

  it("redirects active variants to canonical leaderbot.live in production", async () => {
    const app = express();
    registerIdentityGameShareRoutes(app, { pageId: "61587343141159", nodeEnv: "production" });
    const server = await listen(app);

    try {
      const response = await server.requestWithHost(
        "/play/identity-ai-v1",
        "alt.example.com"
      );
      expect(response.status).toBe(308);
      expect(response.headers.location).toBe(
        "https://leaderbot.live/play/identity-ai-v1"
      );
    } finally {
      await server.close();
    }
  });

  it("uses global OG defaults when non-active variants do not define share metadata", async () => {
    const qaVariant: GameVariantDefinition = {
      variantId: "identity-qa-flow",
      status: "qa",
      version: "v1",
      entryRefs: ["identity-qa-flow"],
    };

    const app = express();
    registerIdentityGameShareRoutes(app, {
      pageId: "61587343141159",
      nodeEnv: "development",
      variants: [qaVariant],
    });

    const server = await listen(app);
    try {
      const response = await fetch(`${server.baseUrl}/play/identity-qa-flow`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Discover your AI archetype");
      expect(html).toContain("https://leaderbot.live/og/identity-games-default.jpg");
    } finally {
      await server.close();
    }
  });
});
