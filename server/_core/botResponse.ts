export type BotResponse = {
  kind: "text" | "ack" | "typing";
  text?: string;
};
