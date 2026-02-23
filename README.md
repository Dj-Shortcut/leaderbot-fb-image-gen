# leaderbot-fb-image-gen

Deploy this repository to the existing Fly app **groepsscore** so the Meta callback URL remains unchanged:

- https://groepsscore.fly.dev/webhook/facebook

## Environment variables

Copy `.env.example` to `.env` for local development and set:

- `FB_VERIFY_TOKEN`
- `FB_PAGE_ACCESS_TOKEN`
- `FB_APP_SECRET` (optional)

Do not commit secrets.

## Deploy to Fly

```bash
fly deploy -a groepsscore
fly secrets list -a groepsscore
fly logs -a groepsscore
```

## Webhook paths (unchanged)

- `GET /webhook/facebook`
  - returns `200` with `hub.challenge` if `hub.verify_token` matches `FB_VERIFY_TOKEN` (or `VERIFY_TOKEN` fallback)
  - returns `403` otherwise
- `POST /webhook/facebook`
  - returns `200` immediately
  - processes Messenger events asynchronously

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
