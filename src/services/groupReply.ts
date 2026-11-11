/**
 * Group auto-reply policy.
 *
 * The bot may sit in many groups, so "can it reply here" is not a group
 * question — it is a question about who is allowed to trigger a reply:
 *
 *   all      - any member, any group (the bot is the room's responder)
 *   senders  - only listed people, in any group
 *   mention  - only when the bot is @mentioned or someone replies to its message
 *
 * This gate suppresses automatic replies only. Messages are still stored and
 * webhooks still fire, so an agent can always answer manually.
 *
 * Identity matching crosses PN/LID both ways: a group message can arrive with a
 * LID participant while the operator typed a phone number, and a member may
 * mention the bot's LID rather than its phone number.
 */
import type { GroupReplyConfig, GroupReplyMode } from "@/baileys/types";

export interface ResolvedGroupReply {
  mode: GroupReplyMode;
  senders: string[];
}

/** Default mode. `mention` keeps the bot quiet unless it is addressed. */
export const DEFAULT_GROUP_REPLY_MODE: GroupReplyMode = "mention";

const VALID_MODES: readonly GroupReplyMode[] = ["all", "senders", "mention"];

export function resolveGroupReply(input?: GroupReplyConfig): ResolvedGroupReply {
  const mode = VALID_MODES.includes(input?.mode as GroupReplyMode)
    ? (input?.mode as GroupReplyMode)
    : DEFAULT_GROUP_REPLY_MODE;
  return { mode, senders: uniqueValues(input?.senders) };
}

function uniqueValues(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/** Drop the multi-device suffix (`628…:12@s.whatsapp.net` → `628…@s.whatsapp.net`). */
export function normalizeIdentity(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+(?=@)/, "");
}

/** Match a bare phone number against either a PN or a LID JID. */
function digitsOf(identity: string): string {
  const local = normalizeIdentity(identity).split("@")[0] ?? "";
  return local.replace(/\D/g, "");
}

/** Every comparable form of one identity, including PN/LID aliases. */
export function identityKeys(
  value: string | null | undefined,
  aliasOf?: (identity: string) => string[],
): Set<string> {
  const keys = new Set<string>();
  // PN/LID aliases are bidirectional, so a missing visited set would loop.
  const visited = new Set<string>();
  const add = (candidate: string | null | undefined) => {
    const identity = normalizeIdentity(candidate);
    if (!identity || visited.has(identity)) return;
    visited.add(identity);
    keys.add(identity);
    const digits = digitsOf(identity);
    if (digits) keys.add(digits);
    if (aliasOf) for (const alias of aliasOf(identity)) add(alias);
  };
  add(value);
  return keys;
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

export interface GroupAddressing {
  /** JIDs listed in contextInfo.mentionedJid. */
  mentioned: string[];
  /** Author of the quoted message, when the message is a reply. */
  quotedParticipant: string | null;
}

/** Structural view of a message; avoids importing the whole proto type. */
export interface MessageLike {
  message?: unknown;
  key?: { participant?: string | null } | null;
}

/**
 * Read addressing facts from any message content type. Only `conversation` has
 * no contextInfo; image/video/document/audio/sticker/location replies all do.
 */
export function readGroupAddressing(message: MessageLike | null | undefined) {
  const facts: GroupAddressing = { mentioned: [], quotedParticipant: null };
  const content = message?.message;
  if (!content || typeof content !== "object") return facts;

  for (const value of Object.values(content as Record<string, unknown>)) {
    const contextInfo = (value as { contextInfo?: Record<string, unknown> } | null)?.contextInfo;
    if (!contextInfo || typeof contextInfo !== "object") continue;

    const mentioned = contextInfo.mentionedJid;
    if (Array.isArray(mentioned)) {
      for (const jid of mentioned) {
        if (typeof jid === "string" && jid) facts.mentioned.push(jid);
      }
    }

    const participant = contextInfo.participant;
    if (typeof participant === "string" && participant && !facts.quotedParticipant) {
      facts.quotedParticipant = participant;
    }
  }

  return facts;
}

export interface GroupReplyContext {
  /** JIDs identifying this account, normally both the PN and the LID. */
  selfJids: string[];
  /** Resolve PN↔LID aliases for one identity. */
  aliasOf?: (identity: string) => string[];
}

export type GroupReplyReason =
  | "all"
  | "sender_allowed"
  | "mentioned"
  | "quoted_self"
  | "sender_not_allowed"
  | "not_addressed"
  | "no_participant";

export interface GroupReplyDecision {
  reply: boolean;
  reason: GroupReplyReason;
}

export interface GroupReplyInput extends GroupAddressing {
  /** Group participant that sent the message. */
  participant?: string | null;
}

export function shouldReplyInGroup(
  input: GroupReplyInput,
  config: ResolvedGroupReply,
  context: GroupReplyContext,
): GroupReplyDecision {
  if (config.mode === "all") return { reply: true, reason: "all" };

  if (config.mode === "senders") {
    const participant = String(input.participant ?? "").trim();
    if (!participant) return { reply: false, reason: "no_participant" };
    const allowed = new Set<string>();
    for (const sender of config.senders) {
      for (const key of identityKeys(sender, context.aliasOf)) allowed.add(key);
    }
    if (allowed.size === 0) return { reply: false, reason: "sender_not_allowed" };
    if (intersects(identityKeys(participant, context.aliasOf), allowed)) {
      return { reply: true, reason: "sender_allowed" };
    }
    return { reply: false, reason: "sender_not_allowed" };
  }

  // mention: only an explicit address counts.
  const self = new Set<string>();
  for (const jid of context.selfJids) {
    for (const key of identityKeys(jid, context.aliasOf)) self.add(key);
  }
  for (const mentioned of input.mentioned) {
    if (intersects(identityKeys(mentioned, context.aliasOf), self)) {
      return { reply: true, reason: "mentioned" };
    }
  }
  if (input.quotedParticipant) {
    if (intersects(identityKeys(input.quotedParticipant, context.aliasOf), self)) {
      return { reply: true, reason: "quoted_self" };
    }
  }
  return { reply: false, reason: "not_addressed" };
}

/** Convenience wrapper: read the addressing facts out of a WAMessage. */
export function shouldReplyToGroupMessage(
  message: MessageLike | null | undefined,
  config: ResolvedGroupReply,
  context: GroupReplyContext,
): GroupReplyDecision {
  return shouldReplyInGroup(
    { ...readGroupAddressing(message), participant: message?.key?.participant ?? null },
    config,
    context,
  );
}
