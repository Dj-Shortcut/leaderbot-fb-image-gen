const GRAPH_API_VERSION = "v21.0";

type QuickReply = {
  content_type: "text";
  title: string;
  payload: string;
};

type GenericTemplateElement = {
  title: string;
  subtitle?: string;
  image_url?: string;
  buttons?: Array<{
    type: "postback";
    title: string;
    payload: string;
  }>;
};

function getPageToken(): string {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;

  if (!token) {
    throw new Error("FB_PAGE_ACCESS_TOKEN is missing");
  }

  return token;
}

function getSendApiUrl(): string {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(getPageToken())}`;
}

async function sendMessage(
  psid: string,
  message: Record<string, unknown>
): Promise<void> {
  const response = await fetch(getSendApiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: psid },
      message,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Messenger API error ${response.status}: ${body}`);
  }
}

function shouldDropLogKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return ["token", "psid", "text", "url", "payload", "attachment", "message", "sender", "body"].some(fragment =>
    lowered.includes(fragment)
  );
}

function redactLogDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !shouldDropLogKey(key))
      .map(([key, value]) => {
        if (typeof value === "string" && key === "user") {
          return [key, value.slice(0, 8)];
        }

        return [key, value];
      })
  );
}

export function safeLog(
  event: string,
  details: Record<string, unknown> = {}
): void {
  console.log(`[messenger] ${event}`, redactLogDetails(details));
}

export async function sendText(psid: string, text: string): Promise<void> {
  await sendMessage(psid, { text });
}

export async function sendQuickReplies(
  psid: string,
  text: string,
  replies: QuickReply[]
): Promise<void> {
  await sendMessage(psid, {
    text,
    quick_replies: replies,
  });
}

export async function sendGenericTemplate(
  psid: string,
  elements: GenericTemplateElement[]
): Promise<void> {
  await sendMessage(psid, {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements,
      },
    },
  });
}

export async function sendImage(psid: string, imageUrl: string): Promise<void> {
  safeLog("messenger_image_send", {});

  await sendMessage(psid, {
    attachment: {
      type: "image",
      payload: {
        url: imageUrl,
        is_reusable: false,
      },
    },
  });
}

export type { QuickReply, GenericTemplateElement };
