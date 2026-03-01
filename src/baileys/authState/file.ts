import { useMultiFileAuthState, type AuthenticationState } from "@whiskeysockets/baileys";
import { join } from "path";
import { rmSync, readdirSync, existsSync, mkdirSync } from "fs";
import logger from "@/lib/logger";

const SESSIONS_DIR = join(process.cwd(), "sessions");

function ensureSessionsDir() {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function getSessionDir(sessionId: string): string {
  return join(SESSIONS_DIR, `md_${sessionId}`);
}

export async function useFileAuthState(
  sessionId: string
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  ensureSessionsDir();
  const sessionDir = getSessionDir(sessionId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  logger.debug("[File Auth] Using file auth state for session: %s", sessionId);
  return { state, saveCreds };
}

/**
 * Get all saved session IDs from file system.
 */
export function getFileSavedSessionIds(): string[] {
  ensureSessionsDir();
  try {
    const files = readdirSync(SESSIONS_DIR);
    return files
      .filter((f) => f.startsWith("md_"))
      .map((f) => f.replace("md_", ""));
  } catch {
    return [];
  }
}

/**
 * Delete file auth state and store for a session.
 * Cleans up: auth folder (sessions/md_<id>/) + store file (sessions/<id>_store.json)
 */
export function deleteFileAuthState(sessionId: string): void {
  // Delete auth state folder
  const sessionDir = getSessionDir(sessionId);
  rmSync(sessionDir, { force: true, recursive: true });

  // Delete store JSON file
  const storeFile = join(SESSIONS_DIR, `${sessionId}_store.json`);
  rmSync(storeFile, { force: true });

  logger.info("[File Auth] Deleted auth state + store for session: %s", sessionId);
}
