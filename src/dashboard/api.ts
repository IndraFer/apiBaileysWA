/**
 * Dashboard-specific API routes — SSE events, webhook config, stats.
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import connectionManager from "@/baileys/connectionManager";
import eventBus, { type DashboardEvent } from "@/dashboard/eventBus";
import { dashboardAuthMiddleware } from "@/dashboard/auth";
import { updateSessionMetadata } from "@/baileys/authState";
import config from "@/config";
import { isBun } from "@/lib/runtime";
import { addWebhookLog, clearWebhookLogs, getWebhookLogs } from "@/services/webhookLog";
import fs from "fs";
import path from "path";

const dashboardApi = new Hono();

// Cache package.json at module load
const pkgPath = path.join(process.cwd(), "package.json");
let cachedPkg: Record<string, unknown>;
try {
  cachedPkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
} catch {
  cachedPkg = { name: "Baileys WA API", version: "1.0.0" };
}

dashboardApi.use("*", dashboardAuthMiddleware);

/**
 * GET /dashboard/api/about
 * Project metadata context.
 */
dashboardApi.get("/about", (c) => {
  try {
    const pkg = cachedPkg;
    return c.json({
      success: true,
      data: {
        project: `${pkg.name || "Baileys WA API"}`,
        version: `v${pkg.version || "1.0.0"}`,
        author: `${pkg.author || "KoiN CoDeveloper"}`,
        engine: `Baileys ${(pkg as any).dependencies?.["@whiskeysockets/baileys"]?.replace(/[\^~]/, "") || ""}`,
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
  const pkg = cachedPkg;
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
    if (body.freshAuth === true) {
      // Force-create with new auth state when requested from dashboard.
      await connectionManager.deleteSession(sessionId);
    }

    const result = await connectionManager.createSession(sessionId, {
      clientName: body.clientName,
      webhookUrl: body.webhookUrl,
      webhookSecret: body.webhookSecret,
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
  const body = await c.req.json().catch(() => ({}));
  const webhookUrl = String(body.webhookUrl || "").trim();
  const webhookSecret = String(body.webhookSecret || "").trim();
  const events = Array.isArray(body.events)
    ? body.events.map((e) => String(e).trim()).filter(Boolean)
    : [];

  try {
    const session = connectionManager.getSession(sessionId);
    const nextMetadata = {
      ...session.getSessionMetadata(),
      webhookUrl,
      webhookSecret,
      webhookEvents: events,
    };

    session.updateOptions({ webhookUrl, webhookSecret, webhookEvents: events });
    await updateSessionMetadata(sessionId, nextMetadata);

    return c.json({ success: true, message: "Webhook config updated" });
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 500);
  }
});

/**
 * POST /dashboard/api/sessions/:sessionId/webhook/test
 * Send a test ping to target webhook URL.
 */
dashboardApi.post("/sessions/:sessionId/webhook/test", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json().catch(() => ({}));

  try {
    const session = connectionManager.getSession(sessionId);
    const configuredUrl = session.getOptions().webhookUrl || "";
    const configuredSecret = session.getOptions().webhookSecret || config.webhook.secret || "";
    const webhookUrl = String(body.webhookUrl || configuredUrl).trim();
    const webhookSecret = String(body.webhookSecret || configuredSecret).trim();

    if (!webhookUrl) {
      return c.json({ success: false, message: "Webhook URL is empty" }, 400);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(webhookUrl);
    } catch {
      return c.json({
        success: false,
        message: "Webhook URL is invalid. Use a full URL such as http://127.0.0.1:3001/webhook",
      }, 400);
    }

    const payload = {
      type: "dashboard.webhook.test",
      sessionId,
      timestamp: Date.now(),
      connected: session.isConnected,
      user: session.user,
      source: "dashboard",
    };

    const startedAt = Date.now();
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (webhookSecret) {
        headers["x-webhook-secret"] = webhookSecret;
      }

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const latencyMs = Date.now() - startedAt;
        addWebhookLog({
          sessionId,
          event: "dashboard.webhook.test",
          webhookUrl,
          status: "test-fail",
          attempt: 1,
          httpStatus: response.status,
          latencyMs,
          error: `HTTP ${response.status}`,
        });
        return c.json({
          success: false,
          message: `Webhook test failed: HTTP ${response.status} from ${parsedUrl.origin}${parsedUrl.pathname}`,
        }, 502);
      }

      const latencyMs = Date.now() - startedAt;
      addWebhookLog({
        sessionId,
        event: "dashboard.webhook.test",
        webhookUrl,
        status: "test-success",
        attempt: 1,
        httpStatus: response.status,
        latencyMs,
      });

      return c.json({ success: true, message: "Webhook test succeeded", data: { status: response.status } });
    } catch (err) {
      const errMessage = (err as Error).message;
      const looksLikeTlsCertIssue = /certificate|tls|ssl/i.test(errMessage);
      const looksLikeSocketClosed = /socket connection was closed unexpectedly|socket.*closed/i.test(errMessage);

      const hints: string[] = [];
      if (looksLikeTlsCertIssue) {
        hints.push("TLS certificate issue detected. Use a valid certificate chain or HTTP on trusted local network.");
      }
      if (looksLikeSocketClosed) {
        hints.push("Target endpoint closed the connection. Check protocol mismatch (http vs https), server listener, and reverse-proxy upstream settings.");
      }
      if (parsedUrl.protocol === "https:" && (parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "localhost")) {
        hints.push("For local testing, verify your local server actually serves HTTPS. If not, switch URL to http://...");
      }

      const latencyMs = Date.now() - startedAt;
      const hintText = hints.length ? ` ${hints.join(" ")}` : "";

      addWebhookLog({
        sessionId,
        event: "dashboard.webhook.test",
        webhookUrl,
        status: "test-fail",
        attempt: 1,
        latencyMs,
        error: errMessage,
      });
      return c.json({
        success: false,
        message: `Webhook test failed: ${errMessage}. Target: ${parsedUrl.origin}${parsedUrl.pathname}.${hintText}`.trim(),
      }, 502);
    }
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 500);
  }
});

/**
 * GET /dashboard/api/webhooks/logs
 * Read webhook delivery logs.
 */
dashboardApi.get("/webhooks/logs", (c) => {
  const limit = Number(c.req.query("limit") || "100");
  const sessionId = c.req.query("sessionId") || undefined;
  return c.json({ success: true, data: getWebhookLogs(limit, sessionId) });
});

/**
 * POST /dashboard/api/webhooks/logs/clear
 * Clear webhook delivery logs.
 */
dashboardApi.post("/webhooks/logs/clear", (c) => {
  clearWebhookLogs();
  return c.json({ success: true, message: "Webhook logs cleared" });
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
 * GET /dashboard/api/sessions/:sessionId/chats
 * Get chat list from store (default: 1-on-1 only).
 */
dashboardApi.get("/sessions/:sessionId/chats", (c) => {
  const sessionId = c.req.param("sessionId");
  const isGroup = c.req.query("isGroup") === "true";

  try {
    const session = connectionManager.getSession(sessionId);
    const chats = session.getStore().getChatList(isGroup);
    return c.json({ success: true, data: chats });
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 500);
  }
});

/**
 * GET /dashboard/api/sessions/:sessionId/chats/:jid/messages
 * Get messages from specific chat conversation.
 */
dashboardApi.get("/sessions/:sessionId/chats/:jid/messages", (c) => {
  const sessionId = c.req.param("sessionId");
  const encodedJid = c.req.param("jid");
  const jid = decodeURIComponent(encodedJid);
  const limit = Math.min(Math.max(Number(c.req.query("limit") || "50"), 1), 500);

  try {
    const session = connectionManager.getSession(sessionId);
    const messages = session.getStore().loadMessages(jid, limit);
    return c.json({ success: true, data: messages });
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 500);
  }
});

/**
 * POST /dashboard/api/sessions/:sessionId/chats/send-text
 * Send a text message to 1-on-1 chat.
 */
dashboardApi.post("/sessions/:sessionId/chats/send-text", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json().catch(() => ({}));
  const receiver = String(body.receiver || "").trim();
  const text = String(body.text || "").trim();
  const isGroup = body.isGroup === true;
  const mentions = Array.isArray(body.mentions) ? body.mentions.filter((m) => typeof m === "string") : [];

  if (!receiver) {
    return c.json({ success: false, message: "Receiver is required" }, 400);
  }
  if (!text) {
    return c.json({ success: false, message: "Text message is required" }, 400);
  }

  try {
    const session = connectionManager.getSession(sessionId);
    const { formatPhone, formatGroup } = await import("@/utils/phone");
    const jid = receiver.includes("@")
      ? receiver
      : isGroup
        ? formatGroup(receiver)
        : formatPhone(receiver);

    const result = await session.sendMessage(jid, {
      text,
      mentions: mentions.length > 0 ? mentions : undefined,
    });
    return c.json({
      success: true,
      message: "Message sent",
      data: { key: result?.key, messageTimestamp: result?.messageTimestamp },
    });
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 500);
  }
});

