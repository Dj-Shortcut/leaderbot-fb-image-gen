# Identity Games Release Checklist

## Purpose
Required checklist before promoting a variant to `active`.

## Required Checks (V1)
- [ ] Structure validation passed (3 questions, 4 options each, 4 archetypes).
- [ ] Deterministic `resolutionMap` is complete for all valid answer triples.
- [ ] Share metadata is complete: `share.title`, `share.description`, `share.imageUrl`.
- [ ] Canonical production URL resolves on `https://leaderbot.live/play/{variantId}`.
- [ ] Canonical URL redirects to Messenger entry with correct `ref` contract:
- [ ] Identity variants (`variantId` starts with `identity-`, matching `variantId.startsWith("identity-")`) use direct identity ref: `ref={variantId}`.
- [ ] Non-identity variants use namespaced ref: `ref=game:{variantId}` (URL-encoded in transport).
- [ ] `MESSENGER_PAGE_ID` is configured in each environment that serves share redirects.
- [ ] `MESSENGER_PAGE_ID` is numeric and uses valid Facebook page id format.

## Content Quality Gate
- [ ] Content Quality Gate passed.
- [ ] Variant Intent defined and reviewed.

## Visual Variations (V2 Readiness)
- [ ] Each archetype defines visual variants (recommended: 8-16).
- [ ] Deterministic mapping is stable across deployments.
- [ ] Variant selection uses no runtime randomness.
- [ ] Micro-copy aligns with archetype (no contradiction, no tone drift).
- [ ] Variants are perceptibly distinct (no near-duplicates).

## Mandatory OG Preview Refresh
- [ ] Run Facebook Sharing Debugger after updates to share title, description, or image.
- [ ] Force re-scrape on the canonical URL.
- [ ] Verify updated `og:title`, `og:description`, and `og:image`.

## Launch Record
- [ ] Variant id
- [ ] Canonical share URL
- [ ] Messenger page id
- [ ] Facebook Debugger refresh timestamp (ISO 8601, e.g. `2026-03-26T15:04:05Z`)
- [ ] Reviewer/owner sign-off
