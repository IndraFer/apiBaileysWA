import type { AuthenticationState } from "@whiskeysockets/baileys";
import { isRedisAvailable } from "@/lib/redis";
import { useRedisAuthState, getRedisSavedSessionIds, deleteRedisAuthState } from "./redis";
import { useFileAuthState, getFileSavedSessionIds, deleteFileAuthState } from "./file";
import logger from "@/lib/logger";

export interface AuthStateResult {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearState?: () => Promise<void>;
}

/**
 * Factory: auto-select auth state based on Redis availability.
 */
export async function useAuthState(
  sessionId: string,
  metadata?: unknown
): Promise<AuthStateResult> {
  if (isRedisAvailable()) {
    logger.info("[AuthState] Using Redis auth state for session: %s", sessionId);
    const { state, saveCreds } = await useRedisAuthState(sessionId, metadata);
    return {
      state,
      saveCreds,
      clearState: state.keys.clear as () => Promise<void>,
    };
  }

  logger.info("[AuthState] Using file auth state for session: %s", sessionId);
  const { state, saveCreds } = await useFileAuthState(sessionId);
  return { state, saveCreds };
}

/**
 * Get all saved session IDs from whichever store is active.
 */
export async function getSavedSessionIds(): Promise<string[]> {
  if (isRedisAvailable()) {
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
  if (isRedisAvailable()) {
    return getRedisSavedSessionIds<T>();
  }
  return getFileSavedSessionIds().map((id) => ({ id, metadata: null }));
}

/**
 * Delete auth state for a session.
 * Also cleans up the store JSON file regardless of auth backend.
 */
export async function deleteAuthState(sessionId: string): Promise<void> {
  if (isRedisAvailable()) {
    await deleteRedisAuthState(sessionId);
  }
  // Always clean up file-based data (auth folder + store JSON)
  // Store file lives on filesystem even when using Redis auth
  deleteFileAuthState(sessionId);
}
