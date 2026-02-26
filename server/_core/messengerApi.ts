const GRAPH_API_VERSION = "v21.0";

function redactImageUrlForLog(imageUrl: string): string {
  try {
    const parsed = new URL(imageUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "invalid_url";
  }
}

function isLikelyHtmlPageUrl(imageUrl: string): boolean {
  try {
    const parsed = new URL(imageUrl);
    return (
      parsed.hostname === "commons.wikimedia.org" &&
      parsed.pathname.startsWith("/wiki/")
    );
  } catch {
    return false;
  }
}

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

export function safeLog(
  event: string,
  details: Record<string, unknown> = {}
): void {
  const redacted = Object.fromEntries(
    Object.entries(details).filter(
      ([key]) => !key.toLowerCase().includes("token")
    )
  );

  console.log(`[messenger] ${event}`, redacted);
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
  const loggedImageUrl = redactImageUrlForLog(imageUrl);
  const likelyHtmlPageUrl = isLikelyHtmlPageUrl(imageUrl);

  safeLog("messenger_image_send", {
    imageUrl: loggedImageUrl,
    likelyHtmlPageUrl,
  });

  if (likelyHtmlPageUrl) {
    safeLog("messenger_image_send_warning", {
      reason: "likely_html_page_url",
      imageUrl: loggedImageUrl,
    });
  }

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
