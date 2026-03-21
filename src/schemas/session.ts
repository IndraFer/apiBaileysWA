/**
 * Zod Validation Schemas — Session Routes
 */
import { z } from "zod";

export const createSessionSchema = z.object({
  clientName: z.string().optional(),
  webhookUrl: z.string().url("Invalid webhook URL").optional().or(z.literal("")),
  webhookSecret: z.string().optional(),
  freshAuth: z.boolean().optional().default(false),
  usePairingCode: z.boolean().optional().default(false),
  phoneNumber: z.string().optional(),
  includeMedia: z.boolean().optional(),
  syncFullHistory: z.boolean().optional().default(false),
}).optional().default({});

/** Session ID must be alphanumeric with hyphens/underscores, 1-64 chars */
export const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
