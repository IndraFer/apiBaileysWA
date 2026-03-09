import app from "@/app";
import config from "@/config";
import connectionManager from "@/baileys/connectionManager";
import { initializeRedis } from "@/lib/redis";
import { MediaCleanupService } from "@/services/mediaCleanup";
import logger, { deepSanitizeObject } from "@/lib/logger";
import { errorToString } from "@/utils/validation";
import { isBun } from "@/lib/runtime";

// ── Global Error Handlers ───────────────────────────
process.on("uncaughtException", (error) => {
  logger.error("[UNCAUGHT EXCEPTION] %s", errorToString(error));
});

process.on("unhandledRejection", (reason) => {
  logger.error("[UNHANDLED REJECTION] %s", errorToString(reason as Error));
});

// ── Services ────────────────────────────────────────
const mediaCleanup = new MediaCleanupService();

// ── Start Server ────────────────────────────────────
async function startServer() {
  let hostname: string;
  let port: number;

  if (isBun) {
    // Bun runtime — use native Bun.serve
    const server = Bun.serve({
      port: config.port,
      hostname: config.host,
      fetch: app.fetch,
    });
    hostname = String(server.hostname ?? config.host);
    port = Number(server.port ?? config.port);
  } else {
    // Node.js runtime — use @hono/node-server
    const { serve } = await import("@hono/node-server");
    serve({
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    });
    hostname = config.host;
    port = config.port;
  }

  const runtime = isBun ? "Bun" : "Node.js";
  logger.info(`📖 Swagger docs: http://${hostname}:${port}/docs`);
  logger.info(`🚀 api-Baileys-WA running on http://${hostname}:${port} (${runtime})`);
  logger.info(
    "⚙️ Config:\n%s",
    JSON.stringify(deepSanitizeObject(config, { omitKeys: ["globalToken", "password"] }), null, 2)
  );
}

startServer();

// ── Production Config Validation ────────────────────
if (config.env === "production") {
  if (config.dashboard.jwtSecret.includes("change-me") || config.dashboard.jwtSecret.includes("change_me")) {
    logger.warn("⚠️  DASHBOARD_JWT_SECRET is using default value! Set a secure random secret for production.");
  }
  if (config.corsOrigin === "*") {
    logger.warn("⚠️  CORS_ORIGIN is set to '*'. Consider restricting to specific domains in production.");
  }
  if (!config.auth.globalToken && !config.redis.enabled) {
    logger.warn("⚠️  No authentication configured! Set AUTH_GLOBAL_TOKEN or enable Redis API keys.");
  }
}

// ── Initialize Redis & Reconnect Sessions ───────────
(async () => {
  await initializeRedis();

  if (config.media.cleanupEnabled) {
    mediaCleanup.start();
  }

  // Reconnect saved sessions
  await connectionManager.reconnectSavedSessions().catch((error) => {
    logger.error("Failed to reconnect saved sessions: %s", errorToString(error));
  });
})();

// ── Graceful Shutdown ───────────────────────────────
const shutdown = async (signal: string) => {
  logger.info("Received %s, shutting down gracefully...", signal);
  mediaCleanup.stop();
  await connectionManager.shutdown();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
