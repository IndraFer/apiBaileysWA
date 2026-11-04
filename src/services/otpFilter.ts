/**
 * Optional auto-reply suppression for OTP/verification messages.
 *
 * This is a deny/ignore list, not an allowlist: matching senders or keywords
 * skip the AI and static auto-reply. Messages are still stored and webhooks
 * still fire; only automatic responses are suppressed.
 *
 * No keyword is built in. Operators maintain both lists; empty lists disable
 * that layer. Exclude keywords act as an escape hatch for customer questions
 * such as "I did not receive the code".
 */
import type { OtpFilterConfig } from "@/baileys/types";

export interface ResolvedOtpFilter {
  enabled: boolean;
  ignoredSenders: string[];
  keywordFilter: boolean;
  keywords: string[];
  excludeKeywords: string[];
}

function uniqueLines(values: string[] | undefined, lower = false): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) continue;
    const key = lower ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function resolveOtpFilter(input?: OtpFilterConfig): ResolvedOtpFilter {
  return {
    enabled: input?.enabled ?? false,
    ignoredSenders: uniqueLines(input?.ignoredSenders),
    keywordFilter: input?.keywordFilter ?? false,
    keywords: uniqueLines(input?.keywords, true),
    excludeKeywords: uniqueLines(input?.excludeKeywords, true),
  };
}

function senderKeys(value: string): string[] {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/:\d+(?=@)/, "");
  const keys = new Set<string>([normalized]);
  const local = normalized.split("@")[0] ?? "";
  const digits = local.replace(/\D/g, "");
  if (digits) keys.add(digits);
  return [...keys];
}

function targetKeys(remoteJid?: string | null, participant?: string | null): string[] {
  const values = [remoteJid, participant].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return values.flatMap(senderKeys);
}

export interface OtpMatchInput {
  remoteJid?: string | null;
  participant?: string | null;
  text?: string | null;
}

export interface OtpMatchResult {
  ignored: boolean;
  reason?: "sender" | "keyword";
}

export function matchOtpFilter(input: OtpMatchInput, filter: ResolvedOtpFilter): OtpMatchResult {
  if (!filter.enabled) return { ignored: false };

  const targets = targetKeys(input.remoteJid, input.participant);
  if (filter.ignoredSenders.length > 0) {
    const ignored = filter.ignoredSenders.flatMap(senderKeys).filter(Boolean);
    if (targets.some((target) => ignored.includes(target))) {
      return { ignored: true, reason: "sender" };
    }
  }

  if (filter.keywordFilter && filter.keywords.length > 0) {
    const text = String(input.text ?? "").toLowerCase();
    if (!text) return { ignored: false };
    const excluded = filter.excludeKeywords.some((keyword) => text.includes(keyword));
    if (!excluded && filter.keywords.some((keyword) => text.includes(keyword))) {
      return { ignored: true, reason: "keyword" };
    }
  }

  return { ignored: false };
}
