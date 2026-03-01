import { Hono } from "hono";
import connectionManager from "@/baileys/connectionManager";
import { BaileysNotConnectedError } from "@/baileys/connection";
import { authMiddleware } from "@/middleware/auth";
import { sessionValidator } from "@/middleware/sessionValidator";
import { createBroadcastJob, getBroadcastJob, cancelBroadcastJob, listBroadcastJobs } from "@/services/broadcastQueue";
import { formatPhone, formatGroup } from "@/utils/phone";
import { success, error } from "@/lib/response";

const chatRoutes = new Hono();

chatRoutes.use("*", authMiddleware);

/**
 * POST /chats/:sessionId/send
 * Send a message (text, image, video, audio, document, sticker, location, contact, poll).
 */
chatRoutes.post("/:sessionId/send", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const { receiver, message, isGroup, quoted } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    const jid = isGroup ? formatGroup(receiver) : formatPhone(receiver);

    // Optionally verify number exists
    if (!isGroup) {
      const exists = await session.isOnWhatsApp(jid);
      if (!exists) {
        return error(c, "The receiver number is not registered on WhatsApp", 400);
      }
    }

    const result = await session.sendMessage(jid, message, { quoted });

    return success(c, {
      key: result?.key,
      messageTimestamp: result?.messageTimestamp,
    }, "Message sent successfully");
  } catch (err) {
    if (err instanceof BaileysNotConnectedError) {
      return error(c, err.message, 404);
    }
    return error(c, `Failed to send message: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/send-bulk
 * Send bulk messages with anti-spam delays.
 * Returns a broadcast job ID for tracking progress.
 */
chatRoutes.post("/:sessionId/send-bulk", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const { messages } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return error(c, "Messages array is required and must not be empty", 400);
  }

  try {
    const job = await createBroadcastJob(sessionId, messages);
    return success(c, {
      jobId: job.id,
      total: job.total,
      status: job.status,
    }, "Broadcast job created");
  } catch (err) {
    return error(c, `Failed to create broadcast job: ${(err as Error).message}`);
  }
});

/**
 * GET /chats/:sessionId/broadcast/:jobId
 * Get broadcast job status.
 */
chatRoutes.get("/:sessionId/broadcast/:jobId", sessionValidator, (c) => {
  const jobId = c.req.param("jobId");
  const job = getBroadcastJob(jobId);
  if (!job) return error(c, "Broadcast job not found", 404);
  return success(c, job);
});

/**
 * DELETE /chats/:sessionId/broadcast/:jobId
 * Cancel a running broadcast job.
 */
chatRoutes.delete("/:sessionId/broadcast/:jobId", sessionValidator, (c) => {
  const jobId = c.req.param("jobId");
  const cancelled = cancelBroadcastJob(jobId);
  if (!cancelled) return error(c, "Job not found or not running", 404);
  return success(c, null, "Broadcast job cancelled");
});

/**
 * GET /chats/:sessionId/broadcast
 * List all broadcast jobs for a session.
 */
chatRoutes.get("/:sessionId/broadcast", sessionValidator, (c) => {
  const sessionId = c.req.param("sessionId");
  const jobs = listBroadcastJobs(sessionId);
  return success(c, jobs);
});

/**
 * POST /chats/:sessionId/forward
 * Forward a message.
 */
chatRoutes.post("/:sessionId/forward", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const { receiver, isGroup, forward } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    const jid = isGroup ? formatGroup(receiver) : formatPhone(receiver);
    const store = session.getStore();

    const messages = store.loadMessages(forward.remoteJid, 25);
    const msgToForward = messages.find((m) => m.key.id === forward.id);

    if (!msgToForward) {
      return error(c, "Message not found in store", 404);
    }

    await session.sendMessage(jid, { forward: msgToForward });
    return success(c, null, "Message forwarded successfully");
  } catch (err) {
    return error(c, `Failed to forward message: ${(err as Error).message}`);
  }
});

/**
 * DELETE /chats/:sessionId/message
 * Delete a message for everyone.
 */
chatRoutes.delete("/:sessionId/message", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const { jid, key } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    await session.deleteMessage(jid, key);
    return success(c, null, "Message deleted successfully");
  } catch (err) {
    return error(c, `Failed to delete message: ${(err as Error).message}`);
  }
});

/**
 * PATCH /chats/:sessionId/message
 * Edit a previously sent message.
 */
chatRoutes.patch("/:sessionId/message", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const { jid, key, messageContent } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    const result = await session.editMessage(jid, key, messageContent);
    return success(c, {
      key: result?.key,
      messageTimestamp: result?.messageTimestamp,
    }, "Message edited successfully");
  } catch (err) {
    return error(c, `Failed to edit message: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/read
 * Mark messages as read.
 */
chatRoutes.post("/:sessionId/read", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();

  try {
    const session = connectionManager.getSession(sessionId);
    await session.readMessages(body.keys);
    return success(c, null, "Messages marked as read");
  } catch (err) {
    return error(c, `Failed to read messages: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/presence
 * Send presence update (typing, recording, etc.).
 */
chatRoutes.post("/:sessionId/presence", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const { type, jid } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    await session.sendPresenceUpdate(type, jid);
    return success(c, null, "Presence updated");
  } catch (err) {
    return error(c, `Failed to send presence: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/on-whatsapp
 * Check if phone numbers are registered on WhatsApp.
 */
chatRoutes.post("/:sessionId/on-whatsapp", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  const { jids } = body;

  try {
    const session = connectionManager.getSession(sessionId);
    const results = await session.onWhatsApp(...jids);
    return success(c, results);
  } catch (err) {
    return error(c, `Failed to check WhatsApp status: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/chat-modify
 * Chat modification (mark read/unread, archive, etc.).
 */
chatRoutes.post("/:sessionId/chat-modify", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();

  try {
    const session = connectionManager.getSession(sessionId);
    await session.chatModify(body.mod, body.jid);
    return success(c, null, "Chat modified successfully");
  } catch (err) {
    return error(c, `Failed to modify chat: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/fetch-history
 * Fetch message history.
 */
chatRoutes.post("/:sessionId/fetch-history", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();

  try {
    const session = connectionManager.getSession(sessionId);
    await session.fetchMessageHistory(body.count, body.oldestMsgKey, body.oldestMsgTimestamp);
    return success(c, null, "Message history fetch initiated");
  } catch (err) {
    return error(c, `Failed to fetch history: ${(err as Error).message}`);
  }
});

/**
 * POST /chats/:sessionId/send-receipts
 * Send message receipts.
 */
chatRoutes.post("/:sessionId/send-receipts", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();

  try {
    const session = connectionManager.getSession(sessionId);
    await session.sendReceipts(body.keys, body.type ?? "read");
    return success(c, null, "Receipts sent");
  } catch (err) {
    return error(c, `Failed to send receipts: ${(err as Error).message}`);
  }
});

/**
 * GET /chats/:sessionId/list
 * Get chat list from in-memory store.
 */
chatRoutes.get("/:sessionId/list", sessionValidator, (c) => {
  const sessionId = c.req.param("sessionId");
  const isGroup = c.req.query("isGroup") === "true";

  try {
    const session = connectionManager.getSession(sessionId);
    const chatList = session.getStore().getChatList(isGroup);
    return success(c, chatList);
  } catch (err) {
    return error(c, `Failed to get chat list: ${(err as Error).message}`);
  }
});

export default chatRoutes;
