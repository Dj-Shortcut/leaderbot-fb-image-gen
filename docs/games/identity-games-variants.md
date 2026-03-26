# Identity Games Variant System

## Summary
This document defines a lightweight, JSON-first way to create many Identity Game variants without adding per-variant runtime branches.

The goal is fast content iteration with deterministic behavior and clear release safety.

This document is product/game-system design, not shared infrastructure design.
Shared infrastructure remains defined in [`docs/architecture/identity-games.md`](../architecture/identity-games.md).

## Design Principles
- JSON-first authoring for variant content
- Deterministic resolution only (no scoring engine)
- Fixed V1 game shape for now: 3 questions, 4 options each, 4 archetypes
- Shared runtime flow, no per-variant webhook branching
- Draft -> QA -> Active release lifecycle

## GameVariantDefinition (V1 shape)
Each variant is a single definition object.

Required core fields:
- `variantId`
- `status` (`draft` | `qa` | `active`)
- `version`
- `entryRefs[]`
- `questions[3]` (each with exactly 4 single-choice options)
- `archetypes[4]`
- `resolutionMap` (deterministic answer triple -> archetype)
- `copy` (intro/invalid/replay strings)
- `imagePrompt` (global style key + variant descriptor)

Optional share fields:
- `share.title`
- `share.description`
- `share.imageUrl`

## Runtime Expectations
- `EntryIntent` resolves the target variant from deep-link ref aliases.
- A single shared flow handles all variants:
  - start or resume session
  - ask questions linearly
  - resolve one archetype deterministically
  - send text result first
  - send image best-effort
- No free-text interpretation in V1 variants.
- No branching narrative and no scoring model.

## Share & Distribution Layer
Canonical production domain:
- `leaderbot.live`

Each variant must support distribution through a canonical public share URL:
- `https://leaderbot.live/play/{variantId}`

Behavior:
- `https://leaderbot.live/play/{variantId}` serves social preview metadata and then redirects to Messenger entry:
  - `https://m.me/{PAGE_ID}?ref={variantId}`
- The Messenger link format stays unchanged.
- Preview customization is done on `/play/{variantId}`, not inside `m.me`.
- Bare `ref={variantId}` compatibility in shared parsing applies to identity game variant ids that normalize to an `identity-...` prefix.
- If a future variant id does not follow that prefix convention, use `ref=game:{variantId}` for explicit game entry.

Open Graph requirements for each variant share URL:
- `og:title` (variant-specific hook)
- `og:description` (short CTA-style copy)
- `og:image` (variant-specific invite image)

Share content constraints:
- Mobile-first
- High contrast
- Minimal text in image/copy
- Visuals must stay in one consistent family aligned with global style

Fallback behavior:
- If `share` metadata is missing on a non-active variant, use default global OG values.

Domain constraints:
- Public production share URLs must use `leaderbot.live`.
- Share URLs must be stable and must not change once a variant is `active`.
- QA/testing may use a separate non-production host or subdomain, but production must remain canonical on `leaderbot.live`.
- Active variants must not be distributed from alternative production domains.

## Validation Rules
General variant validation:
- Must satisfy fixed V1 shape (3x4x4)
- `resolutionMap` must resolve every valid answer triple to exactly one archetype
- Required copy and prompt fields must be present

Share validation:
- Active variants must have complete `share` metadata:
  - `share.title`
  - `share.description`
  - `share.imageUrl`
- `share.imageUrl` must be publicly reachable
- `share.imageUrl` must be cache-safe and stable (no short-lived signed URLs)

## Release & Operations Considerations
- Share URLs are stable identifiers and must not be reused across different variants.
- Social platforms cache OG previews per canonical URL. After share metadata or invite image updates, refresh previews manually via the Facebook Sharing Debugger before launch.
- `draft` variants are not public.
- `qa` variants are test-only and can use controlled refs.
- `active` variants are public and must pass full validation, including share metadata.

## Explicit Non-goals
- No per-variant preview customization inside Messenger (`m.me`)
- No runtime dynamic OG generation (static OG metadata per variant is enough for V1)
- No second runtime framework layer beyond this JSON-first variant model

## Execution Addendum (Ticket-Ready)
This addendum translates the design into enforceable release criteria.

Activation gates:
- A variant can move to `active` only if:
  - fixed V1 shape validation passes (3 questions, 4 options each, 4 archetypes)
  - deterministic resolution map is complete
  - share metadata is complete (`share.title`, `share.description`, `share.imageUrl`)
  - canonical production URL is valid on `https://leaderbot.live/play/{variantId}`
- Active variants must not launch from alternative production domains.

Distribution acceptance:
- The canonical share URL must expose `og:title`, `og:description`, and `og:image`.
- The canonical share URL must redirect to `https://m.me/{PAGE_ID}?ref={variantId}`.
- If share metadata is missing on non-active variants, global OG defaults are used.

Operations acceptance:
- After any OG text/image update, refresh preview cache via Facebook Sharing Debugger before launch.
- `share.imageUrl` must remain public, stable, and cache-safe.
- Canonical variant share URLs are immutable once the variant is active.

Suggested implementation tickets:
- Schema ticket: lock `share` fields in `GameVariantDefinition`.
- Validation ticket: block activation on incomplete share/domain requirements.
- Route ticket: implement `/play/{variantId}` as OG surface + Messenger redirect.
- Release ticket: add mandatory OG cache refresh step to launch checklist.
