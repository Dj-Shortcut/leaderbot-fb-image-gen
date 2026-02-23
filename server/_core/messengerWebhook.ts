import express from "express";
import { sendQuickReplies, sendText, safeLog } from "./messengerApi";
import { pruneOldState, setChosenStyle, setFlowState, setPendingImage, getOrCreateState } from "./messengerState";

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

const STYLE_OPTIONS = ["Disco", "Anime", "Gold", "Clouds", "Cinematic", "Pixel"] as const;
const STYLE_PAYLOAD_PREFIX = "STYLE_";

function stylePayloadToLabel(payload: string): string | undefined {
  if (!payload.startsWith(STYLE_PAYLOAD_PREFIX)) {
    return undefined;
  }

  const name = payload.slice(STYLE_PAYLOAD_PREFIX.length).toLowerCase();
  return STYLE_OPTIONS.find(style => style.toLowerCase() === name);
}

async function sendStartMenu(psid: string): Promise<void> {
  await sendQuickReplies(psid, "Welcome 👋 Pick a quick start:", [
    { content_type: "text", title: "📸 Send photo", payload: "SEND_PHOTO" },
    { content_type: "text", title: "✨ Choose style", payload: "CHOOSE_STYLE" },
    { content_type: "text", title: "🔥 Trending", payload: "TRENDING" },
    { content_type: "text", title: "❓ Help", payload: "HELP" },
  ]);
}

async function sendStylePicker(psid: string): Promise<void> {
  await sendQuickReplies(psid, "Pick a style:", STYLE_OPTIONS.map(style => ({
    content_type: "text" as const,
    title: style,
    payload: `${STYLE_PAYLOAD_PREFIX}${style.toUpperCase()}`,
  })));
}

async function sendTrending(psid: string): Promise<void> {
  await sendText(psid, "Trending now: Disco, Anime, Gold.");
  await sendText(psid, "Send a photo and I’ll apply your pick.");
}

async function sendHelp(psid: string): Promise<void> {
  await sendText(psid, "Quick flow: send a photo, pick a style, get your result.");
  await sendQuickReplies(psid, "What do you want to do next?", [
    { content_type: "text", title: "📸 Send photo", payload: "SEND_PHOTO" },
    { content_type: "text", title: "✨ Choose style", payload: "CHOOSE_STYLE" },
  ]);
}

async function handleStyleSelection(psid: string, style: string): Promise<void> {
  const state = getOrCreateState(psid);
  setChosenStyle(psid, style);

  if (!state.lastPhotoUrl) {
    setFlowState(psid, "awaiting_photo");
    await sendText(psid, `Nice choice: ${style}. Now send a photo 📸`);
    return;
  }

  setFlowState(psid, "processing");
  await sendText(psid, "Got it — processing…");
  await sendQuickReplies(psid, "Want to try another style too?", [
    { content_type: "text", title: "✨ Choose style", payload: "CHOOSE_STYLE" },
    { content_type: "text", title: "📸 Send new photo", payload: "SEND_PHOTO" },
  ]);
}

async function handlePayload(psid: string, payload: string): Promise<void> {
  if (payload === "SEND_PHOTO") {
    setFlowState(psid, "awaiting_photo");
    await sendText(psid, "Great — send your photo now 📸");
    return;
  }

  if (payload === "CHOOSE_STYLE") {
    const state = getOrCreateState(psid);
    if (!state.lastPhotoUrl) {
      setFlowState(psid, "awaiting_photo");
      await sendStylePicker(psid);
      await sendText(psid, "Pick any style, then send your photo 📸");
      return;
    }

    setFlowState(psid, "awaiting_style");
    await sendStylePicker(psid);
    return;
  }

  if (payload === "TRENDING") {
    setFlowState(psid, "awaiting_photo");
    await sendTrending(psid);
    return;
  }

  if (payload === "HELP") {
    await sendHelp(psid);
    return;
  }

  const selectedStyle = stylePayloadToLabel(payload);
  if (selectedStyle) {
    await handleStyleSelection(psid, selectedStyle);
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
    await sendText(psid, "Photo received ✅");
    await sendStylePicker(psid);
    return;
  }

  const text = message.text?.trim().toLowerCase();
  if (!text) {
    return;
  }

  const state = getOrCreateState(psid);
  if (state.state === "new" || text === "start" || text === "hi") {
    await sendStartMenu(psid);
    return;
  }

  await sendQuickReplies(psid, "Next step:", [
    { content_type: "text", title: "📸 Send photo", payload: "SEND_PHOTO" },
    { content_type: "text", title: "✨ Choose style", payload: "CHOOSE_STYLE" },
  ]);
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
