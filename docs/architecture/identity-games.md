# Leaderbot Foundation Plan for Mini Identity Games

## Status
This document defines the required foundation BEFORE any identity game implementation.

This document is normative.
Implementations must follow this design unless explicitly revised.

No game logic should be built until:
- EntryIntent is implemented
- ActiveExperience routing is in place
- outbound intents are extended
- isolated experience state is supported

Premature building is explicitly out of scope.

This is the foundation.

We are not building a game yet.
We first build:
- EntryIntent normalization
- ActiveExperience ownership
- routing priority
- richer outbound intents
- isolated experience state

Everything must align to this.
No shortcuts through the existing style flow.

## Summary
Before building any game flow, first introduce a clean experience foundation that separates channel ingress from shared orchestration. The immediate goal is not game logic yet, but a stable substrate for direct deep-linked experience starts, isolated experience state, and option/result-driven responses that work across Messenger and WhatsApp without leaking channel quirks into shared code.

The key rule for this phase is: absorb Messenger/WhatsApp differences at the normalization boundary, then let shared logic work only with normalized `EntryIntent`, `ActiveExperience`, and richer outbound intents.

## Core Changes

### 1. EntryIntent normalization
Create a normalized ingress contract produced by channel-specific parsers and consumed everywhere else.

Recommended shape:
- `sourceChannel`
- `sourceType`
- `targetExperienceType`
- `targetExperienceId`
- `entryMode?` with allowed values `auto_start | confirm_first`
- `campaignId?`
- `creativeId?`
- `entryVariant?`
- `localeHint?`
- `rawRef?`
- `receivedAt`

Rules:
- Messenger referral/deep-link parsing must terminate in `EntryIntent`.
- Future WhatsApp entry-link parsing must terminate in the same contract.
- Shared logic must never inspect raw Messenger referral payloads or WhatsApp-specific link params.
- `entryMode` controls UX at the routing layer, not in channel handlers.

### 2. ActiveExperience ownership
Introduce a single top-level ownership model for the thread.

Recommended shape:
- `type`
- `id`
- `sessionId`
- `status`
- `startedAt`
- `updatedAt`

Allowed `status` values:
- `started`
- `in_progress`
- `resolving`
- `completed`
- `abandoned`
- `failed`

Rules:
- Only one `ActiveExperience` owns the conversation at a time.
- Shared routing first checks explicit `EntryIntent`, then active experience resume, then generic flow.
- Existing flat flow stage may remain temporarily for current style flow, but games must not reuse it.

### 3. Routing priority
Formalize a shared router with this exact priority order.

This routing order is mandatory and must not be altered:
1. `EntryIntent`
2. `ActiveExperience`
3. explicit command
4. fallback flow

Rules:
- A deep-linked game start must bypass generic onboarding when `entryMode=auto_start`.
- A deep-linked experience may show a lightweight confirm step when `entryMode=confirm_first`.
- Shared routing must make this decision before channel-specific UX rendering.
- No webhook handler should contain game-specific routing branches.

### 4. Richer outbound intents
Extend the outbound contract so shared logic can express option/result-driven experiences.

Recommended intent families:
- `text`
- `options_prompt`
- `result_card`
- `image`
- `error`
- `ack`
- `typing`
- `handoff_state`

Recommended `options_prompt` fields:
- `prompt`
- `options[]`
- `selectionMode`
- `fallbackText?`

Recommended `result_card` fields:
- `title`
- `subtitle?`
- `body`
- `imageUrl?`
- `ctaOptions[]`
- `shareText?`

Recommended `error` intent use:
- image generation failure
- invalid state transitions
- recovery prompts
- unsupported or inconsistent experience state

Rules:
- Shared logic emits abstract intents only.
- Messenger and WhatsApp adapters render them according to channel limits.
- No shared module may depend on quick replies, lists, or template-specific transport details.

### 5. Isolated experience state
Create separate experience storage for future identity games instead of extending the flat style-state.

Recommended split:
- conversation-level state
  - `lastEntryIntent`
  - `activeExperience`
  - existing style/photo state
- experience-level state
  - `identityGameSession`

Recommended game session fields:
- `sessionId`
- `gameId`
- `gameVersion`
- `entryIntent`
- `status`
- `currentQuestionId`
- `answers`
- `derivedTraits`
- `resultRef`
- `startedAt`
- `updatedAt`
- `expiresAt`

Retrieval requirements:
- game session must be retrievable by `userId`
- game session must be retrievable by `sessionId`
- game session must be retrievable via `activeExperience` reference

Rules:
- Game session must live under its own namespace or scoped storage key.
- No game data in `selectedStyle`, `stage`, `preselectedStyle`, or related style-flow fields.
- Shared state APIs should support experience-specific reads/writes without channel assumptions.

## Normalization Boundary

### Inbound
Refactor channel ingress so both channels produce a normalized inbound envelope containing:
- `message`
- `entryIntent?`
- `userIdentity`
- `channelCapabilities`
- `rawEventMeta`

Messenger-only concerns stay here:
- referral payload parsing
- postback normalization
- quick reply payload extraction

WhatsApp-only concerns stay here:
- interactive reply normalization
- future click-to-WhatsApp entry parsing
- numeric/text fallback mapping metadata

Hard rule:
Shared logic MUST NOT:
- inspect raw Messenger payloads
- inspect WhatsApp-specific structures
- branch on channel-specific fields

### Outbound
Shared orchestration returns normalized outbound intents only. Channel adapters own:
- rendering constraints
- button/list limits
- text fallback formatting
- transport-specific send details

This boundary is the seam that keeps Messenger/WhatsApp differences out of shared logic.

## Implementation Sequence
1. Introduce `EntryIntent` and channel-level parsers.
2. Introduce `ActiveExperience` and mandatory routing priority.
3. Introduce richer outbound intent contracts plus Messenger/WhatsApp adapters.
4. Introduce isolated experience session storage with the required retrieval paths.
5. Move existing deep-link/referral handling to the normalization boundary.
6. Add tests proving shared logic no longer depends on raw channel payload shape.
7. Only after this foundation is stable, start the first identity game implementation.

## Test Plan
- Messenger deep link normalizes into `EntryIntent` without shared code touching raw referral fields.
- `entryMode=auto_start` starts the targeted experience immediately.
- `entryMode=confirm_first` inserts a confirm step without bypassing the router.
- Shared router always follows the mandatory priority order.
- Active experience resume works without channel-specific routing branches.
- The same `options_prompt` renders correctly on Messenger and WhatsApp.
- `error` intents render predictably across both channels.
- Existing style/photo flow still works while game session storage stays isolated.
- Attribution metadata remains structured and stable from ingress to stored session.
- Game sessions can be loaded by `userId`, `sessionId`, and `activeExperience` reference.

## Assumptions
- This phase is foundation-only.
- No game logic should be implemented during this phase.
- Messenger is the first live entry surface, but the contracts must already fit WhatsApp later.
- Existing style flow may temporarily keep its current flat stage model, but the new foundation must not depend on it.
