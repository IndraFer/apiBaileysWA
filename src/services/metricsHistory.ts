/**
 * Daily metric history.
 *
 * The in-process counters in aiMetrics reset on restart, which is fine for "what
 * happened today" but useless for a trend. This module keeps one file with one
 * line per day per session, so the dashboard can show 7 or 30 days without a
 * database.
 *
 * No scheduler: the rollover is lazy. The first metric recorded on a new day
 * flushes the previous day, so an idle process writes nothing at all. A day that
 * spans a restart keeps its partial counts; that is stated in the UI rather than
 * hidden.
 *
 * Retention is explicit and enforced on every flush: anything older than
 * RETENTION_DAYS is dropped, so the file cannot grow without bound.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import config from "@/config";
import logger from "@/lib/logger";
import { errorToString } from "@/utils/validation";

export interface DailyCounters {
  day: string;
  sessionId: string;
  ai: number;
  static: number;
  skipped: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  latencySum: number;
  latencyCount: number;
}

const DIR = join(process.cwd(), "data", "metrics");
const FILE = join(DIR, "daily.jsonl");
const RETENTION_DAYS = Math.min(Math.max(config.metricsHistory.retentionDays, 7), 365);

let currentDay = "";
let pending = new Map<string, DailyCounters>();

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyCounters(day: string, sessionId: string): DailyCounters {
  return {
    day,
    sessionId,
    ai: 0,
    static: 0,
    skipped: 0,
    failed: 0,
    tokensIn: 0,
    tokensOut: 0,
    latencySum: 0,
    latencyCount: 0,
  };
}

function entryFor(sessionId: string): DailyCounters {
  const day = today();
  if (day !== currentDay) {
    if (currentDay) flush(currentDay);
    currentDay = day;
    pending = new Map();
  }
  const existing = pending.get(sessionId);
  if (existing) return existing;
  const created = emptyCounters(day, sessionId);
  pending.set(sessionId, created);
  return created;
}

/** Write finished days, then drop anything past retention. */
function flush(finishedDay: string): void {
  const rows = [...pending.values()].filter((row) => row.day === finishedDay);
  if (rows.length === 0) return;

  try {
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    const body = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    const existing = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
    const merged = prune(`${existing}${body}`);
    const temp = `${FILE}.tmp`;
    writeFileSync(temp, merged, { encoding: "utf8", mode: 0o600 });
    renameSync(temp, FILE);
  } catch (error) {
    logger.debug("[metricsHistory] flush failed: %s", errorToString(error));
  }
}

function prune(raw: string): string {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const floor = cutoff.toISOString().slice(0, 10);

  const kept: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as DailyCounters;
      if (typeof row.day !== "string" || row.day < floor) continue;
      const key = `${row.day}|${row.sessionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(line);
    } catch {
      // Torn line from a previous crash; drop it.
    }
  }
  kept.sort();
  return kept.length > 0 ? `${kept.join("\n")}\n` : "";
}

/** Count one routing outcome for a session, today. */
export function recordDailyDecision(
  sessionId: string,
  kind: "ai" | "static" | "skipped" | "failed",
): void {
  if (!config.metricsHistory.enabled) return;
  const row = entryFor(sessionId);
  row[kind] += 1;
}

/** Add token usage and latency for one AI reply, today. */
export function recordDailyUsage(
  sessionId: string,
  usage: { tokensIn: number; tokensOut: number; latencyMs: number },
): void {
  if (!config.metricsHistory.enabled) return;
  const row = entryFor(sessionId);
  row.tokensIn += usage.tokensIn;
  row.tokensOut += usage.tokensOut;
  row.latencySum += Math.max(0, usage.latencyMs);
  row.latencyCount += 1;
}

export interface DailySeries {
  day: string;
  ai: number;
  static: number;
  skipped: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
}

/** Daily totals for the last `days` days, oldest first, including today. */
export function readDailyHistory(days: number, sessionId?: string): DailySeries[] {
  const span = Math.min(Math.max(Math.round(days), 1), RETENTION_DAYS);
  const byDay = new Map<string, DailySeries>();

  const add = (row: DailyCounters) => {
    if (sessionId && row.sessionId !== sessionId) return;
    const entry = byDay.get(row.day) ?? {
      day: row.day,
      ai: 0,
      static: 0,
      skipped: 0,
      failed: 0,
      tokensIn: 0,
      tokensOut: 0,
    };
    entry.ai += row.ai;
    entry.static += row.static;
    entry.skipped += row.skipped;
    entry.failed += row.failed;
    entry.tokensIn += row.tokensIn;
    entry.tokensOut += row.tokensOut;
    byDay.set(row.day, entry);
  };

  if (existsSync(FILE)) {
    try {
      for (const line of readFileSync(FILE, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          add(JSON.parse(line) as DailyCounters);
        } catch {
          // Skip a torn line.
        }
      }
    } catch (error) {
      logger.debug("[metricsHistory] read failed: %s", errorToString(error));
    }
  }

  // Today is still in memory until the day rolls over.
  for (const row of pending.values()) add(row);

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (span - 1));
  const floor = cutoff.toISOString().slice(0, 10);

  return [...byDay.values()]
    .filter((entry) => entry.day >= floor)
    .sort((a, b) => a.day.localeCompare(b.day));
}
