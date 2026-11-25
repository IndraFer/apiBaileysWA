/**
 * Agent reply route.
 *
 * The AI webhook driver hands an inbound message to an external agent, and that
 * agent answers over HTTP. Those replies must not talk over a human, but they
 * arrive on the same wire as ordinary business sends — and the generic send route
 * cannot tell them apart. Blocking that route during a takeover would also block
 * legitimate transactional mail.
 *
 * So the agent gets its own route, authenticated with `AI_SERVICE_TOKEN`, which
 * re-checks ownership at the moment of sending. This is deliberately separate
 * from `/chats/:sessionId/send`.
 */
import { timingSafeEqual } from "node:crypto";
import type { AnyMessageContent, WAMessage } from "@whiskeysockets/baileys";
import { Hono } from "hono";
import { HumanTakeoverError } from "@/baileys/connection";
import connectionManager from "@/baileys/connectionManager";
import config from "@/config";
import logger from "@/lib/logger";
import { error, success } from "@/lib/response";
import { sessionValidator } from "@/middleware/sessionValidator";
import { sendMessageSchema } from "@/schemas/chat";
import { formatGroup, formatPhone } from "@/utils/phone";

const agentRoutes = new Hono();

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

agentRoutes.use("*", async (c, next) => {
  const expected = config.ai.serviceToken;
  // No token configured means this route is not available at all: an
  // unauthenticated reply path would be worse than the race it fixes.
  if (!expected) return c.json({ success: false, message: "Not found" }, 404);

  const header = c.req.header("authorization") || "";
  const provided = /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : "";
  if (!provided || !tokenMatches(provided, expected)) {
    return error(c, "Unauthorized", 401);
  }

  await next();
});

/**
 * POST /agent/:sessionId/reply
 * Send an agent reply, unless a human owns the conversation right now.
 */
agentRoutes.post("/:sessionId/reply", sessionValidator, async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const parsed = sendMessageSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return error(c, parsed.error.issues[0].message, 400);

  const { receiver, message, isGroup, quoted } = parsed.data;

  try {
    const session = connectionManager.getSession(sessionId);
    const isLid = !isGroup && /^\d+(?::\d+)?@lid$/.test(receiver);
    const jid = isGroup ? formatGroup(receiver) : isLid ? receiver : formatPhone(receiver);
    session.assertAutomationAllowed(jid);
    if (!isGroup && !isLid && !(await session.isOnWhatsApp(jid))) {
      return error(c, "The receiver number is not registered on WhatsApp", 400);
    }
    const result = await session.sendAutomaticMessage(jid, message as AnyMessageContent, {
      quoted: quoted as WAMessage,
    });
    return success(
      c,
      { key: result?.key, messageTimestamp: result?.messageTimestamp },
      "Reply sent",
    );
  } catch (err) {
    if (err instanceof HumanTakeoverError) {
      logger.debug(
        "[AgentReply] refused for %s: conversation is human-owned until %s",
        sessionId,
        new Date(err.until).toISOString(),
      );
      return c.json(
        {
          success: false,
          message: err.message,
          data: { humanOwned: true, humanOwnedUntil: err.until },
        },
        409,
      );
    }
    return error(c, (err as Error).message, 400);
  }
});

export default agentRoutes;
