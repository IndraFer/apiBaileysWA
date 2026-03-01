/**
 * Dashboard-specific API routes — SSE events, webhook config, stats.
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import connectionManager from "@/baileys/connectionManager";
import eventBus, { type DashboardEvent } from "@/dashboard/eventBus";
import { dashboardAuthMiddleware } from "@/dashboard/auth";
import config from "@/config";
import { isBun } from "@/lib/runtime";
import fs from "fs";
import path from "path";

const dashboardApi = new Hono();

dashboardApi.use("*", dashboardAuthMiddleware);

/**
 * GET /dashboard/api/about
 * Project metadata context.
 */
dashboardApi.get("/about", (c) => {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return c.json({
      success: true,
      data: {
        project: `${pkg.name || "Baileys WA API"}`,
        version: `v${pkg.version || "1.0.0"}`,
        author: `${pkg.author || "KoiN CoDeveloper"}`,
        engine: `Baileys ${pkg.dependencies?.["@whiskeysockets/baileys"]?.replace(/[\^~]/, "") || ""}`,
        runtime: isBun ? "Bun + Hono" : "Node.js + Hono",
      }
    });
  } catch (err) {
    return c.json({
      success: false,
      data: {
        project: "Baileys WA API",
        version: "Unknown",
        author: "KoiN CoDeveloper",
        engine: "Baileys",
        runtime: isBun ? "Bun" : "Node.js"
      }
    });
  }
});

/**
 * GET /dashboard/api/stats
 * Overview statistics.
 */
dashboardApi.get("/stats", (c) => {
  const pkgPath = path.join(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const sessions = connectionManager.listSessions();
  return c.json({
    success: true,
    data: {
      totalSessions: sessions.length,
      connectedSessions: sessions.filter((s) => s.connected).length,
      disconnectedSessions: sessions.filter((s) => !s.connected).length,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      environment: config.env,
      redisEnabled: config.redis.enabled,
      version: `v${pkg.version || "1.0.0"}`,
    },
  });
});

/**
 * GET /dashboard/api/sessions
 * List all sessions with detailed status.
 */
dashboardApi.get("/sessions", (c) => {
  const sessions = connectionManager.listSessions();
  return c.json({ success: true, data: sessions });
});

/**
 * POST /dashboard/api/sessions/:sessionId
 * Create a new session.
 */
dashboardApi.post("/sessions/:sessionId", async (c) => {
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

    return c.json({
      success: true,
      message: result.pairingCode
        ? "Pairing code generated"
        : "Session created — scan QR code",
      data: result,
    });
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 500);
  }
});

/**
 * GET /dashboard/api/sessions/:sessionId
 * Get session status.
 */
dashboardApi.get("/sessions/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");
  const status = connectionManager.getSessionStatus(sessionId);
  return c.json({ success: true, data: status });
});

/**
 * DELETE /dashboard/api/sessions/:sessionId
 * Delete a session.
 */
dashboardApi.delete("/sessions/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  try {
    await connectionManager.deleteSession(sessionId);
    return c.json({ success: true, message: "Session deleted" });
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 500);
  }
});

/**
 * PUT /dashboard/api/sessions/:sessionId/webhook
 * Update webhook config for a session.
 */
dashboardApi.put("/sessions/:sessionId/webhook", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const { webhookUrl, events } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    session.updateOptions({ webhookUrl });
    return c.json({ success: true, message: "Webhook config updated" });
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 500);
  }
});

/**
 * POST /dashboard/api/sessions/:sessionId/send
 * Send a message from dashboard.
 */
dashboardApi.post("/sessions/:sessionId/send", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const { receiver, message, isGroup } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    const { formatPhone, formatGroup } = await import("@/utils/phone");
    const jid = isGroup ? formatGroup(receiver) : formatPhone(receiver);
    const result = await session.sendMessage(jid, message);
    return c.json({
      success: true,
      message: "Message sent",
      data: { key: result?.key },
    });
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 500);
  }
});

/**
 * GET /dashboard/api/events/stream
 * SSE endpoint for real-time event monitoring.
 */
dashboardApi.get("/events/stream", (c) => {
  return streamSSE(c, async (stream) => {
    const sessionFilter = c.req.query("session");
    const eventFilter = c.req.query("event");

    const handler = (ev: DashboardEvent) => {
      if (sessionFilter && ev.sessionId !== sessionFilter) return;
      if (eventFilter && !ev.event.includes(eventFilter)) return;

      stream.writeSSE({
        event: "baileys-event",
        data: JSON.stringify(ev),
        id: `${ev.timestamp}`,
      });
    };

    eventBus.on("baileys-event", handler);

    // Send heartbeat
    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: "heartbeat", data: new Date().toISOString() });
    }, 30000);

    // Keep alive until client disconnects
    stream.onAbort(() => {
      eventBus.off("baileys-event", handler);
      clearInterval(heartbeat);
    });

    // Wait indefinitely (stream stays open)
    await new Promise(() => {});
  });
});

/**
 * GET /dashboard/api/events/recent
 * Get recent events (non-SSE).
 */
dashboardApi.get("/events/recent", (c) => {
  const limit = Number(c.req.query("limit") || 50);
  const events = eventBus.getRecentEvents(limit);
  return c.json({ success: true, data: events });
});

/**
 * POST /dashboard/api/events/clear
 * Clear event buffer.
 */
dashboardApi.post("/events/clear", (c) => {
  eventBus.clearEvents();
  return c.json({ success: true, message: "Events cleared" });
});

export default dashboardApi;
