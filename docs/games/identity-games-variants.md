# Identity Games Variant System

## Overview
Identity game variants MUST follow a fixed V1 model: exactly 3 questions, exactly 4 options per question, exactly 4 archetypes, and a deterministic resolution mapping.

Variants run through the Messenger-based flow and are distributed through the canonical share URL:
`https://leaderbot.live/play/{variantId}`.

## Variant Structure (V1)
- Each variant MUST define exactly 3 questions.
- Each question MUST define exactly 4 single-choice options.
- Each variant MUST define exactly 4 archetypes.
- `resolutionMap` MUST be deterministic and complete for all valid answer triples.

## Runtime Validation Rules (V1)
The following rules are hard validation requirements enforced by runtime checks.

- Option ids MUST use canonical structural format: alphanumeric plus `_` or `-` only.
- Option ids MUST NOT contain structural separators used by `resolutionMap` keys.
- Duplicate option ids within the same question are invalid.
- Archetype coverage MUST include all 4 V1 archetypes.
- Duplicate archetype ids are invalid.

## Variant Intent
Variant Intent is REQUIRED before creating a variant.

Each variant intent MUST define:
- target emotion (`curiosity`, `tension`, `validation`, or `ego`)
- differentiator versus existing variants
- reason a user would share the result

Variants without clear intent FAIL the Content Quality Gate.

## Content Quality Gate (Pre-Release)
The Content Quality Gate is normative and MUST be evaluated before promotion.

### Hook Quality
- Title MUST create curiosity or tension.
- Hook MUST feel reveal-oriented, not generic.

### Question Quality
- Questions MUST be short and intuitive.
- Questions MUST avoid abstract or academic phrasing.
- Answers MUST feel natural and fast to choose.

### Archetype Quality
- The 4 archetypes MUST be clearly distinct.
- Each archetype MUST present a recognizable vibe.
- Archetype labels SHOULD remain simple and memorable.

### Result Quality
- Result copy MUST feel personal and specific.
- Result copy MUST include a short, punchy description (1-2 lines).
- Result copy MUST avoid generic or vague language.

### Shareability Check
- Results MUST be evaluated for realistic share intent.
- Results SHOULD feel accurate, cool, or interesting enough to post.

Variants that do not pass all checks MUST NOT be promoted to `qa` or `active`.

## Variant V2: Visual Variations
This section defines planned V2 requirements and is forward-looking until V2 runtime support is implemented.

Each archetype SHOULD define `variants[]` for visual and micro-copy variation.

Each item in `variants[]` MUST include:
- `id`
- `imagePrompt`

Each item in `variants[]` MAY include:
- `title`
- `subtitle`

Rules:
- Each archetype SHOULD define 8-16 visual variants.
- Micro-copy MUST reinforce the archetype's core traits.
- Micro-copy MUST NOT contradict the archetype.
- Micro-copy MUST NOT drift in tone between variants of the same archetype.
- Variants within the same archetype MUST be perceptibly distinct.
- Near-duplicate image prompts or subtitles MUST be avoided.

## Deterministic Variant Selection
- Variant selection MUST be deterministic.
- Runtime randomness MUST NOT be used.
- Recommended selection strategy: `hash(answerTriple) % variants.length`.

## Deterministic Mapping Stability
- Deterministic mapping MUST be stable across deployments.
- Same answers plus the same variant catalog MUST produce the same result.
- Variant ordering MUST remain stable.
- Adding or removing variants can change mapping outcomes.
- Changes to `variants[]` MUST be treated as a versioned update.

## Deterministic Resolution Behavior (V1)
- Majority-family outcomes MUST resolve to the repeated archetype family.
- For all-different triples, resolution MUST deterministically use the first question's family.

Recommended:
- Use append-only updates where possible.
- Avoid reordering existing variants.
