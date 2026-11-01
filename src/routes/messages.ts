/**
 * Unified send endpoint for third-party integrations.
 *
 * POST /messages — one request shape for text, image, document and location.
 * Authentication uses the existing API key middleware; every request is rate
 * limited like the other send routes.
 */
import { Hono } from "hono";
import { error, success } from "@/lib/response";
import { authMiddleware } from "@/middleware/auth";
import { sendRateLimit } from "@/middleware/rateLimit";
import { unifiedSendSchema } from "@/schemas/message";
import { MessageSendError, sendUnifiedMessage } from "@/services/messageSender";

const messageRoutes = new Hono();

messageRoutes.use("*", authMiddleware);

messageRoutes.post("/", sendRateLimit, async (c) => {
  const parsed = unifiedSendSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return error(c, parsed.error.issues[0].message, 400);
  }

  try {
    const data = await sendUnifiedMessage(parsed.data);
    return success(c, data, "Message sent successfully");
  } catch (err) {
    if (err instanceof MessageSendError) {
      return error(c, err.message, err.status);
    }

    const message = (err as Error).message;
    if (message.includes("not registered on WhatsApp")) {
      return error(c, message, 400);
    }
    if (message.includes("not connected")) {
      return error(c, message, 409);
    }
    return error(c, `Failed to send message: ${message}`);
  }
});

export default messageRoutes;
