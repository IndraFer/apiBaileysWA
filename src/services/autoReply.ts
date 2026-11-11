/**
 * Auto-reply defaults and normalization.
 *
 * Per-session settings may omit or blank the message. In that case the global
 * AUTO_REPLY_MESSAGE (already defaulted in config) wins; a hardcoded UI string
 * must never overwrite the operator's environment default.
 */
import type { AutoReplyConfig } from "@/baileys/types";
import config from "@/config";

export function resolveAutoReplyConfig(override?: Partial<AutoReplyConfig>): AutoReplyConfig {
  const merged = { ...config.autoReply, ...(override ?? {}) };
  if (!merged.message?.trim()) merged.message = config.autoReply.message;
  return merged;
}

/** Persist a complete config, replacing a blank message with the env default. */
export function normalizeAutoReplyConfig(
  input?: Partial<AutoReplyConfig>,
): AutoReplyConfig | undefined {
  if (!input) return undefined;
  return {
    ...config.autoReply,
    ...input,
    message: input.message?.trim() || config.autoReply.message,
  };
}

/**
 * Whether the static message should fire for the current moment.
 *
 * Shared by the primary path and the AI-failure fallback so both obey the same
 * trigger rules. `on_webhook_fail` is a failure path of its own: it fires when
 * webhook delivery failed, not when the AI failed, so the caller passes the
 * webhook outcome it actually observed.
 */
export function staticTriggerMatches(
  config: Pick<AutoReplyConfig, "type" | "timeStart" | "timeEnd">,
  context: { webhookFailed: boolean; now?: Date },
): boolean {
  if (config.type === "always") return true;
  if (config.type === "on_webhook_fail") return context.webhookFailed;

  const { timeStart, timeEnd } = config;
  if (!timeStart || !timeEnd) return false;

  const now = context.now ?? new Date();
  const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  // Normal range (08:00 - 17:00) or overnight range (22:00 - 06:00).
  return timeStart <= timeEnd
    ? current >= timeStart && current <= timeEnd
    : current >= timeStart || current <= timeEnd;
}
