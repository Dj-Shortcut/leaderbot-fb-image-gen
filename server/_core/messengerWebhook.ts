import express from "express";
import {
  sendGenericTemplate,
  sendImage,
  sendQuickReplies,
  sendText,
  safeLog,
  type GenericTemplateElement,
} from "./messengerApi";
import { canGenerate, increment } from "./messengerQuota";
import { getOrCreateState, pruneOldState, setLastGenerated, setPendingImage } from "./messengerState";
import { isStylePayload, STYLE_CONFIGS, type StyleId } from "./messengerStyles";
import { getMockGeneratedImage } from "./imageService";

type FacebookWebhookEvent = {
  sender?: { id?: string };
  message?: {
    is_echo?: boolean;
    text?: string;
    quick_reply?: { payload?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  postback?: {
    title?: string;
    payload?: string;
  };
};

function buildStyleElements(): GenericTemplateElement[] {
  return STYLE_CONFIGS.map(style => ({
    title: style.label,
    subtitle: "Kies deze stijl",
    image_url: style.demoThumbnailUrl,
    buttons: [
      {
        type: "postback",
        title: "Kies stijl",
        payload: style.payload,
      },
    ],
  }));
}

async function sendStylePicker(psid: string): Promise<void> {
  await sendGenericTemplate(psid, buildStyleElements());
}

async function processGeneration(psid: string, styleId: StyleId): Promise<void> {
  const state = getOrCreateState(psid);

  if (!state.pendingImageUrl) {
    await sendText(psid, "Stuur eerst een foto om te starten 📸");
    return;
  }

  if (!canGenerate(psid)) {
    await sendText(psid, "Je gratis limiet is bereikt (1 per dag). Kom morgen terug of upgrade.");
    return;
  }

  increment(psid);
  await sendText(psid, "Bezig… ⏳");

  const variant = getMockGeneratedImage(styleId, 0);
  await sendImage(psid, variant.imageUrl);

  state.lastVariantCursor = variant.nextCursor;
  setLastGenerated(psid, styleId, variant.imageUrl);

  await sendQuickReplies(psid, "Klaar! Wil je nog een versie?", [
    { content_type: "text", title: "🔁 Variatie", payload: "VARIATION" },
    { content_type: "text", title: "💥 Sterker", payload: "STRONGER" },
    { content_type: "text", title: "🎨 Nieuwe stijl", payload: "NEW_STYLE" },
  ]);
}

async function processVariation(psid: string): Promise<void> {
  const state = getOrCreateState(psid);

  if (!state.lastStyle || !state.lastImageUrl) {
    await sendText(psid, "Stuur een foto en kies een stijl om te beginnen.");
    return;
  }

  if (!canGenerate(psid)) {
    await sendText(psid, "Je gratis limiet is bereikt (1 per dag). Kom morgen terug of upgrade.");
    return;
  }

  increment(psid);
  await sendText(psid, "Bezig… ⏳");

  const variant = getMockGeneratedImage(state.lastStyle, state.lastVariantCursor ?? 1);
  await sendImage(psid, variant.imageUrl);

  state.lastVariantCursor = variant.nextCursor;
  setLastGenerated(psid, state.lastStyle, variant.imageUrl);

  await sendQuickReplies(psid, "Nog eentje?", [
    { content_type: "text", title: "🔁 Variatie", payload: "VARIATION" },
    { content_type: "text", title: "💥 Sterker", payload: "STRONGER" },
    { content_type: "text", title: "🎨 Nieuwe stijl", payload: "NEW_STYLE" },
  ]);
}

async function handlePayload(psid: string, payload: string): Promise<void> {
  if (payload === "TRENDING") {
    await sendGenericTemplate(psid, buildStyleElements());
    await sendText(psid, "Stuur je foto om te starten.");
    return;
  }

  if (payload === "SEND_PHOTO") {
    await sendText(psid, "Top! Stuur nu je foto 📸");
    return;
  }

  if (payload === "NEW_STYLE") {
    await sendStylePicker(psid);
    return;
  }

  if (payload === "VARIATION" || payload === "STRONGER") {
    await processVariation(psid);
    return;
  }

  if (isStylePayload(payload)) {
    await processGeneration(psid, payload);
    return;
  }

  safeLog("unknown_payload", { psid, payload });
}

async function handleMessage(psid: string, event: FacebookWebhookEvent): Promise<void> {
  const message = event.message;

  if (!message || message.is_echo) {
    return;
  }

  const quickPayload = message.quick_reply?.payload;
  if (quickPayload) {
    await handlePayload(psid, quickPayload);
    return;
  }

  const imageAttachment = message.attachments?.find(att => att.type === "image" && att.payload?.url);

  if (imageAttachment?.payload?.url) {
    setPendingImage(psid, imageAttachment.payload.url);
    await sendStylePicker(psid);
    return;
  }

  if (typeof message.text === "string" && message.text.trim().length > 0) {
    await sendQuickReplies(psid, "Welkom! Klaar om je foto te transformeren?", [
      { content_type: "text", title: "📸 Stuur foto", payload: "SEND_PHOTO" },
      { content_type: "text", title: "🔥 Trending", payload: "TRENDING" },
    ]);
    await sendText(psid, "Je kan ook meteen een foto sturen.");
  }
}

async function handleEvent(event: FacebookWebhookEvent): Promise<void> {
  const psid = event.sender?.id;

  if (!psid) {
    return;
  }

  if (event.postback?.payload) {
    await handlePayload(psid, event.postback.payload);
    return;
  }

  await handleMessage(psid, event);
}

export function registerMetaWebhookRoutes(app: express.Express): void {
  app.get("/webhook/facebook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = process.env.FB_VERIFY_TOKEN;

    if (mode === "subscribe" && token === verifyToken && typeof challenge === "string") {
      return res.status(200).type("text/plain").send(challenge);
    }

    return res.sendStatus(403);
  });

  app.post("/webhook/facebook", (req, res) => {
    const payload = req.body;
    res.sendStatus(200);

    setImmediate(async () => {
      try {
        pruneOldState();
        const entries = Array.isArray(payload?.entry) ? payload.entry : [];

        for (const entry of entries) {
          const events: FacebookWebhookEvent[] = Array.isArray(entry?.messaging) ? entry.messaging : [];

          for (const event of events) {
            await handleEvent(event);
          }
        }
      } catch (error) {
        console.error("[facebook-webhook] failed to process event", error);
      }
    });
  });
}
