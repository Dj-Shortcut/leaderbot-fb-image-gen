export type BotChannel = "messenger" | "whatsapp";

export type NormalizedInboundMessage = {
  channel: BotChannel;
  senderId: string;
  userId: string;
  messageType: "text" | "image" | "unknown";
  rawMessageType?: string;
  textBody?: string;
  imageUrl?: string;
  imageId?: string;
  timestamp?: number;
};
