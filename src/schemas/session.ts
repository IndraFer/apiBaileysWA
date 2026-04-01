/**
 * Zod Validation Schemas — Session Routes
 */
import { z } from "zod";

export const autoReplySchema = z
  .object({
    enabled: z.boolean(),
    message: z.string().min(1, "Auto reply message cannot be empty"),
    type: z.enum(["always", "time_range", "on_webhook_fail"]),
    timeStart: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid start time format (HH:mm)")
      .optional(),
    timeEnd: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid end time format (HH:mm)")
      .optional(),
  })
  .optional();

export const createSessionSchema = z
  .object({
    clientName: z.string().optional(),
    webhookUrl: z.string().url("Invalid webhook URL").optional().or(z.literal("")),
    webhookSecret: z.string().optional(),
    freshAuth: z.boolean().optional().default(false),
    usePairingCode: z.boolean().optional().default(false),
    phoneNumber: z.string().optional(),
    includeMedia: z.boolean().optional(),
    syncFullHistory: z.boolean().optional().default(false),
    autoReply: autoReplySchema,
  })
  .optional()
  .default({});

/** Session ID must be alphanumeric with hyphens/underscores, 1-64 chars */
export const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