/**
 * POST /dashboard/api/sessions/:sessionId/chats/:jid/read
 * Mark unread messages in the chat as read (dashboard safety helper).
 */
dashboardApi.post("/sessions/:sessionId/chats/:jid/read", async (c) => {
  const sessionId = c.req.param("sessionId");
  const jid = decodeURIComponent(c.req.param("jid"));
  const limit = Math.min(Math.max(Number(c.req.query("limit") || "120"), 1), 500);

  try {
    const session = connectionManager.getSession(sessionId);
    const messages = session.getStore().loadMessages(jid, limit);
    const unreadKeys = messages
      .filter((m) => !m.key.fromMe && m.key.id)
      .map((m) => ({
        remoteJid: m.key.remoteJid,
        id: m.key.id,
        participant: m.key.participant,
        fromMe: false,
      }));

    if (unreadKeys.length > 0) {
      await session.readMessages(unreadKeys as any);
    }

    return c.json({
      success: true,
      message: unreadKeys.length > 0 ? "Messages marked as read" : "No unread messages",
      data: { readCount: unreadKeys.length },
    });
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 500);
  }
});

/**
 * GET /dashboard/api/sessions/:sessionId/groups/:jid/members
 * Get basic group members metadata.
 */
dashboardApi.get("/sessions/:sessionId/groups/:jid/members", async (c) => {
  const sessionId = c.req.param("sessionId");
  const jid = decodeURIComponent(c.req.param("jid"));

  try {
    const session = connectionManager.getSession(sessionId);
    const metadata = await session.groupMetadata(jid);

    return c.json({
      success: true,
      data: {
        id: metadata.id,
        subject: metadata.subject,
        participants: (metadata.participants || []).map((p) => ({
          id: p.id,
          admin: p.admin || null,
        })),
      },
    });
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 500);
  }
});

