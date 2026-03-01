import { Hono } from "hono";
import connectionManager from "@/baileys/connectionManager";
import { authMiddleware } from "@/middleware/auth";
import { success, error } from "@/lib/response";

const sessionRoutes = new Hono();

sessionRoutes.use("*", authMiddleware);

/**
 * POST /sessions/:sessionId
 * Create a new session (QR code or pairing code).
 */
sessionRoutes.post("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json().catch(() => ({}));

  try {
    const result = await connectionManager.createSession(sessionId, {
      clientName: body.clientName,
      webhookUrl: body.webhookUrl,
      usePairingCode: body.usePairingCode ?? false,
      phoneNumber: body.phoneNumber,
      includeMedia: body.includeMedia,
      syncFullHistory: body.syncFullHistory ?? false,
    });

    if (result.pairingCode) {
      return success(c, { pairingCode: result.pairingCode }, "Pairing code generated. Enter it on your phone.");
    }

    return success(c, { qrCode: result.qrCode }, "Session created. Scan the QR code to connect.");
  } catch (err) {
    return error(c, `Failed to create session: ${(err as Error).message}`);
  }
});

/**
 * GET /sessions
 * List all active sessions.
 */
sessionRoutes.get("/", (c) => {
  const sessions = connectionManager.listSessions();
  return success(c, sessions);
});

/**
 * GET /sessions/:sessionId
 * Get session status.
 */
sessionRoutes.get("/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");
  const status = connectionManager.getSessionStatus(sessionId);
  return success(c, status);
});

/**
 * GET /sessions/:sessionId/qr
 * Get current QR code for a pending session.
 */
sessionRoutes.get("/:sessionId/qr", (c) => {
  const sessionId = c.req.param("sessionId");
  const status = connectionManager.getSessionStatus(sessionId);

  if (!status.exists) {
    return error(c, "Session not found", 404);
  }

  if (status.connected) {
    return success(c, { connected: true }, "Session is already connected");
  }

  return success(c, { qrCode: status.qrCode }, status.qrCode ? "QR code available" : "QR code not yet generated");
});

/**
 * DELETE /sessions/:sessionId
 * Logout and delete a session.
 */
sessionRoutes.delete("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");

  try {
    await connectionManager.deleteSession(sessionId);
    return success(c, null, "Session deleted successfully");
  } catch (err) {
    return error(c, `Failed to delete session: ${(err as Error).message}`);
  }
});

export default sessionRoutes;
