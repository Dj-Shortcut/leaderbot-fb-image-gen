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

## Webhook behavior

- `GET /webhook/facebook`
  - returns `200` with `hub.challenge` if `hub.verify_token` matches `FB_VERIFY_TOKEN` (or `VERIFY_TOKEN` fallback)
  - returns `403` otherwise
- `POST /webhook/facebook`
  - returns `200` immediately
  - logs minimal event metadata (event type, sender id, content kind)

## Deployment verification checklist

1. Verify webhook challenge response:

   ```powershell
   iwr "https://groepsscore.fly.dev/webhook/facebook?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=123"
   ```

   The response body should be `123`.

2. Send a message to the connected Facebook Page and confirm POST delivery in Fly logs:

   ```bash
   fly logs -a groepsscore
   ```

   You should see `[facebook-webhook] event` log lines.
