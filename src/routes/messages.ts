/**
 * Unified send endpoint for third-party integrations.
 *
 * POST /messages — one request shape for text, image, document and location.
 * Authentication uses the API key middleware; keys can be scoped to sessions.
 * Every call is audited (without the token and, by default, without the body).
 */
import { type Context, Hono } from "hono";
import config from "@/config";
import { error, success } from "@/lib/response";
import { type AuthData, authMiddleware } from "@/middleware/auth";
import { sendRateLimit } from "@/middleware/rateLimit";
import { unifiedSendSchema } from "@/schemas/message";
import { maskReceiver, recordApiCall } from "@/services/apiAuditLog";
import { keyAllowsSession } from "@/services/apiKeys";
import { MessageSendError, resolveSessionId, sendUnifiedMessage } from "@/services/messageSender";

const messageRoutes = new Hono();

/** Context accessor keeps the route independent of Hono env generics. */
function authPayload(c: Context): AuthData | undefined {
  return c.get("auth") as AuthData | undefined;
}

messageRoutes.use("*", authMiddleware);

messageRoutes.post("/", sendRateLimit, async (c) => {
  const startedAt = Date.now();
  const auth = authPayload(c);
  const body = await c.req.json().catch(() => ({}));

  const audit = (
    status: number,
    info: { session?: string | null; receiver?: string | null; type: string },
  ) => {
    recordApiCall({
      timestamp: new Date().toISOString(),
      requestId: c.req.header("x-request-id") ?? "",
      keyId: auth?.keyId ?? null,
      keyLabel: auth?.label ?? null,
      session: info.session ?? null,
      receiver: info.receiver ? maskReceiver(String(info.receiver)) : null,
      type: info.type,
      status,
      latencyMs: Date.now() - startedAt,
      ip:
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
        c.req.header("x-real-ip") ??
        "unknown",
      body: config.auditLog.body ? JSON.stringify(body).slice(0, 2000) : undefined,
    });
  };

  const parsed = unifiedSendSchema.safeParse(body);
  if (!parsed.success) {
    audit(400, {
      type:
        typeof (body as { type?: unknown }).type === "string"
          ? String((body as { type?: string }).type)
          : "unknown",
    });
    return error(c, parsed.error.issues[0].message, 400);
  }

  const input = parsed.data;
  let session: string | null = null;

  try {
    session = resolveSessionId(input.from);

    if (!keyAllowsSession(auth?.sessions, session)) {
      audit(403, { session, receiver: input.receiver, type: input.type });
      return error(c, "API key is not scoped to this session", 403);
    }

    const data = await sendUnifiedMessage(input);
    audit(200, { session, receiver: data.to, type: input.type });
    return success(c, data, "Message sent successfully");
  } catch (err) {
    const status = err instanceof MessageSendError ? err.status : 500;
    audit(status, { session, receiver: input.receiver, type: input.type });

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
