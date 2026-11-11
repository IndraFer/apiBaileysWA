/**
 * Auto-reply defaults and normalization.
 *
 * Per-session settings may omit or blank the message. In that case the global
 * AUTO_REPLY_MESSAGE (already defaulted in config) wins; a hardcoded UI string
 * must never overwrite the operator's environment default.
 */
import type { AutoReplyConfig, AutoReplyPolicy } from "@/baileys/types";
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

const POLICIES: readonly AutoReplyPolicy[] = ["both", "window", "primary", "fallback"];

/**
 * Resolve the effective policy.
 *
 * New configs store `policy` directly. Older ones only have `role` and `type`,
 * which used to describe the same decision through two overlapping selectors:
 * `role=both` + `type=time_range` is "window", `role=both` + `type=on_webhook_fail`
 * is "fallback", and so on.
 */
export function resolveAutoReplyPolicy(config?: Partial<AutoReplyConfig>): AutoReplyPolicy {
  const explicit = config?.policy;
  // "primary" was folded into "both": it answered first and never as a
  // fallback, which "both" already covers.
  if (explicit === "primary") return "both";
  if (explicit && POLICIES.includes(explicit)) return explicit;

  const role = config?.role ?? "both";
  if (role === "fallback") return "fallback";
  if (role === "primary") return "both";
  if (config?.type === "time_range") return "window";
  if (config?.type === "on_webhook_fail") return "fallback";
  return "both";
}

/** Keep `role`/`type` in sync so older clients and metrics stay meaningful. */
export function policyToLegacy(policy: AutoReplyPolicy): {
  role: "primary" | "fallback" | "both";
  type: "always" | "time_range" | "on_webhook_fail";
} {
  switch (policy) {
    case "window":
      return { role: "both", type: "time_range" };
    case "primary":
      return { role: "primary", type: "always" };
    case "fallback":
      return { role: "fallback", type: "always" };
    default:
      return { role: "both", type: "always" };
  }
}

/**
 * True when the current time falls inside the configured range. The range may
 * cross midnight (22:00 - 06:00), and is the *active* period for "window".
 */
export function staticWindowMatches(
  config: Pick<AutoReplyConfig, "timeStart" | "timeEnd">,
  now: Date = new Date(),
): boolean {
  const { timeStart, timeEnd } = config;
  if (!timeStart || !timeEnd) return false;

  const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return timeStart <= timeEnd
    ? current >= timeStart && current <= timeEnd
    : current >= timeStart || current <= timeEnd;
}

/** The AI is off or outside its window: may static answer as the primary? */
export function primaryStaticAllowed(policy: AutoReplyPolicy, inWindow: boolean): boolean {
  if (policy === "fallback") return false;
  if (policy === "window") return inWindow;
  return true;
}

/** The AI or webhook delivery failed: may static answer as the fallback? */
export function fallbackStaticAllowed(policy: AutoReplyPolicy, inWindow: boolean): boolean {
  if (policy === "primary") return false;
  if (policy === "window") return inWindow;
  return true;
}
