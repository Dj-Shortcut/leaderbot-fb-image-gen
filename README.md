# leaderbot-fb-image-gen

## Package manager (pnpm)

This project uses **pnpm** via **Corepack** (not npm).

### Local development

```bash
corepack enable
pnpm install
pnpm dev
```

### Build

```bash
pnpm build
```

### If you accidentally ran `npm install`

- Delete `package-lock.json` (if it was created).
- Run pnpm commands again (`pnpm install`, then `pnpm dev` or `pnpm build`).

### Fly build note

Fly build runs with `pnpm --frozen-lockfile` and will fail if `pnpm-lock.yaml` is not in sync with `package.json`.

Deploy this repository to the existing Fly app **groepsscore** so the Meta callback URL remains unchanged:

- https://groepsscore.fly.dev/webhook/facebook

## Environment variables

Copy `.env.example` to `.env` for local development and set:

- `FB_VERIFY_TOKEN`
- `FB_PAGE_ACCESS_TOKEN`
- `FB_APP_SECRET` (optional)
- `ADMIN_TOKEN` (optional, required for `GET /debug/build`)
- `APP_BASE_URL` (optional, defaults to `http://localhost:3000`; used for mock Messenger image attachments)
- `MOCK_MODE` (optional, defaults to `true`)

Do not commit secrets.

## Deploy to Fly

```bash
fly deploy -a groepsscore
fly secrets list -a groepsscore
fly logs -a groepsscore
```

### prod keep-alive settings

Set in `fly.toml` under `[http_service]`:

- `auto_stop_machines = false`
- `min_machines_running = 1`

Verify active config:

```bash
fly config show -a groepsscore
```

Health check:

```bash
curl https://<host>/healthz
```

## Webhook paths (unchanged)

- `GET /webhook/facebook`
  - returns `200` with `hub.challenge` as `text/plain` if `hub.verify_token` matches `FB_VERIFY_TOKEN`
  - returns `403` otherwise
- `POST /webhook/facebook`
  - returns `200` immediately
  - processes Messenger events asynchronously
- `GET /debug/build`
  - requires header `X-Admin-Token` to match `ADMIN_TOKEN`
  - returns build/runtime metadata without secrets

## Messenger UX flow (mock image generation)

1. Send `hi` (or any text) to the page:
   - Bot replies with quick replies:
     - `📸 Stuur foto`
     - `🔥 Trending`
   - Then sends: `Je kan ook meteen een foto sturen.`

2. Send a photo:
   - Bot stores the image as pending state for your PSID
   - Bot sends a 4-card style picker carousel:
     - `STYLE_DISCO`
     - `STYLE_CINEMATIC`
     - `STYLE_ANIME`
     - `STYLE_MEME`

3. Pick a style:
   - Bot sends `Bezig… ⏳`
   - Bot sends a mock generated image (static URL per style)
   - Bot sends follow-up quick replies:
     - `🔁 Variatie`
     - `💥 Sterker`
     - `🎨 Nieuwe stijl`

4. Tap `🔥 Trending`:
   - Bot sends the same style carousel with demo thumbnails
   - Bot then says: `Stuur je foto om te starten.`

5. Tap `🔁 Variatie` or `💥 Sterker`:
   - If prior context exists, bot generates another mock image variant
   - If no context exists, bot asks for photo/style first

## Daily quota (current tier)

- Tier: `free`
- Limit: **1 generation per PSID per day**
- Extra requests return:
  - `Je gratis limiet is bereikt (1 per dag). Kom morgen terug of upgrade.`

Quota and session state are stored in memory and keyed by PSID.

## Where to plug in OpenAI later

Current generation is mocked in:

- `server/_core/imageService.ts` (`getMockGeneratedImage`)

When ready for production generation, replace this implementation and keep the Messenger UX + webhook handlers unchanged.

## Deployment verification checklist

1. Verify webhook challenge response:

   ```powershell
   iwr "https://groepsscore.fly.dev/webhook/facebook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=123"
   ```

   The response body should be `123`.

2. Send Messenger events and inspect logs:

   ```bash
   fly logs -a groepsscore
   ```

   Confirm no webhook processing errors are reported.
