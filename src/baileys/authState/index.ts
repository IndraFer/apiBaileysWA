import type { AuthenticationState } from "@whiskeysockets/baileys";
import config from "@/config";
import logger from "@/lib/logger";
import { isRedisAvailable } from "@/lib/redis";
import {
  deleteFileAuthState,
  getFileSavedSessionIds,
  getFileSavedSessionsWithMetadata,
  saveFileSessionMetadata,
  useFileAuthState,
} from "./file";
import {
  deleteRedisAuthState,
  getRedisSavedSessionIds,
  updateRedisSessionMetadata,
  useRedisAuthState,
} from "./redis";

export interface AuthStateResult {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearState?: () => Promise<void>;
}

type AuthBackend = "file" | "redis";

interface BackendDecision {
  backend: AuthBackend;
  reason: string;
}

let decision: BackendDecision | null = null;

/**
 * Resolve the auth-store backend once per process.
 *
 * "auto" (default) prefers Redis when reachable, but never abandons sessions
 * that only exist on disk: it falls back to files with a warning. Explicit
 * "file"/"redis" is honoured, and an unreachable Redis fails loudly instead of
 * silently starting with an empty store.
 */
async function resolveBackend(): Promise<AuthBackend> {
  if (decision) return decision.backend;

  const configured = config.authState.backend;
  let backend: AuthBackend;
  let reason: string;

  if (configured === "file") {
    backend = "file";
    reason = "explicit AUTH_STATE_BACKEND=file";
  } else if (configured === "redis") {
    if (!isRedisAvailable()) {
      throw new Error(
        "AUTH_STATE_BACKEND=redis but Redis is not available (check REDIS_ENABLED / REDIS_URL). Refusing to start with an empty session store.",
      );
    }
    backend = "redis";
    reason = "explicit AUTH_STATE_BACKEND=redis";
  } else if (!isRedisAvailable()) {
    backend = "file";
    reason = "auto: Redis unreachable";
  } else {
    const redisSessions = await getRedisSavedSessionIds();
    const redisIds = redisSessions.map((row) => row.id);
    const fileIds = getFileSavedSessionIds();

    if (redisIds.length === 0 && fileIds.length > 0) {
      backend = "file";
      reason = `auto: Redis is empty but ${fileIds.length} session(s) exist on disk; using files so they stay reachable`;
      logger.warn("[AuthState] %s", reason);
    } else if (redisIds.length > 0 && fileIds.length > 0) {
      backend = "redis";
      reason = `auto: sessions exist in both stores (redis=${redisIds.length}, file=${fileIds.length}); preferring Redis, set AUTH_STATE_BACKEND explicitly to make this deliberate`;
      logger.warn("[AuthState] %s", reason);
    } else {
      backend = "redis";
      reason = `auto: Redis reachable (${redisIds.length} session(s))`;
    }
  }

  decision = { backend, reason };
  logger.info("[AuthState] backend=%s (%s)", backend, reason);
  return backend;
}

/**
 * Guard for explicit backends: refuse to start when the configured store
 * disagrees with where sessions actually live. Sessions are never migrated
 * automatically, so the message explains how to keep them.
 */
export async function assertAuthStateBackendConsistency(): Promise<void> {
  const backend = await resolveBackend();
  if (config.authState.backend === "auto") return;

  const fileIds = getFileSavedSessionIds();
  const redisSessions = backend === "redis" ? await getRedisSavedSessionIds() : [];
  const redisIds = redisSessions.map((row) => row.id);

  if (backend === "redis" && redisIds.length === 0 && fileIds.length > 0) {
    throw new Error(
      `Auth backend mismatch: AUTH_STATE_BACKEND=redis, but ${fileIds.length} session(s) exist on disk and Redis holds none. ` +
        "Sessions are not migrated automatically: set AUTH_STATE_BACKEND=file to keep them, or re-link (QR) after switching. Nothing was deleted.",
    );
  }

  if (backend === "file" && fileIds.length === 0 && isRedisAvailable()) {
    const redisSessions = await getRedisSavedSessionIds();
    if (redisSessions.length > 0) {
      throw new Error(
        `Auth backend mismatch: AUTH_STATE_BACKEND=file, but Redis holds ${redisSessions.length} session(s) and the filesystem has none. ` +
          "Sessions are not migrated automatically: set AUTH_STATE_BACKEND=redis to keep them, or re-link (QR) after switching. Nothing was deleted.",
      );
    }
  }
}

/**
 * Factory: auto-select auth state based on Redis availability.
 */
export async function useAuthState(
  sessionId: string,
  metadata?: unknown,
): Promise<AuthStateResult> {
  if ((await resolveBackend()) === "redis") {
    logger.info("[AuthState] Using Redis auth state for session: %s", sessionId);
    const { state, saveCreds } = await useRedisAuthState(sessionId, metadata);
    return {
      state,
      saveCreds,
      clearState: state.keys.clear as () => Promise<void>,
    };
  }

  logger.info("[AuthState] Using file auth state for session: %s", sessionId);
  const { state, saveCreds } = await useFileAuthState(sessionId, metadata);
  return { state, saveCreds };
}

/**
 * Get all saved session IDs from whichever store is active.
 */
export async function getSavedSessionIds(): Promise<string[]> {
  if ((await resolveBackend()) === "redis") {
    const sessions = await getRedisSavedSessionIds();
    return sessions.map((s) => s.id);
  }
  return getFileSavedSessionIds();
}

/**
 * Get saved session IDs with metadata (Redis only; file returns empty metadata).
 */
export async function getSavedSessionsWithMetadata<T>(): Promise<
  Array<{ id: string; metadata: T | null }>
> {
  if ((await resolveBackend()) === "redis") {
    return getRedisSavedSessionIds<T>();
  }
  return getFileSavedSessionsWithMetadata<T>();
}

export async function updateSessionMetadata(sessionId: string, metadata: unknown): Promise<void> {
  if ((await resolveBackend()) === "redis") {
    await updateRedisSessionMetadata(sessionId, metadata);
    return;
  }
  saveFileSessionMetadata(sessionId, metadata);
}

/**
 * Delete auth state for a session.
 * Also cleans up the store JSON file regardless of auth backend.
 */
export async function deleteAuthState(sessionId: string): Promise<void> {
  if ((await resolveBackend()) === "redis") {
    await deleteRedisAuthState(sessionId);
  }
  // Always clean up file-based data (auth folder + store JSON)
  // Store file lives on filesystem even when using Redis auth
  deleteFileAuthState(sessionId);
}
