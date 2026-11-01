/**
 * In-memory AI routing metrics.
 *
 * Deliberately dependency-free: counters live in the running process, so they
 * are visible while the app is up (manual testing, debugging) and reset on
 * restart. Nothing is written to disk. When Redis-backed multi-instance
 * aggregation is needed, this module is the single place to swap the store.
 *
 * Hourly buckets use the routing timezone, so "AI vs human per hour" matches the
 * business window rather than the server clock.
 */
import { timeInZone } from "@/services/routing";

export type AiRoute = "ai" | "static" | "human" | "paused" | "failed" | "blocked" | "muted";

export interface AiDecision {
  at: number;
  sessionId: string;
  conversationId: string;
  route: AiRoute;
  reason?: string;
  latencyMs?: number;
  tools?: string[];
}

interface SessionCounters {
  ai: number;
  human: number;
  static: number;
  failures: number;
}

export interface AiMetricsSnapshot {
  since: number;
  counters: {
    aiReplies: number;
    staticReplies: number;
    humanSkips: number;
    pausedSkips: number;
    failures: number;
    blocked: number;
    muted: number;
    toolCalls: number;
    tokensIn: number;
    tokensOut: number;
  };
  latency: { samples: number; avgMs: number; maxMs: number };
  hourly: Array<{ hour: number; ai: number; human: number }>;
  bySession: Record<string, SessionCounters>;
  recent: AiDecision[];
}

const MAX_RECENT = 100;

let startedAt = Date.now();
let dayKey = "";
let hourly = createHourlyBuckets();
const bySession: Record<string, SessionCounters> = {};
const recent: AiDecision[] = [];

const counters = {
  aiReplies: 0,
  staticReplies: 0,
  humanSkips: 0,
  pausedSkips: 0,
  failures: 0,
  blocked: 0,
  muted: 0,
  toolCalls: 0,
  tokensIn: 0,
  tokensOut: 0,
};

const latency = { samples: 0, totalMs: 0, maxMs: 0 };

function createHourlyBuckets(): Array<{ hour: number; ai: number; human: number }> {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, ai: 0, human: 0 }));
}

function ensureDay(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today === dayKey) return;
  dayKey = today;
  hourly = createHourlyBuckets();
}

function currentHour(): number {
  // timeInZone returns "HH:mm"; fall back to 0 on an unexpected value.
  const hour = Number(timeInZone(new Date(), "Asia/Jakarta").slice(0, 2));
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 0;
}

function sessionCounters(sessionId: string): SessionCounters {
  const existing = bySession[sessionId];
  if (existing) return existing;
  const created: SessionCounters = { ai: 0, human: 0, static: 0, failures: 0 };
  bySession[sessionId] = created;
  return created;
}

/** Record one routing decision (one inbound event handled by a responder). */
export function recordDecision(input: Omit<AiDecision, "at"> & { at?: number }): void {
  ensureDay();
  const decision: AiDecision = { at: input.at ?? Date.now(), ...input };
  recent.push(decision);
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);

  const perSession = sessionCounters(decision.sessionId);
  const hour = currentHour();

  switch (decision.route) {
    case "ai":
      counters.aiReplies += 1;
      perSession.ai += 1;
      hourly[hour]!.ai += 1;
      if (decision.tools && decision.tools.length > 0) counters.toolCalls += decision.tools.length;
      break;
    case "static":
      counters.staticReplies += 1;
      perSession.static += 1;
      break;
    case "human":
      counters.humanSkips += 1;
      perSession.human += 1;
      hourly[hour]!.human += 1;
      break;
    case "paused":
      counters.pausedSkips += 1;
      perSession.human += 1;
      hourly[hour]!.human += 1;
      break;
    case "failed":
      counters.failures += 1;
      perSession.failures += 1;
      break;
    case "blocked":
      counters.blocked += 1;
      break;
    case "muted":
      counters.muted += 1;
      break;
  }
}

/** Record provider token usage and call latency for one AI reply. */
export function recordUsage(
  usage: { promptTokens?: number; completionTokens?: number } | undefined,
  latencyMs: number,
): void {
  counters.tokensIn += usage?.promptTokens ?? 0;
  counters.tokensOut += usage?.completionTokens ?? 0;
  latency.samples += 1;
  latency.totalMs += Math.max(0, latencyMs);
  latency.maxMs = Math.max(latency.maxMs, Math.max(0, latencyMs));
}

/** Snapshot for the dashboard; optionally filtered to one session. */
export function getAiMetrics(sessionId?: string): AiMetricsSnapshot {
  ensureDay();
  const scoped = sessionId ? recent.filter((entry) => entry.sessionId === sessionId) : recent;
  return {
    since: startedAt,
    counters: { ...counters },
    latency: {
      samples: latency.samples,
      avgMs: latency.samples > 0 ? Math.round(latency.totalMs / latency.samples) : 0,
      maxMs: Math.round(latency.maxMs),
    },
    hourly: hourly.map((bucket) => ({ ...bucket })),
    bySession: sessionId
      ? {
          [sessionId]: { ...(bySession[sessionId] ?? { ai: 0, human: 0, static: 0, failures: 0 }) },
        }
      : Object.fromEntries(Object.entries(bySession).map(([key, value]) => [key, { ...value }])),
    recent: scoped.slice(-50).reverse(),
  };
}

/** Clear every counter (dashboard action). */
export function resetAiMetrics(): void {
  startedAt = Date.now();
  hourly = createHourlyBuckets();
  recent.length = 0;
  for (const key of Object.keys(bySession)) delete bySession[key];
  counters.aiReplies = 0;
  counters.staticReplies = 0;
  counters.humanSkips = 0;
  counters.pausedSkips = 0;
  counters.failures = 0;
  counters.blocked = 0;
  counters.muted = 0;
  counters.toolCalls = 0;
  counters.tokensIn = 0;
  counters.tokensOut = 0;
  latency.samples = 0;
  latency.totalMs = 0;
  latency.maxMs = 0;
}
