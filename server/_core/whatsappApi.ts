import { getEnv } from "./env";
import { createLogger } from "./logger";

const GRAPH_API_VERSION = "v19.0";
const logger = createLogger({});

function getWhatsAppAccessToken(): string {
  return getEnv("WHATSAPP_ACCESS_TOKEN");
}

function getWhatsAppPhoneNumberId(): string {
  return getEnv("WHATSAPP_PHONE_NUMBER_ID");
}

function getWhatsAppSendUrl(): string {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(getWhatsAppPhoneNumberId())}/messages`;
}

export async function sendWhatsAppText(
  to: string,
  message: string
): Promise<void> {
  const response = await fetch(getWhatsAppSendUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getWhatsAppAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message },
    }),
  });

  if (response.ok) {
    return;
  }

  const responseBody = await response.text();
  logger.error({
    event: "whatsapp_send_failed",
    status: response.status,
    statusText: response.statusText,
    body: responseBody,
  });

  throw new Error(`WhatsApp API error ${response.status}: ${responseBody}`);
}
