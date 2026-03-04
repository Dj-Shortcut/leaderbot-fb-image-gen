# Leaderbot AI Image Generator

A zero-friction Facebook Messenger bot that transforms user photos into AI-styled images.

## Architecture

The runtime is a single Node/Express process that handles Messenger webhook traffic, AI image generation orchestration, static asset serving, admin auth, and operational endpoints.

ASCII version:

```text
                         +----------------------+
                         |   Meta Messenger     |
                         |  Webhook + Send API  |
                         +----------+-----------+
                                    |
                                    v
                    +----------------------------------+
                    |  Leaderbot Server (Node/Express) |
                    |----------------------------------|
                    | Routes:                          |
                    | - /webhook/facebook              |
                    | - /api/trpc                      |
                    | - /auth/github/*                 |
                    | - /healthz, /__version          |
                    | - /generated/*, /demo/*         |
                    +----+---------------+-------------+
                         |               |
          inbound events |               | outbound API / auth / storage
                         v               v
        +--------------------------+   +----------------------+
        | Webhook Handlers         |   | Supporting Services  |
        | - signature verification |   | - GitHub OAuth       |
        | - dedupe + i18n          |   | - static file serve  |
        | - state transitions      |   | - health/debug       |
        | - quota checks           |   +----------------------+
        +------------+-------------+
                     |
                     v
        +--------------------------+
        | Image Service            |
        | - mock generator         |
        | - OpenAI generator       |
        +------------+-------------+
                     |
          +----------+----------+
          |                     |
          v                     v
        +-------------------+   +----------------------+
        | Redis / State     |   | OpenAI Images API    |
        | - state store     |   | - generation backend |
        | - rate limit base |   +----------------------+
        +-------------------+
```

Mermaid version:

```mermaid
flowchart TD
    MM["Meta Messenger<br/>Webhook + Send API"]
    UA["Admin / Browser / Monitoring"]

    subgraph LB["Leaderbot Server (Node/Express)"]
        WH["/webhook/facebook"]
        TRPC["/api/trpc"]
        AUTH["/auth/github/*"]
        OPS["/healthz, /__version, /generated/*, /demo/*"]
        HANDLERS["Webhook handlers<br/>signature check, dedupe, i18n,<br/>state transitions, quota checks"]
        IMG["Image service<br/>mock or OpenAI"]
    end

    REDIS[("Redis / state store")]
    OPENAI["OpenAI Images API"]
    GITHUB["GitHub OAuth"]

    MM --> WH
    WH --> HANDLERS
    HANDLERS --> IMG
    HANDLERS <--> REDIS
    IMG --> OPENAI
    IMG --> MM

    UA --> TRPC
    UA --> AUTH
    UA --> OPS
    AUTH --> GITHUB
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
- `REDIS_URL` (required in production for webhook replay protection)
- `APP_BASE_URL` (required in OpenAI mode for public generated image URLs)
- `OPENAI_API_KEY` (required in OpenAI mode)

### Common optional

- `REDIS_URL` (enable Redis state store; required in production)
- `WEBHOOK_REPLAY_TTL_SECONDS` (override webhook replay-protection TTL, default `300`)
- `DEFAULT_MESSENGER_LANG` (`nl`/`en` fallback behavior)
- `PRIVACY_POLICY_URL` (link sent in privacy quick reply)
- `ADMIN_TOKEN` (protects `/debug/build`)
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` (enable GitHub admin login)
- `ADMIN_GITHUB_USERS` (comma-separated GitHub usernames allowed into `/admin`)
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

## Admin login (GitHub OAuth)

The same server can protect `/admin` using GitHub OAuth and a simple allowlist.

Required environment variables for admin login:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_CALLBACK_URL` (example: `https://<app>/auth/github/callback`)
- `ADMIN_GITHUB_USERS` (comma-separated GitHub usernames, example: `Dj-Shortcut`)
- `JWT_SECRET` (used to sign the `admin_session` cookie)

GitHub OAuth app setup:

1. Create a GitHub OAuth App.
2. Set the callback URL to the same value as `GITHUB_CALLBACK_URL`.
3. Configure the server env vars above.
4. Visit `/auth/github/start` or `/admin` to begin login.

Behavior:

- `/auth/github/start` redirects to GitHub with `read:user`.
- `/auth/github/callback` validates the CSRF state cookie, fetches the GitHub user, and only allows usernames from `ADMIN_GITHUB_USERS`.
- Successful logins receive an `admin_session` JWT cookie valid for 7 days.
- `POST /auth/logout` clears the admin session.

## Deployment notes

This app is configured for Fly.io using `Dockerfile` + `fly.toml`.

Typical deployment flow:

```bash
fly secrets set REDIS_URL=redis://<user>:<password>@<host>:<port> -a <app-name>
fly secrets set KEY=value -a <app-name>
fly deploy -a <app-name>
fly logs -a <app-name>
```

Operational notes:

- `NODE_ENV=production` and `PORT=8080` are expected in runtime.
- `REDIS_URL` must be set in Fly secrets before deploy; production startup now fails without it.
- Health check endpoint is `/healthz`.
- `APP_BASE_URL` must be publicly reachable in OpenAI mode so Messenger can fetch generated images from `/generated/<id>.png`.
- Keep `FB_APP_SECRET` configured to enforce webhook signature verification middleware.
