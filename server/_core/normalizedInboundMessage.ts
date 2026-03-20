export type BotChannel = "messenger" | "whatsapp";

export type NormalizedInboundMessage = {
  channel: BotChannel;
  senderId: string;
  userId: string;
  messageType: "text" | "image" | "unknown";
  textBody?: string;
  imageUrl?: string;
  timestamp?: number;
};
