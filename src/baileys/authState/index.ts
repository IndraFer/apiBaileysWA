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

/**
 * Resolve the auth-store backend.
 *
 * The choice must be explicit (AUTH_STATE_BACKEND=file|redis). It is never
 * derived from Redis availability, so a Redis outage cannot silently move the
 * session store; an unreachable Redis with backend=redis fails loudly.
 */
function resolveBackend(): AuthBackend {
  const configured = config.authState.backend;
  if (!configured) {
    throw new Error(
      'AUTH_STATE_BACKEND is not set. Set it explicitly to "file" or "redis" (see .env.example).',
    );
  }
  if (configured === "redis" && !isRedisAvailable()) {
    throw new Error(
      "AUTH_STATE_BACKEND=redis but Redis is not available (check REDIS_ENABLED / REDIS_URL). Refusing to start with an empty session store.",
    );
  }
  return configured;
}

/**
 * Refuse to start when the configured backend disagrees with where the sessions
 * actually live: continuing would present an empty session list and look like
 * the WhatsApp logins vanished.
 */
export async function assertAuthStateBackendConsistency(): Promise<void> {
  const backend = resolveBackend();
  const fileIds = getFileSavedSessionIds();
  const redisIds =
    backend === "redis" ? (await getRedisSavedSessionIds()).map((row) => row.id) : [];

  if (backend === "redis" && redisIds.length === 0 && fileIds.length > 0) {
    throw new Error(
      `Auth backend mismatch: AUTH_STATE_BACKEND=redis, but ${fileIds.length} session(s) exist on disk and Redis holds none. Set AUTH_STATE_BACKEND=file or migrate the sessions first.`,
    );
  }

  if (backend === "file" && fileIds.length === 0 && isRedisAvailable()) {
    const redisSessions = await getRedisSavedSessionIds();
    if (redisSessions.length > 0) {
      throw new Error(
        `Auth backend mismatch: AUTH_STATE_BACKEND=file, but Redis holds ${redisSessions.length} session(s) and the filesystem has none. Set AUTH_STATE_BACKEND=redis or migrate the sessions first.`,
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
  if (resolveBackend() === "redis") {
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
  if (resolveBackend() === "redis") {
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
  if (resolveBackend() === "redis") {
    return getRedisSavedSessionIds<T>();
  }
  return getFileSavedSessionsWithMetadata<T>();
}

export async function updateSessionMetadata(sessionId: string, metadata: unknown): Promise<void> {
  if (resolveBackend() === "redis") {
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
  if (resolveBackend() === "redis") {
    await deleteRedisAuthState(sessionId);
  }
  // Always clean up file-based data (auth folder + store JSON)
  // Store file lives on filesystem even when using Redis auth
  deleteFileAuthState(sessionId);
}
