# Leaderbot AI Image Generator

A zero-friction Facebook Messenger bot that transforms photos into AI-generated artworks.

Users send a photo, choose a style, receive an instant preview in chat, and optionally download a high-quality version — without login, prompts, or extra steps.

---

## ✨ What It Does

- 📸 User sends a photo in Messenger
- 🎨 User selects a transformation style
- ⚡ Instant preview appears in chat
- 📥 One-click HD download (optional)
- 🧠 Powered by AI image generation
- 🚀 Built for speed and zero friction

No accounts.  
No forms.  
No prompt engineering required.

---

## 🧠 Product Philosophy

Leaderbot is built around one principle:

> Friction kills momentum.

The system is designed to feel instant, simple, and effortless.

### Zero-Friction UX Principles

1. **No Obligations**  
   No login, no email, no required onboarding.

2. **No Thinking Required**  
   One clear action per step. No resolution or format choices.

3. **Immediate Reward**  
   Every user action returns visible progress or output.

4. **No Context Shock**  
   If a webview opens, it shows the image directly — no homepage, no navigation.

5. **Speed Over Ornament**  
   Perceived speed defines quality. Load time is UX.

These rules override feature creep.

---

## 🏗 Architecture Overview


Messenger
↓
Fly.io Backend (Webhook + Processing)
↓
Intent Handler (lightweight logic)
↓
Image Engine (AI generation)
↓
Preview in Messenger
↓
Optional HD download endpoint


### Key Design Decisions

- Messenger is the funnel, not the product.
- Backend is the backbone (persistent state, secure, minimal).
- Image normalization ensures consistent output.
- HD delivery guarantees full quality independent of Messenger compression.
- OAuth is optional and not required for core flow.

---

## 🚀 Quick Start (Local Development)

```bash
git clone https://github.com/Dj-Shortcut/leaderbot-fb-image-gen
cd leaderbot-fb-image-gen
pnpm install
pnpm build
pnpm dev

Server runs on:

http://localhost:8080

Health check:

curl http://localhost:8080/healthz
☁️ Deploy to Fly.io
fly deploy -a leaderbot-fb-image-gen

Check logs:

fly logs -a leaderbot-fb-image-gen

Check health:

curl https://leaderbot-fb-image-gen.fly.dev/healthz
🔐 Environment Variables

Required:

FB_VERIFY_TOKEN
FB_PAGE_ACCESS_TOKEN
FB_APP_SECRET
APP_BASE_URL
PRIVACY_PEPPER
DATABASE_URL (MySQL)

Optional:

REDIS_URL (for session state, falls back to in-memory)
ADMIN_TOKEN
OAUTH_SERVER_URL

Secrets must be set via:

fly secrets set KEY=value -a leaderbot-fb-image-gen
🖼 Image Handling Strategy

Messenger may deliver images in various formats (JPEG, PNG, WEBP).

To ensure consistency and quality:

Only image/* attachments are accepted.

Video formats (webm/mp4) are rejected.

Images are normalized internally.

Preview is optimized for speed.

HD version preserves full quality.

Preview = instant dopamine.
HD download = full ownership.

For production Messenger delivery (`attachment.payload.url`), generated OpenAI PNG output is persisted to `public/generated/<id>.png` and sent as `${APP_BASE_URL}/generated/<id>.png`. `APP_BASE_URL` must be a public URL in OpenAI mode so Meta can fetch the image from the internet.

📦 Core Endpoints
Endpoint	Purpose
/healthz	Health check
/webhook	Messenger webhook
/result/:id	Optional HD image view
/files/:id	Direct HD download
📊 Logging Philosophy

Structured, minimal, privacy-safe.


## 🔒 Privacy-by-Design (Meta App Review)

- We derive a pseudonymous `userKey` from Messenger PSID using `HMAC-SHA256(psid, PRIVACY_PEPPER)`.
- `PRIVACY_PEPPER` is server-held only (Fly secret) and is required at startup.
- Raw PSIDs are never written to logs or storage keys.
- Logs intentionally exclude attachment URLs, message text, access tokens, and raw webhook payload bodies.
- Input photos are processed only to fulfill the generation request and are not retained beyond operational processing needs.


We log:

Media type

Dimensions

Conversion status

Processing time

We do NOT log:

Raw image data

Attachment URLs

Tokens

Full webhook payloads

🧭 Roadmap

 Style pack expansion

 Optional user history

 Usage analytics dashboard

 Tiered limits / credits

 Internationalization

 Performance optimization layer

Zero friction remains non-negotiable.

🤝 Contributing

Before submitting a PR, verify:

 No login introduced into core flow

 No mandatory extra steps added

 No unnecessary navigation

 No UX regression

 Loads fast

Architecture > novelty.

📄 License

MIT

⚡ Final Note

Leaderbot is not trying to be everything.

It is trying to be:

Fast

Simple

High quality

Frictionless

Everything else is optional.

## 🛡 Code Audit
A comprehensive code audit for solo-developer optimization was conducted on March 3, 2026.
Read the full report here: [CODE_AUDIT_REPORT.md](./CODE_AUDIT_REPORT.md)


## 🧹 Linting

ESLint is configured with type-aware TypeScript rules using the root `tsconfig.json` so issues are caught early in `client`, `shared`, and `server` code.

- Run lint checks:
  ```bash
  pnpm run lint
  ```
- Auto-fix safe issues:
  ```bash
  pnpm run lint:fix
  ```

Why ESLint was added:

- catches real TypeScript/runtime pitfalls (for example unhandled promises)
- keeps code quality consistent across server/client/shared modules
- stays conflict-free with Prettier by disabling stylistic overlap

