# Leaderbot AI Image Generator

A zero-friction Facebook Messenger bot that transforms user photos into AI-styled images.

## Architecture

The runtime is a single Node/Express process that exposes both the Messenger webhook and the public/static endpoints.

```text
Facebook Messenger
  -> GET/POST /webhook/facebook (verification + inbound events)
  -> webhookHandlers (state transitions, dedupe, language handling)
  -> imageService (mock/openai generator)
  -> Messenger send API (text, quick replies, generated image)

Browser/Admin/Monitoring
  -> /healthz, /health, /__version, /debug/build
  -> /generated/* and /demo/* static assets
  -> /api/trpc and optional OAuth/chat routes
```

Key server entrypoint: `server/_core/index.ts`.
Webhook route registration: `server/_core/messengerWebhook.ts`.
Webhook orchestration: `server/_core/webhookHandlers.ts`.

For a deeper explanation, see [`docs/architecture.md`](docs/architecture.md).

## State model

Conversation state is modeled per Messenger user (`psid`) with a normalized shape in `MessengerUserState`.

Primary stages:

- `IDLE`
- `AWAITING_PHOTO`
- `AWAITING_STYLE`
- `PROCESSING`
- `RESULT_READY`
- `FAILURE`

State persistence model:

- Default: in-memory `Map` state store (fast local/dev fallback).
- Optional: Redis-backed state store when `REDIS_URL` is configured.
- A pseudonymous `userKey` is derived from `psid` (`HMAC-SHA256`) for privacy-safe correlation.

Relevant files:

- `server/_core/messengerState.ts`
- `server/_core/stateStore.ts`
- `server/_core/privacy.ts`
- `drizzle/schema.ts` (DB table definitions, including `messengerState`)

## Quota model

There are two quota layers in the codebase, each with a 1-image/day free limit:

1. **Messenger flow quota in state** (`server/_core/messengerQuota.ts`)
   - Stored with `quota.dayKey` + `quota.count` in the user conversation state.
   - Resets by UTC day key.

2. **Database-backed quota** (`dailyQuota` table, used by DB helpers)
   - Tracks per-user daily usage (`YYYY-MM-DD`, UTC).
   - Includes atomic reserve/release helpers for safer concurrent updates.

Related files:

- `server/_core/messengerQuota.ts`
- `server/db.ts`
- `drizzle/schema.ts`
- `drizzle/0001_big_the_phantom.sql`
- `drizzle/0002_fix_daily_quota_unique.sql`

## Env vars

### Required

- `PRIVACY_PEPPER` (required at startup, used for user-key hashing)
- `FB_VERIFY_TOKEN` (Webhook verification)
- `FB_PAGE_ACCESS_TOKEN` (Messenger send API)
- `FB_APP_SECRET` (Webhook signature validation)
- `APP_BASE_URL` (required in OpenAI mode for public generated image URLs)
- `OPENAI_API_KEY` (required in OpenAI mode)

### Common optional

- `REDIS_URL` (enable Redis state store)
- `DEFAULT_MESSENGER_LANG` (`nl`/`en` fallback behavior)
- `PRIVACY_POLICY_URL` (link sent in privacy quick reply)
- `ADMIN_TOKEN` (protects `/debug/build`)
- `OAUTH_SERVER_URL` (enables OAuth route initialization)
- `LOG_LEVEL`, `DEBUG_STATE_DUMP` (diagnostics)
- `GENERATOR_MODE=mock` (forces mock generator)
- `OPENAI_IMAGE_TIMEOUT_MS`, `FB_IMAGE_FETCH_TIMEOUT_MS` (timeouts)
- `PORT` (default `8080`)

Legacy/app-specific environment variables also exist for SDK and data API integrations in `server/_core/env.ts`.

## Local dev

```bash
pnpm install
pnpm dev
```

Server defaults to `http://localhost:8080`.

Useful checks while developing:

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/__version
```

Production build locally:

```bash
pnpm build
pnpm start
```

## Testing

Core test/lint/typecheck commands:

```bash
pnpm test
pnpm check
pnpm lint
pnpm lint:server
```

Database migration helpers:

```bash
pnpm db:push
```

The repository includes focused unit tests for webhook handling, state transitions, signature verification, and image generation behavior under mock/OpenAI configuration.

## Deployment notes

This app is configured for Fly.io using `Dockerfile` + `fly.toml`.

Typical deployment flow:

```bash
fly secrets set KEY=value -a <app-name>
fly deploy -a <app-name>
fly logs -a <app-name>
```

Operational notes:

- `NODE_ENV=production` and `PORT=8080` are expected in runtime.
- Health check endpoint is `/healthz`.
- `APP_BASE_URL` must be publicly reachable in OpenAI mode so Messenger can fetch generated images from `/generated/<id>.png`.
- Keep `FB_APP_SECRET` configured to enforce webhook signature verification middleware.
