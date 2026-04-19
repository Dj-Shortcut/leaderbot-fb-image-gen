# Environment Shortlist

This is the operational env list for getting the bot working. Read this before the larger `.env.example` or README env inventory.

## 1. Messenger bot runtime

These variables are the first things to verify when the bot does not reply or Meta webhooks fail.

| Variable | Required for | Notes |
| --- | --- | --- |
| `FB_VERIFY_TOKEN` | Webhook verification | Must match the token configured in Meta. |
| `FB_PAGE_ACCESS_TOKEN` | Sending Messenger replies | If wrong or expired, outbound replies fail. |
| `FB_APP_SECRET` | Webhook signature verification | Required for signed webhook validation. |
| `MESSENGER_PAGE_ID` | Canonical `m.me` share links | Needed for share/invite flows. |
| `APP_BASE_URL` | Public links and generated image URLs | Must be `https://` in production. |
| `ENABLE_FACE_MEMORY` | Optional Messenger 30-day source-photo reuse | Keep `false` until legal approves consent, privacy, and deletion copy. |

## 2. OpenAI paths

These variables control whether the OpenAI-backed parts of the bot actually run.

| Variable | Required for | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | Image generation, Messenger responses, conversational edit interpretation | If missing, image generation and OpenAI text fall back or fail closed. |
| `MESSENGER_CHAT_ENGINE` | Messenger AI text replies | Set to `responses` to enable the OpenAI text path. `legacy` keeps the old fallback flow. |
| `MESSENGER_CHAT_CANARY_PERCENT` | Messenger AI text rollout | Use `100` for full enablement during verification. `0` means nobody uses the OpenAI text path. |
| `OPENAI_TEXT_MODEL` | Messenger AI text replies | Defaults to `gpt-4.1-mini`. Usually not the first thing to debug. |
| `SOURCE_IMAGE_ALLOWED_HOSTS` | Downloading inbound images before generation | If the exact host is not allowlisted, generation fails before OpenAI is called. |

## 3. Optional but easy to confuse

These show up in the repo and can be mistaken for the main OpenAI path.

| Variable | Used by | Notes |
| --- | --- | --- |
| `BUILT_IN_FORGE_API_URL` | Storage proxy, `/api/chat` | Not used by the main Messenger OpenAI text flow. |
| `BUILT_IN_FORGE_API_KEY` | Storage proxy, `/api/chat` | Separate from `OPENAI_API_KEY`. |
| `REDIS_URL` | Replay protection, rate limiting, state storage | Required in production for replay protection. |
| `ADMIN_TOKEN` | Debug/admin endpoints | Required for `/admin/disable-face-memory` and `/debug/build`. |

## 4. Fast triage

When the bot seems broken, check in this order:

1. `OPENAI_API_KEY`
2. `FB_PAGE_ACCESS_TOKEN`
3. `FB_APP_SECRET`
4. `APP_BASE_URL`
5. `MESSENGER_CHAT_ENGINE`
6. `MESSENGER_CHAT_CANARY_PERCENT`
7. `SOURCE_IMAGE_ALLOWED_HOSTS`

If face memory is involved, also check:

8. `ENABLE_FACE_MEMORY`
9. `ADMIN_TOKEN`
10. Storage proxy delete support: `DELETE /v1/storage/object`

## 5. Current local-dev gotchas

Based on the current local `.env` in this repo:

- `OPENAI_API_KEY` is blank, so OpenAI-backed paths are not actually configured.
- `MESSENGER_CHAT_ENGINE=legacy`, so Messenger text does not use the OpenAI response flow.
- `MESSENGER_CHAT_CANARY_PERCENT=0`, so even if the engine were switched, rollout is effectively off.
- `BUILT_IN_FORGE_API_URL` and `BUILT_IN_FORGE_API_KEY` are blank, so `/api/chat` stays disabled.
- `ENABLE_FACE_MEMORY=false`, so the old photo-upload -> style-picker flow remains active without consent prompts.

## 6. What to ignore at first

Do not start debugging with these unless you are working on those specific subsystems:

- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `ADMIN_GITHUB_USERS`
- `DATABASE_URL`, `OWNER_OPEN_ID`, `VITE_APP_ID`, `OAUTH_SERVER_URL`
- Fine-tuning knobs like retry counts, timeout overrides, quota bypass ids, and debug flags