/**
 * GET /dashboard/api/groups/:sessionId/list
 * List groups for dashboard Groups page.
 */
dashboardApi.get("/groups/:sessionId/list", async (c) => {
  const sessionId = c.req.param("sessionId");

  try {
    const session = connectionManager.getSession(sessionId);
    const groups = await session.groupFetchAllParticipating();
    const groupList = Object.values(groups || {}).map((g: any) => ({
      id: g.id,
      subject: g.subject,
      participants: g.participants || [],
      size: Array.isArray(g.participants) ? g.participants.length : undefined,
    }));

    return c.json({ success: true, data: groupList });
  } catch (err) {
    return c.json({ success: false, message: (err as Error).message }, 500);
  }
});

/**
 * POST /dashboard/api/groups/:sessionId/create
 * Create a group for dashboard Groups page.
 */
dashboardApi.post("/groups/:sessionId/create", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json().catch(() => ({}));
  const groupName = String(body.groupName || "").trim();
  const participants = Array.isArray(body.participants)
    ? body.participants.map((p) => String(p).trim()).filter(Boolean)
    : [];

  if (!groupName) {
    return c.json({ success: false, message: "Group name is required" }, 400);
  }
  if (participants.length === 0) {
    return c.json({ success: false, message: "At least one participant is required" }, 400);
  }

  try {
    const session = connectionManager.getSession(sessionId);
    const { formatPhone } = await import("@/utils/phone");
    const normalizedParticipants = participants.map((p) => formatPhone(p));
    const result = await session.groupCreate(groupName, normalizedParticipants);

    return c.json({
      success: true,
      message: "Group created",
      data: {
        id: result.id,
        subject: result.subject,
        participants: result.participants || [],
      },
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

/**
 * GET /dashboard/api/config/simulation
 * Get WA Web behavior simulation settings (read-only).
 */
dashboardApi.get("/config/simulation", (c) => {
  return c.json({
    success: true,
    data: {
      typingBeforeSend: config.simulation.typingBeforeSend,
      typingDelayMinMs: config.simulation.typingDelayMinMs,
      typingDelayMaxMs: config.simulation.typingDelayMaxMs,
      autoReadMessages: config.simulation.autoReadMessages,
      autoMarkOnline: config.simulation.autoMarkOnline,
    },
  });
});

export default dashboardApi;
