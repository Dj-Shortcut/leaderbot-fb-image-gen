import { randomUUID } from "crypto";
import express from "express";
import { sendQuickReplies, sendText, safeLog } from "./messengerApi";
import { recordImageJob } from "./messengerJobStore";
import { anonymizePsid, getOrCreateState, pruneOldState, setChosenStyle, setFlowState, setPendingImage } from "./messengerState";

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

const STYLE_OPTIONS = ["Disco", "Gold", "Anime", "Clouds"] as const;
const STYLE_PAYLOAD_PREFIX = "STYLE_";
const GREETINGS = new Set(["hi", "hello", "hey", "yo", "hola"]);

function stylePayloadToLabel(payload: string): string | undefined {
  if (!payload.startsWith(STYLE_PAYLOAD_PREFIX)) {
    return undefined;
  }

  const name = payload.slice(STYLE_PAYLOAD_PREFIX.length).toLowerCase();
  return STYLE_OPTIONS.find(style => style.toLowerCase() === name);
}

function parseStyle(text: string): string | undefined {
  const normalized = text.trim().toLowerCase();
  return STYLE_OPTIONS.find(style => style.toLowerCase() === normalized);
}

async function sendGreeting(psid: string): Promise<void> {
  await sendText(psid, "Hey 👋");
  await sendText(psid, "Send me a photo and I’ll transform it into something special.");
  await sendText(psid, "Or tell me what vibe you want (disco, gold, anime, clouds…).");
}

async function sendStylePicker(psid: string): Promise<void> {
  await sendQuickReplies(psid, "Nice, got it. What style should I use?", STYLE_OPTIONS.map(style => ({
    content_type: "text" as const,
    title: style,
    payload: `${STYLE_PAYLOAD_PREFIX}${style.toUpperCase()}`,
  })));
}

async function explainFlow(psid: string): Promise<void> {
  await sendText(psid, "I turn photos into stylized images.");
  await sendText(psid, "Send me a picture and choose a vibe.");
}

async function runMockGeneration(psid: string, userId: string, style: string): Promise<void> {
  setFlowState(userId, "processing");
  const imageJobId = randomUUID();

  recordImageJob({
    userId,
    style,
    imageJobId,
    timestamp: Date.now(),
  });

  await sendText(psid, `Perfect — applying ${style} style now (mock) ✨`);
  await sendText(psid, `Job queued: ${imageJobId}`);
  await sendText(psid, "You can send another photo any time.");

  setFlowState(userId, "idle");
}

async function handleStyleSelection(psid: string, userId: string, style: string): Promise<void> {
  const state = getOrCreateState(userId);
  setChosenStyle(userId, style);

  if (!state.lastPhoto) {
    await sendText(psid, `Nice choice: ${style}. Send me a photo first 📸`);
    return;
  }

  await runMockGeneration(psid, userId, style);
}

async function handlePayload(psid: string, userId: string, payload: string): Promise<void> {
  const selectedStyle = stylePayloadToLabel(payload);
  if (selectedStyle) {
    await handleStyleSelection(psid, userId, selectedStyle);
    return;
  }

  safeLog("unknown_payload", { userId, payload });
}

async function handleMessage(psid: string, userId: string, event: FacebookWebhookEvent): Promise<void> {
  const message = event.message;

  if (!message || message.is_echo) {
    return;
  }

  const quickPayload = message.quick_reply?.payload;
  if (quickPayload) {
    await handlePayload(psid, userId, quickPayload);
    return;
  }

  const imageAttachment = message.attachments?.find(att => att.type === "image" && att.payload?.url);
  if (imageAttachment?.payload?.url) {
    setPendingImage(userId, imageAttachment.payload.url);
    await sendStylePicker(psid);
    return;
  }

  const text = message.text?.trim();
  if (!text) {
    return;
  }

  const styleFromText = parseStyle(text);
  if (styleFromText) {
    await handleStyleSelection(psid, userId, styleFromText);
    return;
  }

  if (GREETINGS.has(text.toLowerCase())) {
    await sendGreeting(psid);
    return;
  }

  await explainFlow(psid);
}

async function handleEvent(event: FacebookWebhookEvent): Promise<void> {
  const psid = event.sender?.id;
  if (!psid) {
    return;
  }

  const userId = anonymizePsid(psid);

  if (event.postback?.payload) {
    await handlePayload(psid, userId, event.postback.payload);
    return;
  }

  await handleMessage(psid, userId, event);
}

export function registerMetaWebhookRoutes(app: express.Express): void {
  const handleVerification: express.RequestHandler = (req, res) => {
    const mode = req.query["hub.mode"];
    const verifyToken = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && verifyToken === process.env.FB_VERIFY_TOKEN) {
      return res.status(200).type("text/plain").send(challenge);
    }

    return res.sendStatus(403);
  };

  app.get("/webhook", handleVerification);
  app.get("/webhook/facebook", handleVerification);

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
