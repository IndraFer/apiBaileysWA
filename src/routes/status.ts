import { Hono } from "hono";
import config from "@/config";
import connectionManager from "@/baileys/connectionManager";
import { success } from "@/lib/response";

const statusRoutes = new Hono();

/**
 * GET /status
 * Server health check and info.
 */
statusRoutes.get("/", (c) => {
  const sessions = connectionManager.listSessions();

  return success(c, {
    name: "baileys-wa-api",
    version: "1.0.0",
    description: "WhatsApp REST API powered by Baileys",
    environment: config.env,
    uptime: process.uptime(),
    redis: config.redis.enabled ? "enabled" : "disabled",
    activeSessions: sessions.length,
    connectedSessions: sessions.filter((s) => s.connected).length,
  });
});

export default statusRoutes;
