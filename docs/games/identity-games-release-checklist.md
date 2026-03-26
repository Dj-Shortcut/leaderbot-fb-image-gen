# Identity Games Release Checklist

## Purpose
This checklist is required before promoting an identity game variant to `active`.

## Required Checks
- Variant passes fixed V1 shape validation (3 questions, 4 options, 4 archetypes).
- Variant has a complete deterministic `resolutionMap`.
- Share metadata is complete:
  - `share.title`
  - `share.description`
  - `share.imageUrl`
- Canonical production share URL resolves on:
  - `https://leaderbot.live/play/{variantId}`
- Canonical share URL points to Messenger:
  - `https://m.me/{PAGE_ID}?ref={variantId}`

## Mandatory OG Preview Refresh
- After any update to share title, description, or image:
  - run Facebook Sharing Debugger on the canonical URL
  - trigger preview refresh/scrape again
  - verify updated `og:title`, `og:description`, and `og:image` are visible

## Launch Record
Capture before launch:
- Variant id
- Canonical share URL
- Messenger page id
- Facebook Debugger refresh timestamp
- Reviewer/owner sign-off
