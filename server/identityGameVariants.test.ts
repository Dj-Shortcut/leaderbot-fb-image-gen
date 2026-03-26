import http from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import {
  assertIdentityGameVariantCatalog,
  registerIdentityGameShareRoutes,
  type GameVariantDefinition,
} from "./_core/identityGameVariants";

function createVariant(overrides: Partial<GameVariantDefinition> = {}): GameVariantDefinition {
  const base: GameVariantDefinition = {
    variantId: "identity-test-v1",
    status: "qa",
    version: "v1",
    entryRefs: ["identity-test-v1", "game:identity-test-v1"],
    questions: [
      {
        id: "q1",
        prompt: "Q1",
        options: [
          { id: "q1_builder", title: "A", archetypeId: "builder" },
          { id: "q1_visionary", title: "B", archetypeId: "visionary" },
          { id: "q1_analyst", title: "C", archetypeId: "analyst" },
          { id: "q1_operator", title: "D", archetypeId: "operator" },
        ],
      },
      {
        id: "q2",
        prompt: "Q2",
        options: [
          { id: "q2_builder", title: "A", archetypeId: "builder" },
          { id: "q2_visionary", title: "B", archetypeId: "visionary" },
          { id: "q2_analyst", title: "C", archetypeId: "analyst" },
          { id: "q2_operator", title: "D", archetypeId: "operator" },
        ],
      },
      {
        id: "q3",
        prompt: "Q3",
        options: [
          { id: "q3_builder", title: "A", archetypeId: "builder" },
          { id: "q3_visionary", title: "B", archetypeId: "visionary" },
          { id: "q3_analyst", title: "C", archetypeId: "analyst" },
          { id: "q3_operator", title: "D", archetypeId: "operator" },
        ],
      },
    ],
    archetypes: [
      {
        id: "builder",
        title: "Builder",
        identityLine: "Builder identity",
        explanationLine: "Builder explanation",
      },
      {
        id: "visionary",
        title: "Visionary",
        identityLine: "Visionary identity",
        explanationLine: "Visionary explanation",
      },
      {
        id: "analyst",
        title: "Analyst",
        identityLine: "Analyst identity",
        explanationLine: "Analyst explanation",
      },
      {
        id: "operator",
        title: "Operator",
        identityLine: "Operator identity",
        explanationLine: "Operator explanation",
      },
    ],
    resolutionMap: {},
    copy: {
      intro: "intro",
      invalid: "invalid",
      replay: "replay",
    },
    imagePrompt: {
      styleKey: "style",
      variantDescriptor: "descriptor",
    },
  };

  const withMap: GameVariantDefinition = {
    ...base,
    resolutionMap: {
      ...base.resolutionMap,
      ...Object.fromEntries(
        base.questions[0].options.flatMap(option1 =>
          base.questions[1].options.flatMap(option2 =>
            base.questions[2].options.map(option3 => [
              `${option1.id}|${option2.id}|${option3.id}`,
              option1.archetypeId,
            ])
          )
        )
      ),
    },
  };

  return {
    ...withMap,
    ...overrides,
  };
}

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
  it("fails fast when messenger page id is missing", () => {
    const app = express();
    expect(() =>
      registerIdentityGameShareRoutes(app, { pageId: "   ", nodeEnv: "development" })
    ).toThrow("MESSENGER_PAGE_ID is required");
  });

  it("rejects active variants with missing share metadata", () => {
    const variants: GameVariantDefinition[] = [
      createVariant({
        variantId: "identity-broken",
        status: "active",
        entryRefs: ["identity-broken"],
        share: undefined,
      }),
    ];

    expect(() => assertIdentityGameVariantCatalog(variants)).toThrow(
      "must define share metadata"
    );
  });

  it("allows active share image urls with benign query params", () => {
    const variants: GameVariantDefinition[] = [
      createVariant({
        variantId: "identity-benign-query",
        status: "active",
        entryRefs: ["identity-benign-query"],
        share: {
          title: "Test",
          description: "Test",
          imageUrl: "https://leaderbot.live/og/identity-benign.jpg?v=2",
        },
      }),
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
    const qaVariant: GameVariantDefinition = createVariant({
      variantId: "identity-qa-flow",
      status: "qa",
      entryRefs: ["identity-qa-flow"],
    });

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
      expect(response.headers.get("cache-control")).toBe("no-store");
      const html = await response.text();
      expect(html).toContain("Discover your AI archetype");
      expect(html).toContain("https://leaderbot.live/og/identity-games-default.jpg");
    } finally {
      await server.close();
    }
  });

  it("keeps public cache for active variants", async () => {
    const app = express();
    registerIdentityGameShareRoutes(app, { pageId: "61587343141159", nodeEnv: "development" });

    const server = await listen(app);
    try {
      const response = await fetch(`${server.baseUrl}/play/identity-ai-v1`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    } finally {
      await server.close();
    }
  });

  it("uses game: ref prefix for non-identity variants", async () => {
    const qaVariant: GameVariantDefinition = createVariant({
      variantId: "quiz-speed-v1",
      status: "qa",
      entryRefs: ["quiz-speed-v1", "game:quiz-speed-v1"],
    });

    const app = express();
    registerIdentityGameShareRoutes(app, {
      pageId: "61587343141159",
      nodeEnv: "development",
      variants: [qaVariant],
    });

    const server = await listen(app);
    try {
      const response = await fetch(`${server.baseUrl}/play/quiz-speed-v1`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("https://m.me/61587343141159?ref=game%3Aquiz-speed-v1");
    } finally {
      await server.close();
    }
  });

  it("escapes share metadata when rendering OG html", async () => {
    const variant: GameVariantDefinition = createVariant({
      variantId: "identity-escaped",
      status: "active",
      entryRefs: ["identity-escaped"],
      share: {
        title: 'Reveal <your> "AI" self',
        description: 'Fast & fun <cta>',
        imageUrl: "https://leaderbot.live/og/escaped.jpg?v=2",
      },
    });

    const app = express();
    registerIdentityGameShareRoutes(app, {
      pageId: "61587343141159",
      nodeEnv: "development",
      variants: [variant],
    });

    const server = await listen(app);
    try {
      const response = await fetch(`${server.baseUrl}/play/identity-escaped`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Reveal &lt;your&gt; &quot;AI&quot; self");
      expect(html).toContain("Fast &amp; fun &lt;cta&gt;");
      expect(html).toContain(
        'window.location.replace("https://m.me/61587343141159?ref=identity-escaped")'
      );
    } finally {
      await server.close();
    }
  });

  it("escapes inline redirect script content to prevent closing script injection", async () => {
    const variant: GameVariantDefinition = createVariant({
      variantId: "identity-script-safety",
      status: "active",
      entryRefs: ["identity-script-safety"],
      share: {
        title: "Safe",
        description: "Safe",
        imageUrl: "https://leaderbot.live/og/safe.png",
      },
    });

    const app = express();
    registerIdentityGameShareRoutes(app, {
      pageId: '61587343141159</script><script>alert("x")</script>',
      nodeEnv: "development",
      variants: [variant],
    });

    const server = await listen(app);
    try {
      const response = await fetch(`${server.baseUrl}/play/identity-script-safety`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("\\u003c/script\\u003e\\u003cscript\\u003ealert");
      expect(html).not.toContain(
        '<script>window.location.replace("https://m.me/61587343141159</script>'
      );
    } finally {
      await server.close();
    }
  });

  it("rejects variants with incomplete resolution maps", () => {
    const variant = createVariant({
      variantId: "identity-incomplete-map",
      resolutionMap: {
        "q1_builder|q2_builder|q3_builder": "builder",
      },
    });

    expect(() => assertIdentityGameVariantCatalog([variant])).toThrow(
      "missing resolutionMap key"
    );
  });

  it("rejects variants with duplicate archetype ids", () => {
    const duplicateArchetypesVariant = createVariant({
      variantId: "identity-duplicate-archetypes",
      archetypes: [
        {
          id: "builder",
          title: "Builder",
          identityLine: "Builder identity",
          explanationLine: "Builder explanation",
        },
        {
          id: "builder",
          title: "Builder clone",
          identityLine: "Builder clone identity",
          explanationLine: "Builder clone explanation",
        },
        {
          id: "analyst",
          title: "Analyst",
          identityLine: "Analyst identity",
          explanationLine: "Analyst explanation",
        },
        {
          id: "operator",
          title: "Operator",
          identityLine: "Operator identity",
          explanationLine: "Operator explanation",
        },
      ],
      resolutionMap: Object.fromEntries(
        Object.keys(createVariant().resolutionMap).map(key => [key, "builder"])
      ),
    });

    expect(() => assertIdentityGameVariantCatalog([duplicateArchetypesVariant])).toThrow(
      "duplicate archetype ids"
    );
  });

  it("rejects variants missing required archetype coverage", () => {
    const missingArchetypeVariant = createVariant({
      variantId: "identity-missing-visionary",
      archetypes: [
        {
          id: "builder",
          title: "Builder",
          identityLine: "Builder identity",
          explanationLine: "Builder explanation",
        },
        {
          id: "builder",
          title: "Builder duplicate",
          identityLine: "Builder duplicate identity",
          explanationLine: "Builder duplicate explanation",
        },
        {
          id: "analyst",
          title: "Analyst",
          identityLine: "Analyst identity",
          explanationLine: "Analyst explanation",
        },
        {
          id: "operator",
          title: "Operator",
          identityLine: "Operator identity",
          explanationLine: "Operator explanation",
        },
      ],
      resolutionMap: Object.fromEntries(
        Object.keys(createVariant().resolutionMap).map(key => [key, "builder"])
      ),
    });

    expect(() => assertIdentityGameVariantCatalog([missingArchetypeVariant])).toThrow(
      "missing archetypes: visionary"
    );
  });
});
