import { normalizeLang, t } from "./i18n";
import { setLastUserMessageAt } from "./messengerState";
import { toLogUser } from "./privacy";
import { extractWhatsAppEvents, logWhatsAppWebhookPayload } from "./inbound/whatsappInbound";
import { handleWhatsAppImageEvent } from "./whatsappHandlers/imageHandler";
import { handleWhatsAppInteractiveEvent } from "./whatsappHandlers/interactiveHandler";
import { handleWhatsAppTextEvent } from "./whatsappHandlers/textHandler";
import { handleWhatsAppExperienceRouting } from "./whatsappRouting";
import { sendWhatsAppTextReply } from "./whatsappResponseService";
import type { NormalizedWhatsAppEvent } from "./whatsappTypes";

const DEFAULT_LANG = normalizeLang(process.env.DEFAULT_MESSENGER_LANG);

function normalizeWhatsAppEvents(payload: unknown): NormalizedWhatsAppEvent[] {
  return extractWhatsAppEvents(payload).filter(
    (event): event is NormalizedWhatsAppEvent => event.channel === "whatsapp"
  );
}

export async function processWhatsAppWebhookPayload(
  payload: unknown
): Promise<void> {
  logWhatsAppWebhookPayload(payload);

  const events = normalizeWhatsAppEvents(payload);
  if (events.length === 0) {
    console.log("[whatsapp webhook] no inbound messages found");
    return;
  }

  for (const event of events) {
    const context = {
      reqId: `${event.senderId}-${Date.now()}`,
      lang: DEFAULT_LANG,
    };

    console.log("[whatsapp webhook] normalized inbound event", {
      channel: event.channel,
      user: toLogUser(event.userId),
      messageType: event.messageType,
      rawMessageType: event.rawMessageType,
    });

    await Promise.resolve(
      setLastUserMessageAt(event.senderId, event.timestamp ?? Date.now())
    );

    try {
      if (await handleWhatsAppExperienceRouting(event)) {
        continue;
      }

      if (event.messageType === "image") {
        await handleWhatsAppImageEvent(event, context);
        continue;
      }

      if (event.rawMessageType === "interactive") {
        await handleWhatsAppInteractiveEvent(event, context);
        continue;
      }

      if (event.messageType === "text") {
        await handleWhatsAppTextEvent(event, context);
        continue;
      }

      if (event.messageType === "unknown") {
        console.warn("[whatsapp webhook] unsupported inbound message type", {
          user: toLogUser(event.userId),
          rawMessageType: event.rawMessageType,
        });
        await sendWhatsAppTextReply(event.senderId, t(context.lang, "unsupportedMedia"));
        continue;
      }

      console.warn("[whatsapp webhook] no handler for inbound event", {
        user: toLogUser(event.userId),
        messageType: event.messageType,
        rawMessageType: event.rawMessageType,
      });
    } catch (error) {
      console.error("[whatsapp webhook] reply failed", {
        to: event.senderId,
        error: error instanceof Error ? error.message : String(error),
      });
      await sendWhatsAppTextReply(
        event.senderId,
        context.lang === "en"
          ? "Something went wrong on my side. Please try again."
          : "Er liep iets mis aan mijn kant. Probeer gerust opnieuw."
      ).catch(() => undefined);
    }
  }
}
