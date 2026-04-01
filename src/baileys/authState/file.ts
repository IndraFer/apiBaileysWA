import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AuthenticationState, useMultiFileAuthState } from "@whiskeysockets/baileys";
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

function getMetadataFile(sessionId: string): string {
  return join(getSessionDir(sessionId), "metadata.json");
}

export async function useFileAuthState(
  sessionId: string,
  metadata?: unknown,
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  ensureSessionsDir();
  const sessionDir = getSessionDir(sessionId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  if (metadata) {
    saveFileSessionMetadata(sessionId, metadata);
  }
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
    return files.filter((f) => f.startsWith("md_")).map((f) => f.replace("md_", ""));
  } catch {
    return [];
  }
}

export function saveFileSessionMetadata(sessionId: string, metadata: unknown): void {
  ensureSessionsDir();
  const sessionDir = getSessionDir(sessionId);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  const metadataFile = getMetadataFile(sessionId);
  writeFileSync(metadataFile, JSON.stringify(metadata), "utf-8");
}

export function getFileSavedSessionsWithMetadata<T>(): Array<{ id: string; metadata: T | null }> {
  const ids = getFileSavedSessionIds();
  return ids.map((id) => {
    const metadataFile = getMetadataFile(id);
    if (!existsSync(metadataFile)) {
      return { id, metadata: null };
    }
    try {
      const raw = readFileSync(metadataFile, "utf-8");
      const parsed = JSON.parse(raw) as T;
      return { id, metadata: parsed };
    } catch {
      return { id, metadata: null };
    }
  });
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
