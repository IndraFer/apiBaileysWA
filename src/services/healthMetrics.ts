/**
 * Operational health metrics for the admin dashboard.
 *
 * Everything here is a bounded ring buffer, so memory stays flat no matter how
 * long the process runs. Samples reset with the process; the UI labels them
 * "since restart" instead of pretending they are historical.
 *
 * Percentiles are computed on demand by sorting a copy. 1024 numbers sort in
 * well under a millisecond, which is cheaper than maintaining a histogram and
 * exact enough for a support gateway.
 */

const RING_SIZE = 1024;

const sendSamples: number[] = [];
const inboundSamples: number[] = [];

const failures = { send: 0, timeout: 0, inbound: 0 };
const reconnects = {
  attempts: 0,
  successes: 0,
  totalDowntimeMs: 0,
  lastDowntimeMs: 0,
  lastAt: 0,
};
/** Session id → timestamp of the disconnect that is still unresolved. */
const pendingDisconnects = new Map<string, number>();

function push(ring: number[], value: number): void {
  ring.push(Math.max(0, Math.round(value)));
  if (ring.length > RING_SIZE) ring.shift();
}

/** Nearest-rank percentile over a copy; 0 when there is no sample. */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(Math.max(p, 1), 100) / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? 0;
}

function summarize(samples: number[]): { count: number; p50: number; p95: number; p99: number } {
  return {
    count: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
  };
}

/** One Baileys send attempt. `ok=false` also counts as a failure. */
export function recordSendSample(ms: number, ok: boolean): void {
  push(sendSamples, ms);
  if (!ok) failures.send += 1;
}

/** One inbound batch, measured from receipt to handler completion. */
export function recordInboundSample(ms: number, ok = true): void {
  push(inboundSamples, ms);
  if (!ok) failures.inbound += 1;
}

export function recordSendTimeout(): void {
  failures.timeout += 1;
}

/** A connection closed and a retry is scheduled. */
export function recordDisconnect(sessionId: string): void {
  pendingDisconnects.set(sessionId, Date.now());
}

/** The socket opened again; whatever downtime was pending is now closed. */
export function recordReconnect(sessionId: string): void {
  const startedAt = pendingDisconnects.get(sessionId);
  if (startedAt === undefined) return;
  pendingDisconnects.delete(sessionId);
  const downtime = Math.max(0, Date.now() - startedAt);
  reconnects.attempts += 1;
  reconnects.successes += 1;
  reconnects.totalDowntimeMs += downtime;
  reconnects.lastDowntimeMs = downtime;
  reconnects.lastAt = Date.now();
}

/** A retry attempt that never opened: count it, keep the downtime pending. */
export function recordReconnectFailure(): void {
  reconnects.attempts += 1;
}

export interface HealthSnapshot {
  send: { count: number; p50: number; p95: number; p99: number };
  inbound: { count: number; p50: number; p95: number; p99: number };
  failures: { send: number; timeout: number; inbound: number };
  reconnects: {
    attempts: number;
    successes: number;
    successRate: number | null;
    avgDowntimeMs: number;
    lastDowntimeMs: number;
    lastAt: number | null;
    pending: number;
  };
}

export function getHealthSnapshot(): HealthSnapshot {
  const attempts = reconnects.attempts;
  return {
    send: summarize(sendSamples),
    inbound: summarize(inboundSamples),
    failures: { ...failures },
    reconnects: {
      attempts,
      successes: reconnects.successes,
      successRate: attempts > 0 ? Math.round((reconnects.successes / attempts) * 100) : null,
      avgDowntimeMs:
        reconnects.successes > 0
          ? Math.round(reconnects.totalDowntimeMs / reconnects.successes)
          : 0,
      lastDowntimeMs: reconnects.lastDowntimeMs,
      lastAt: reconnects.lastAt || null,
      pending: pendingDisconnects.size,
    },
  };
}
