import type { WAMessage } from "@whiskeysockets/baileys";
import {
  isJidBot,
  isJidBroadcast,
  isJidGroup,
  isJidMetaAI,
  isJidNewsletter,
  isJidStatusBroadcast,
  META_AI_JID,
  OFFICIAL_BIZ_JID,
  PSA_WID,
  SERVER_JID,
} from "@whiskeysockets/baileys";
import config from "@/config";

/**
 * Determine if messages from a JID should be ignored based on configuration.
 */
/**
 * WhatsApp's own accounts, by number. The same account is addressed as @c.us or
 * @s.whatsapp.net depending on the payload, and Baileys keeps the constants in
 * @c.us form, so compare the user part instead of the full JID.
 */
const WHATSAPP_OFFICIAL_NUMBERS = new Set(
  [PSA_WID, OFFICIAL_BIZ_JID, META_AI_JID, SERVER_JID].map((entry) => entry.split("@")[0]),
);

export function shouldIgnoreJid(jid: string): boolean {
  const {
    ignoreGroupMessages,
    ignoreStatusMessages,
    ignoreBroadcastMessages,
    ignoreNewsletterMessages,
    ignoreBotMessages,
    ignoreMetaAiMessages,
  } = config.baileys;

  // WhatsApp's own accounts. They send ordinary-looking DMs (support replies,
  // account notices), so they need an explicit rule.
  const userPart = jid.split("@")[0]?.split(":")[0] ?? "";
  if (userPart && WHATSAPP_OFFICIAL_NUMBERS.has(userPart)) return true;

  const ignoredSenders = config.baileys.ignoredSenders;
  if (ignoredSenders.length > 0) {
    const normalized = jid.trim().toLowerCase();
    if (ignoredSenders.some((entry) => entry.toLowerCase() === normalized)) return true;
  }

  if (isJidGroup(jid) && ignoreGroupMessages) return true;
  if (isJidStatusBroadcast(jid) && ignoreStatusMessages) return true;
  if (isJidBroadcast(jid) && !isJidStatusBroadcast(jid) && ignoreBroadcastMessages) return true;
  if (isJidNewsletter(jid) && ignoreNewsletterMessages) return true;
  if (isJidBot(jid) && ignoreBotMessages) return true;
  if (isJidMetaAI(jid) && ignoreMetaAiMessages) return true;

  return false;
}

/**
 * System messages are notices from WhatsApp itself (security, account changes,
 * revokes, E2E setup), not something a customer wrote. They must never be
 * answered by the AI or by a static reply, whatever JID they arrive on.
 */
export function isSystemMessage(message: Partial<WAMessage> | null | undefined): boolean {
  if (!message) return false;
  if (message.messageStubType !== undefined && message.messageStubType !== null) return true;
  if (message.message?.protocolMessage) return true;
  if (message.message?.senderKeyDistributionMessage && !message.message?.conversation) return true;
  return false;
}
