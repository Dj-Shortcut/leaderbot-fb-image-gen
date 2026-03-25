# Identity AI V1

## Summary
`Identity AI V1` is the first playable identity game for Leaderbot.

This document defines the game content and player flow for this one experience.

It does not redefine shared infrastructure such as:
- `EntryIntent`
- `ActiveExperience`
- routing priority
- session storage architecture
- channel normalization rules

Those remain defined by [`docs/architecture/identity-games.md`](/Users/Gebruiker/Desktop/projecten/leaderbot-fb-image-gen/docs/architecture/identity-games.md).

## Core Concept
The user answers 3 short questions and is classified into 1 of 4 AI archetypes:
- `Builder`
- `Visionary`
- `Analyst`
- `Operator`

V1 is designed to feel fast, clear, and instantly reveal-oriented.

## Hard Constraints
- Max 3 questions
- No free-text interpretation
- No scoring system
- No branching narrative
- No persistent personality profile outside the current session
- No blocking completion on image generation
- No second game or reusable quiz framework in V1
- Must complete in under 60 seconds

## Entry Behavior
- Default entry mode is `auto_start`
- A deep link into `identity-ai-v1` should immediately send question 1
- The user should not land in a generic menu first

## Resume Rule
Resume an existing session only if it is:
- for the same `gameId`
- still active
- not expired

Otherwise:
- create a new session
- replace `ActiveExperience`

## Question Flow
- Exactly 3 questions
- Exactly 4 answer options per question
- One question at a time
- Only single-choice input
- No open text path in V1
- Invalid input re-prompts the same question

## Archetypes
### Builder
Execution-first, practical, and momentum-driven.

### Visionary
Imaginative, future-facing, and idea-led.

### Analyst
Precise, pattern-driven, and skeptical.

### Operator
Calm, structured, and systems-minded.

## Questions
### Question 1
`When a new AI tool drops, what do you do first?`

Answers:
- `q1_build` — `Open it and start making something`
- `q1_vision` — `Imagine what it could become`
- `q1_analyst` — `Figure out how it actually works`
- `q1_operate` — `See where it fits in a system`

### Question 2
`What kind of result feels most satisfying to you?`

Answers:
- `q2_build` — `A finished thing I can use now`
- `q2_vision` — `A bold idea no one saw coming`
- `q2_analyst` — `A clean answer that makes sense`
- `q2_operate` — `A process that runs smoothly`

### Question 3
`What role do you naturally take in a smart team?`

Answers:
- `q3_build` — `The maker`
- `q3_vision` — `The spark`
- `q3_analyst` — `The decoder`
- `q3_operate` — `The coordinator`

## Resolution Model
V1 uses a deterministic answer-combination lookup.

Input:
- exactly 3 stored answer ids

Output:
- exactly 1 archetype

Rules:
- no score fields
- no trait aggregation
- no tie-break logic
- every valid 3-answer combination must resolve

Recommended mapping rule for V1:
- if 2 or 3 answers point to the same archetype family, resolve to that archetype
- if all 3 answers point to different families, resolve using a fixed lookup table defined in implementation

For implementation safety, the resolver must still use an explicit deterministic table or equivalent fixed mapping so every valid answer triple resolves to exactly one archetype.

## Result Flow
The final result contains:
- archetype title
- one short identity line
- one short explanation line
- one AI-generated image when available
- one replay CTA

If image generation fails:
- return the text result anyway
- do not block completion

## Result Copy Shape
### Title
`You are: {Archetype}`

### Identity line
One short sentence that frames the archetype as the user's dominant AI instinct.

### Explanation line
One short sentence that explains why the selected answers map to this archetype.

### Replay CTA
A single short CTA that invites the user to try again.

## AI Image Direction
The generated image should visualize the resolved archetype, not the full answer history.

Prompt input should include:
- archetype id
- archetype visual descriptor
- one fixed V1 visual style

V1 should use one shared visual prompt style for all four archetypes so the results feel like the same product family.

## Test Cases
- deep link starts question 1 immediately
- same-game active non-expired session resumes
- different-game session never resumes
- expired session never resumes
- inactive or completed session never resumes
- each answer advances exactly one step
- invalid input repeats the same question
- third answer resolves exactly one archetype
- all valid answer triples resolve deterministically
- text result still completes when image generation fails
- `ActiveExperience` is cleared after completion

## Assumptions
- This document is the single source of truth for `Identity AI V1` content and flow
- Shared identity-game infrastructure remains defined in [`docs/architecture/identity-games.md`](/Users/Gebruiker/Desktop/projecten/leaderbot-fb-image-gen/docs/architecture/identity-games.md)
- V1 is Messenger-first, but the game flow should remain channel-agnostic where possible
