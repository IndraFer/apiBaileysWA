import type { WAMessage } from "@whiskeysockets/baileys";
import {
  isJidBot,
  isJidBroadcast,
  isJidGroup,
  isJidMetaAI,
  isJidNewsletter,
  isJidStatusBroadcast,
} from "@whiskeysockets/baileys";
import config from "@/config";

/**
 * Determine if messages from a JID should be ignored based on configuration.
 */
export function shouldIgnoreJid(jid: string): boolean {
  const {
    ignoreGroupMessages,
    ignoreStatusMessages,
    ignoreBroadcastMessages,
    ignoreNewsletterMessages,
    ignoreBotMessages,
    ignoreMetaAiMessages,
  } = config.baileys;

  // WhatsApp's own system account: order updates, security notices, account
  // warnings. It is a normal-looking DM, so it needs an explicit rule.
  if (jid === "0@s.whatsapp.net") return true;

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
