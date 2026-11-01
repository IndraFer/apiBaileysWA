/**
 * API key registry.
 *
 * Keys are stored hashed (SHA-256) so a leaked Redis dump does not expose
 * usable tokens. Each record carries a label, a role, an optional session scope
 * and usage timestamps. Legacy plaintext keys written by the old CLI are
 * migrated on first listing/lookup.
 */
import { createHash, randomBytes } from "node:crypto";
import { getRedis, isRedisAvailable } from "@/lib/redis";

const HASHED_STORE = "@baileys-wa-api:api-keys-v2";
const LEGACY_PREFIX = "@baileys-wa-api:api-keys";

export type ApiKeyRole = "user" | "admin";

export interface ApiKeyRecord {
  /** SHA-256 of the token; also the Redis field name. */
  hash: string;
  label: string;
  role: ApiKeyRole;
  /** Session ids this key may use, or ["*"] for every session. */
  sessions: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ApiKeySummary {
  id: string;
  label: string;
  role: ApiKeyRole;
  sessions: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ApiKeyAuth {
  id: string;
  label: string;
  role: ApiKeyRole;
  sessions: string[];
}

export class ApiKeyStoreUnavailable extends Error {
  constructor() {
    super("API key store requires Redis (REDIS_ENABLED=true).");
    this.name = "ApiKeyStoreUnavailable";
  }
}

function redisOrThrow() {
  if (!isRedisAvailable()) throw new ApiKeyStoreUnavailable();
  const redis = getRedis();
  if (!redis) throw new ApiKeyStoreUnavailable();
  return redis;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function shortId(hash: string): string {
  return hash.slice(0, 12);
}

function parseRecord(hash: string, raw: string): ApiKeyRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ApiKeyRecord>;
    return {
      hash,
      label: typeof parsed.label === "string" ? parsed.label : "unnamed",
      role: parsed.role === "admin" ? "admin" : "user",
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.filter((value): value is string => typeof value === "string")
        : ["*"],
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      lastUsedAt: typeof parsed.lastUsedAt === "string" ? parsed.lastUsedAt : null,
    };
  } catch {
    return null;
  }
}

function toSummary(record: ApiKeyRecord): ApiKeySummary {
  return {
    id: shortId(record.hash),
    label: record.label,
    role: record.role,
    sessions: record.sessions,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  };
}

function normalizeSessions(value: unknown): string[] {
  if (!Array.isArray(value)) return ["*"];
  const sessions = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  return sessions.length > 0 ? [...new Set(sessions)] : ["*"];
}

/** Move plaintext legacy keys into the hashed store. Best effort. */
async function migrateLegacyKeys(): Promise<void> {
  if (!isRedisAvailable()) return;
  const redis = getRedis();
  if (!redis) return;

  try {
    const legacy = await redis.keys(`${LEGACY_PREFIX}:*`);
    for (const key of legacy) {
      const token = key.slice(`${LEGACY_PREFIX}:`.length);
      if (!token) continue;
      const hash = hashToken(token);
      const exists = await redis.hExists(HASHED_STORE, hash);
      if (!exists) {
        const raw = await redis.get(key);
        const parsed = raw ? (JSON.parse(raw) as { role?: string; createdAt?: string }) : {};
        const record: ApiKeyRecord = {
          hash,
          label: "legacy key",
          role: parsed.role === "admin" ? "admin" : "user",
          sessions: ["*"],
          createdAt: parsed.createdAt ?? new Date().toISOString(),
          lastUsedAt: null,
        };
        await redis.hSet(HASHED_STORE, hash, JSON.stringify(record));
      }
      await redis.del(key);
    }
  } catch {
    // Migration is opportunistic; authentication still works for v2 records.
  }
}

export async function listApiKeys(): Promise<ApiKeySummary[]> {
  const redis = redisOrThrow();
  await migrateLegacyKeys();
  const all = await redis.hGetAll(HASHED_STORE);
  return Object.entries(all)
    .map(([hash, raw]) => parseRecord(hash, raw))
    .filter((record): record is ApiKeyRecord => record !== null)
    .map(toSummary)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function createApiKey(input: {
  label: string;
  role: ApiKeyRole;
  sessions?: string[];
}): Promise<{ token: string; key: ApiKeySummary }> {
  const redis = redisOrThrow();
  await migrateLegacyKeys();

  // 32 random bytes as base64url: no padding, URL-safe, 256 bits of entropy.
  const token = `wa_${randomBytes(32).toString("base64url")}`;
  const record: ApiKeyRecord = {
    hash: hashToken(token),
    label: input.label.trim() || "unnamed",
    role: input.role === "admin" ? "admin" : "user",
    sessions: normalizeSessions(input.sessions),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };

  await redis.hSet(HASHED_STORE, record.hash, JSON.stringify(record));
  return { token, key: toSummary(record) };
}

export async function revokeApiKey(idPrefix: string): Promise<boolean> {
  const redis = redisOrThrow();
  const hashes = await redis.hKeys(HASHED_STORE);
  const target = hashes.find((hash) => shortId(hash) === idPrefix || hash === idPrefix);
  if (!target) return false;
  await redis.hDel(HASHED_STORE, target);
  return true;
}

/** Resolve a presented token. Legacy plaintext keys are migrated on the way. */
export async function findApiKeyByToken(token: string): Promise<ApiKeyAuth | null> {
  if (!isRedisAvailable()) return null;
  const redis = getRedis();
  if (!redis) return null;

  const hash = hashToken(token);
  const raw = await redis.hGet(HASHED_STORE, hash).catch(() => null);
  if (raw) {
    const record = parseRecord(hash, raw);
    if (!record) return null;
    await redis
      .hSet(HASHED_STORE, hash, JSON.stringify({ ...record, lastUsedAt: new Date().toISOString() }))
      .catch(() => undefined);
    return {
      id: shortId(record.hash),
      label: record.label,
      role: record.role,
      sessions: record.sessions,
    };
  }

  // Legacy plaintext key: accept once, then migrate.
  const legacy = await redis.get(`${LEGACY_PREFIX}:${token}`).catch(() => null);
  if (!legacy) return null;

  try {
    const parsed = JSON.parse(legacy) as { role?: string; createdAt?: string };
    const record: ApiKeyRecord = {
      hash,
      label: "legacy key",
      role: parsed.role === "admin" ? "admin" : "user",
      sessions: ["*"],
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    };
    await redis.hSet(HASHED_STORE, hash, JSON.stringify(record));
    await redis.del(`${LEGACY_PREFIX}:${token}`);
    return {
      id: shortId(hash),
      label: record.label,
      role: record.role,
      sessions: record.sessions,
    };
  } catch {
    return null;
  }
}

/** True when a key may act on a session (["*"] means every session). */
export function keyAllowsSession(sessions: string[] | undefined, sessionId: string): boolean {
  if (!sessions || sessions.length === 0) return true;
  return sessions.includes("*") || sessions.includes(sessionId);
}
