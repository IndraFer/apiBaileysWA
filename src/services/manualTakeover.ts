/**
 * Manual takeover: an operator holds a conversation so the AI never answers it.
 *
 * Why a file and not the in-memory router pause: this state has to survive a
 * restart. Losing it means the bot talks over a human, which is the exact failure
 * the feature exists to prevent.
 *
 * The read path is synchronous because the AI routing check happens on every
 * inbound message and cannot await disk. The file is loaded once per session and
 * then served from memory; writes persist asynchronously.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import logger from "@/lib/logger";
import { assertValidSessionId } from "@/lib/sessionId";

/** Bounded so a busy session cannot grow this file without limit. */
const MAX_ENTRIES = 500;
const SESSIONS_DIR = join(process.cwd(), "sessions");

export interface TakeoverEntry {
  /** Epoch ms. The AI stays away until this moment. */
  until: number;
  /** Dashboard user that claimed the conversation. */
  by: string;
  at: number;
}

type TakeoverMap = Map<string, TakeoverEntry>;

const cache = new Map<string, TakeoverMap>();

function filePath(sessionId: string): string {
  assertValidSessionId(sessionId);
  return join(SESSIONS_DIR, `md_${sessionId}`, "takeover.json");
}

function load(sessionId: string): TakeoverMap {
  const cached = cache.get(sessionId);
  if (cached) return cached;

  const map: TakeoverMap = new Map();
  try {
    const raw = readFileSync(filePath(sessionId), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, TakeoverEntry>;
    for (const [jid, entry] of Object.entries(parsed || {})) {
      if (!entry || typeof entry.until !== "number") continue;
      if (entry.until <= Date.now()) continue;
      map.set(jid, entry);
    }
  } catch {
    /* missing or unreadable file means "no takeover" */
  }

  cache.set(sessionId, map);
  return map;
}

function persist(sessionId: string, map: TakeoverMap): void {
  const path = filePath(sessionId);
  try {
    mkdirSync(join(SESSIONS_DIR, `md_${sessionId}`), { recursive: true });
    const payload: Record<string, TakeoverEntry> = {};
    for (const [jid, entry] of map) payload[jid] = entry;
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
    renameSync(tmp, path);
  } catch (error) {
    logger.warn(
      "[Takeover] Failed to persist for %s: %s",
      sessionId,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Epoch ms of the active takeover, or 0. Safe on the message hot path. */
export function getTakeoverUntil(sessionId: string, jid: string): number {
  try {
    const entry = load(sessionId).get(jid);
    if (!entry) return 0;
    if (entry.until <= Date.now()) {
      load(sessionId).delete(jid);
      return 0;
    }
    return entry.until;
  } catch {
    return 0;
  }
}

export function setTakeover(
  sessionId: string,
  jid: string,
  until: number,
  by: string,
): TakeoverEntry {
  const map = load(sessionId);
  const entry: TakeoverEntry = { until, by, at: Date.now() };
  map.set(jid, entry);

  if (map.size > MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, value] of map) {
      if (value.until <= now) map.delete(key);
    }
    while (map.size > MAX_ENTRIES) {
      const oldest = map.keys().next().value;
      if (!oldest) break;
      map.delete(oldest);
    }
  }

  persist(sessionId, map);
  return entry;
}

export function clearTakeover(sessionId: string, jid: string): boolean {
  const map = load(sessionId);
  const removed = map.delete(jid);
  if (removed) persist(sessionId, map);
  return removed;
}

/** Active takeovers for a session, for list markers. */
export function listTakeovers(sessionId: string): Record<string, number> {
  const map = load(sessionId);
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [jid, entry] of map) {
    if (entry.until > now) out[jid] = entry.until;
  }
  return out;
}

/** Test hook. */
export function resetTakeoverCache(): void {
  cache.clear();
}

export function takeoverFileExists(sessionId: string): boolean {
  try {
    return existsSync(filePath(sessionId));
  } catch {
    return false;
  }
}
