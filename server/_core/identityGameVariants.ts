import type { Express, Request, Response } from "express";
import { z } from "zod";

export const IDENTITY_GAME_CANONICAL_DOMAIN = "leaderbot.live";
const DEFAULT_SHARE_TITLE = "Discover your AI archetype";
const DEFAULT_SHARE_DESCRIPTION =
  "Answer 3 quick questions and reveal your AI identity.";
const DEFAULT_SHARE_IMAGE_URL =
  "https://leaderbot.live/og/identity-games-default.jpg";

const shareSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  imageUrl: z.string().url(),
});

const variantSchema = z.object({
  variantId: z.string().trim().min(1),
  status: z.enum(["draft", "qa", "active"]),
  version: z.string().trim().min(1),
  entryRefs: z.array(z.string().trim().min(1)).min(1),
  share: shareSchema.optional(),
});

export type GameVariantDefinition = z.infer<typeof variantSchema>;

export const GAME_VARIANTS: readonly GameVariantDefinition[] = [
  {
    variantId: "identity-ai-v1",
    status: "active",
    version: "v1",
    entryRefs: ["identity-ai-v1", "game:identity-ai-v1"],
    share: {
      title: "Which AI are you?",
      description: "Play a 3-question reveal and meet your AI archetype.",
      imageUrl: "https://leaderbot.live/og/identity-ai-v1.jpg",
    },
  },
];

function normalizeVariantId(value: string): string {
  return value.trim().toLowerCase();
}

function isLikelyPublicImageUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  if (!parsed.hostname || parsed.hostname === "localhost") {
    return false;
  }

  if (parsed.searchParams.size === 0) {
    return true;
  }

  const blockedParamHints = ["signature", "sig", "token", "expires", "x-amz-"];
  for (const key of parsed.searchParams.keys()) {
    const lower = key.toLowerCase();
    if (blockedParamHints.some(hint => lower.includes(hint))) {
      return false;
    }
  }

  return true;
}

export function assertIdentityGameVariantCatalog(
  variants: readonly GameVariantDefinition[] = GAME_VARIANTS
): void {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const rawVariant of variants) {
    const parsed = variantSchema.safeParse(rawVariant);
    if (!parsed.success) {
      errors.push(
        `Invalid variant definition: ${parsed.error.issues
          .map(issue => issue.path.join("."))
          .join(", ")}`
      );
      continue;
    }

    const variant = parsed.data;
    const normalizedId = normalizeVariantId(variant.variantId);
    if (seenIds.has(normalizedId)) {
      errors.push(`Duplicate variantId: ${variant.variantId}`);
    }
    seenIds.add(normalizedId);

    if (variant.status === "active") {
      if (!variant.share) {
        errors.push(
          `Active variant ${variant.variantId} must define share metadata`
        );
      } else if (!isLikelyPublicImageUrl(variant.share.imageUrl)) {
        errors.push(
          `Active variant ${variant.variantId} has non-public or non-cache-safe share.imageUrl`
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Identity game variant catalog validation failed: ${errors.join("; ")}`);
  }
}

export function getVariantById(
  variantId: string,
  variants: readonly GameVariantDefinition[] = GAME_VARIANTS
): GameVariantDefinition | null {
  const normalized = normalizeVariantId(variantId);
  return (
    variants.find(variant => normalizeVariantId(variant.variantId) === normalized) ??
    null
  );
}

function buildMessengerEntryUrl(pageId: string, variantId: string): string {
  const ref = encodeURIComponent(normalizeVariantId(variantId));
  return `https://m.me/${pageId}?ref=${ref}`;
}

function resolveShareMeta(variant: GameVariantDefinition): {
  title: string;
  description: string;
  imageUrl: string;
} {
  return {
    title: variant.share?.title ?? DEFAULT_SHARE_TITLE,
    description: variant.share?.description ?? DEFAULT_SHARE_DESCRIPTION,
    imageUrl: variant.share?.imageUrl ?? DEFAULT_SHARE_IMAGE_URL,
  };
}

function renderSharePageHtml(input: {
  canonicalUrl: string;
  messengerUrl: string;
  title: string;
  description: string;
  imageUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${input.title}</title>
    <link rel="canonical" href="${input.canonicalUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${input.canonicalUrl}" />
    <meta property="og:title" content="${input.title}" />
    <meta property="og:description" content="${input.description}" />
    <meta property="og:image" content="${input.imageUrl}" />
    <meta http-equiv="refresh" content="0;url=${input.messengerUrl}" />
    <script>window.location.replace(${JSON.stringify(input.messengerUrl)});</script>
  </head>
  <body>
    <p>Redirecting to Messenger...</p>
    <p><a href="${input.messengerUrl}">Continue</a></p>
  </body>
</html>`;
}

function getRequestHost(req: Request): string {
  return req.hostname.trim().toLowerCase();
}

function isProductionEnv(inputNodeEnv?: string): boolean {
  return (inputNodeEnv ?? process.env.NODE_ENV) === "production";
}

function resolvePageId(overridePageId?: string): string {
  const pageId = (overridePageId ?? process.env.MESSENGER_PAGE_ID ?? "").trim();
  return pageId;
}

type RegisterShareRoutesOptions = {
  variants?: readonly GameVariantDefinition[];
  canonicalDomain?: string;
  pageId?: string;
  nodeEnv?: string;
};

export function registerIdentityGameShareRoutes(
  app: Express,
  options: RegisterShareRoutesOptions = {}
): void {
  const variants = options.variants ?? GAME_VARIANTS;
  const canonicalDomain =
    (options.canonicalDomain ?? IDENTITY_GAME_CANONICAL_DOMAIN).toLowerCase();
  const pageId = resolvePageId(options.pageId);

  app.get("/play/:variantId", (req: Request, res: Response) => {
    const variantId = normalizeVariantId(req.params.variantId ?? "");
    const variant = getVariantById(variantId, variants);
    if (!variant) {
      res.status(404).type("text/plain").send("Variant not found");
      return;
    }

    const canonicalUrl = `https://${canonicalDomain}/play/${variantId}`;
    const currentHost = getRequestHost(req);
    if (
      isProductionEnv(options.nodeEnv) &&
      variant.status === "active" &&
      currentHost !== canonicalDomain
    ) {
      res.redirect(308, canonicalUrl);
      return;
    }

    if (!pageId) {
      res.status(503).type("text/plain").send("Messenger page id not configured");
      return;
    }

    const messengerUrl = buildMessengerEntryUrl(pageId, variantId);
    const shareMeta = resolveShareMeta(variant);

    res
      .status(200)
      .setHeader("Cache-Control", "public, max-age=300")
      .type("text/html; charset=utf-8")
      .send(
        renderSharePageHtml({
          canonicalUrl,
          messengerUrl,
          title: shareMeta.title,
          description: shareMeta.description,
          imageUrl: shareMeta.imageUrl,
        })
      );
  });
}
