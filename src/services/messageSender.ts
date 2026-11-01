/**
 * Unified outbound sender.
 *
 * Resolves a session from its id or bound phone number, normalizes the receiver
 * into a JID, applies the group policy and forwards the built content to
 * Baileys. Kept separate from the route so it can be reused by future
 * integrations.
 */
import type { AnyMessageContent, WAMessage } from "@whiskeysockets/baileys";
import connectionManager from "@/baileys/connectionManager";
import config from "@/config";
import type { UnifiedSendInput } from "@/schemas/message";
import { extractPhone, formatGroup, formatPhone } from "@/utils/phone";

export type SendErrorStatus = 400 | 403 | 404 | 409;

export class MessageSendError extends Error {
  readonly status: SendErrorStatus;

  constructor(message: string, status: SendErrorStatus = 400) {
    super(message);
    this.name = "MessageSendError";
    this.status = status;
  }
}

/** Resolve `from` by session id first, then by the phone bound to a session. */
export function resolveSessionId(ref: string): string {
  const value = ref.trim();
  if (connectionManager.hasSession(value)) return value;

  const digits = value.replace(/\D/g, "");
  if (digits) {
    for (const session of connectionManager.listSessions()) {
      const user = session.user as { id?: string } | null;
      const phone = user?.id ? extractPhone(String(user.id)) : "";
      if (phone && (phone === digits || phone === value)) return session.sessionId;
    }
  }

  throw new MessageSendError(`Session "${ref}" not found or not connected`, 404);
}

/**
 * Normalize the receiver and enforce the group policy.
 *
 * Group sending is disabled by default: it is the highest-risk pattern for an
 * unofficial WhatsApp client. Enabling it also narrows the targets when an
 * allowlist is configured.
 */
function resolveTarget(input: UnifiedSendInput): { jid: string; isGroup: boolean } {
  const receiver = input.receiver.trim();
  const wantsGroup = input.isGroup || receiver.endsWith("@g.us");

  if (!wantsGroup) return { jid: formatPhone(receiver), isGroup: false };

  const jid = formatGroup(receiver);
  if (!config.messaging.allowGroupSend) {
    throw new MessageSendError(
      "Group messages are disabled (set ALLOW_GROUP_SEND=true to enable)",
      403,
    );
  }

  const allowed = config.messaging.allowedGroupJids;
  if (allowed.length > 0) {
    const numeric = jid.replace(/@g\.us$/, "");
    if (!allowed.includes(jid) && !allowed.includes(numeric)) {
      throw new MessageSendError("Group is not in ALLOWED_GROUP_JIDS", 403);
    }
  }

  return { jid, isGroup: true };
}

function contentFor(input: UnifiedSendInput): AnyMessageContent {
  switch (input.type) {
    case "image":
      return { image: { url: input.media?.url ?? "" }, caption: input.messages };
    case "document":
      return {
        document: { url: input.media?.url ?? "" },
        mimetype: input.media?.mimetype ?? "application/octet-stream",
        fileName: input.media?.filename ?? "document",
        caption: input.messages,
      };
    case "location": {
      const location = input.location;
      if (!location) throw new MessageSendError("location is required", 400);
      return {
        location: {
          degreesLatitude: location.latitude,
          degreesLongitude: location.longitude,
          name: location.name,
          address: location.address,
        },
      };
    }
    default:
      return { text: input.messages ?? "" };
  }
}

export async function sendUnifiedMessage(input: UnifiedSendInput) {
  const { jid, isGroup } = resolveTarget(input);
  const sessionId = resolveSessionId(input.from);

  const status = connectionManager.getSessionStatus(sessionId);
  if (!status.exists || !status.connected) {
    throw new MessageSendError(`Session "${sessionId}" is not connected`, 409);
  }

  const session = connectionManager.getSession(sessionId);

  if (!isGroup) {
    const exists = await session.isOnWhatsApp(jid);
    if (!exists) {
      throw new MessageSendError("The receiver number is not registered on WhatsApp", 400);
    }
  }

  const result = await session.sendMessage(jid, contentFor(input), {
    quoted: input.quoted as WAMessage | undefined,
  });

  return {
    messageId: result?.key?.id ?? null,
    to: jid,
    type: input.type,
    timestamp: Number(result?.messageTimestamp ?? Math.floor(Date.now() / 1000)),
  };
}
