/**
 * Validation for the unified send endpoint.
 *
 * One shape for third-party integrations: pick a session by id or phone, a
 * receiver, a type, and the matching content fields.
 */
import { z } from "zod";

export const MESSAGE_TYPES = ["text", "image", "document", "location"] as const;

export const unifiedSendSchema = z
  .object({
    /** Session id (`ROG8`) or the WhatsApp number bound to it. */
    from: z.string().trim().min(1, "from is required"),
    /** Phone number, JID, or group id when isGroup is true. */
    receiver: z.string().trim().min(1, "receiver is required"),
    /** Message kind; text is the default. */
    type: z.enum(MESSAGE_TYPES).default("text"),
    /** Text body, or the caption for media types. */
    messages: z.string().max(65536).optional(),
    /** Required for image/document. */
    media: z
      .object({
        url: z.string().url("media.url must be an absolute URL"),
        filename: z.string().trim().min(1).optional(),
        mimetype: z.string().trim().min(1).optional(),
      })
      .optional(),
    /** Required for location. */
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        name: z.string().trim().optional(),
        address: z.string().trim().optional(),
      })
      .optional(),
    /** Force group semantics when the receiver is not an @g.us JID. */
    isGroup: z.boolean().optional().default(false),
    /** Optional message to quote. */
    quoted: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "text" && !value.messages?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["messages"],
        message: "messages is required for text messages",
      });
    }
    if ((value.type === "image" || value.type === "document") && !value.media?.url) {
      ctx.addIssue({
        code: "custom",
        path: ["media", "url"],
        message: `media.url is required for ${value.type} messages`,
      });
    }
    if (value.type === "location" && !value.location) {
      ctx.addIssue({
        code: "custom",
        path: ["location"],
        message: "location is required for location messages",
      });
    }
  });

export type UnifiedSendInput = z.infer<typeof unifiedSendSchema>;
