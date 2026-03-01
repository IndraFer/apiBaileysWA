import type { Context, Next } from "hono";
import connectionManager from "@/baileys/connectionManager";

/**
 * Middleware to validate that a session exists and is connected.
 * Expects `sessionId` in route params.
 */
export async function sessionValidator(c: Context, next: Next) {
  const sessionId = c.req.param("sessionId");

  if (!sessionId) {
    return c.json({ success: false, message: "Session ID is required" }, 400);
  }

  if (!connectionManager.hasSession(sessionId)) {
    return c.json({ success: false, message: `Session '${sessionId}' not found` }, 404);
  }

  return next();
}
