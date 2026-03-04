import { z } from "zod";

const messengerAttachmentSchema = z.object({
  type: z.string().optional(),
  payload: z
    .object({
      url: z.string().url().optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();

const messengerMessageSchema = z.object({
  mid: z.string().min(1).optional(),
  is_echo: z.boolean().optional(),
  text: z.string().optional(),
  quick_reply: z.object({
    payload: z.string().min(1).optional(),
  }).passthrough().optional(),
  attachments: z.array(messengerAttachmentSchema).optional(),
}).passthrough();

const messengerEventSchema = z.object({
  sender: z.object({
    id: z.string().min(1).optional(),
    locale: z.string().optional(),
  }).passthrough().optional(),
  recipient: z.object({
    id: z.string().min(1).optional(),
  }).passthrough().optional(),
  message: messengerMessageSchema.optional(),
  postback: z.object({
    title: z.string().optional(),
    payload: z.string().optional(),
    referral: z.object({
      ref: z.string().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
  referral: z.object({
    ref: z.string().optional(),
  }).passthrough().optional(),
  timestamp: z.number().finite().nonnegative().optional(),
  delivery: z.unknown().optional(),
  read: z.unknown().optional(),
}).passthrough();

export const facebookWebhookPayloadSchema = z.object({
  object: z.string().min(1),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      time: z.number().finite().optional(),
      messaging: z.array(messengerEventSchema).default([]),
    }).passthrough(),
  ).default([]),
}).passthrough();

export type FacebookWebhookPayload = z.infer<typeof facebookWebhookPayloadSchema>;
