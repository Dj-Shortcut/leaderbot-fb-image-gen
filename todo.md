# Leaderbot Image Generator — Facebook Messenger Bot

## Phase 1: Meta Developer Setup
- [x] Rebrand Groepsscore app to "Leaderbot Image Generator"
- [x] Configure Messenger webhook at https://groepsscore.fly.dev/webhook/facebook
- [x] Set up Facebook Page integration (ID: 61587343141159)
- [x] Generate and store Page Access Token
- [x] Configure webhook verify token
- [x] Test webhook connectivity

## Phase 2: Backend Messenger Bot Integration
- [x] Create Messenger webhook handler (/api/webhook/facebook)
- [x] Implement message receiving and parsing
- [x] Set up user authentication flow with Manus OAuth
- [x] Create message sending to users via Messenger API
- [x] Implement quick reply buttons for style selection
- [x] Handle image uploads from Messenger

## Phase 3: Preset Filter System
- [x] Define transformation filter options (Caricature, Petals, Gold, Cinematic, Disco, Clouds)
- [x] Implement image-to-image transformation with DALL-E / gpt-image-1
- [x] Create filter templates with style prompts
- [ ] Add seasonal filter rotation
- [x] Implement image upload and processing pipeline

## Phase 4: Manus OAuth Integration
- [x] Create OAuth callback handler for Messenger users
- [x] Link Facebook user ID to Manus user account
- [x] Store user authentication state
- [x] Handle re-authentication flow

## Phase 5: Free Tier Implementation
- [x] Implement daily quota tracking (1 image/day per user)
- [x] Create quota checking before transformation
- [ ] Implement cost tracking (€0.04 per image)
- [ ] Add €100/month cost cap enforcement
- [ ] Send cost alerts to owner
- [ ] Create "upgrade to premium" prompt when limit reached

## Phase 6: Premium Tier (Ready but Inactive)
- [ ] Design premium tier database schema
- [ ] Implement Stripe payment integration
- [ ] Create premium subscription management
- [ ] Implement premium quota limits (10 images/day)
- [ ] Add premium feature flags (ready to activate)

## Phase 7: Testing & Deployment
- [x] Test Messenger bot message flow
- [x] Test image upload and transformation
- [x] Test quota enforcement
- [ ] Test cost tracking
- [x] Deploy to production
- [x] Verify webhook connectivity

## Phase 8: Delivery & Documentation
- [ ] Create setup guide for Meta configuration
- [ ] Document filter options and seasonal updates
- [ ] Provide cost monitoring dashboard
- [ ] Create user-facing bot instructions
