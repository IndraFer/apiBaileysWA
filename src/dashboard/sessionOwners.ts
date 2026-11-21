/**
 * Session ownership.
 *
 * One field decides who owns a session, and owning it grants access on its own:
 * a manager who creates a session sees it because they own it, not because the
 * admin remembered to assign it. Admins change the owner from the session
 * settings modal; clearing it leaves the session reachable by admins only.
 *
 * Stored in its own file instead of session metadata because metadata lives with
 * the auth state, and a session that was created but never paired has no
 * credentials yet. Ownership must survive a restart in that state too.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSavedSessionsWithMetadata, updateSessionMetadata } from "@/baileys/authState";
import connectionManager from "@/baileys/connectionManager";
import logger from "@/lib/logger";

type SavedEntry = { id: string; metadata: Record<string, unknown> | null };

const DATA_DIR = join(process.cwd(), "data");
const OWNERS_FILE = join(DATA_DIR, "session-owners.json");

const owners = new Map<string, string>();
let loadedOnce = false;

function persist(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const payload: Record<string, string> = {};
    for (const [id, ownerId] of owners) payload[id] = ownerId;
    const tmp = `${OWNERS_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
    renameSync(tmp, OWNERS_FILE);
  } catch (error) {
    logger.warn(
      "[Sessions] Failed to persist ownership: %s",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function readFile(): Record<string, string> {
  try {
    if (!existsSync(OWNERS_FILE)) return {};
    const parsed = JSON.parse(readFileSync(OWNERS_FILE, "utf-8")) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Load the owner map at startup, migrating owners stored in session metadata. */
export async function loadSessionOwners(): Promise<void> {
  owners.clear();
  for (const [id, ownerId] of Object.entries(readFile())) {
    if (id && ownerId) owners.set(id, ownerId);
  }

  // Sessions that predate this file keep their owner in metadata.
  const saved = await getSavedSessionsWithMetadata<Record<string, unknown>>().catch(
    () => [] as SavedEntry[],
  );
  let migrated = 0;
  for (const entry of saved) {
    if (owners.has(entry.id)) continue;
    const ownerId = String((entry.metadata as Record<string, unknown> | null)?.ownerId || "");
    if (!ownerId) continue;
    owners.set(entry.id, ownerId);
    migrated += 1;
  }
  if (migrated > 0) persist();

  loadedOnce = true;
  logger.debug("[Sessions] Loaded ownership for %d session(s)", owners.size);
}

/** Owner id, or "" when unowned. Live options win over the stored map. */
export function getSessionOwner(sessionId: string): string {
  const live = connectionManager
    .listSessions()
    .find((session) => session.sessionId === sessionId)?.ownerId;
  if (live) return live;
  return owners.get(sessionId) || "";
}

/** Persist ownership and update the live connection so lists agree immediately. */
export async function setSessionOwner(sessionId: string, ownerId: string): Promise<void> {
  if (ownerId) owners.set(sessionId, ownerId);
  else owners.delete(sessionId);
  persist();

  // Best effort: keep metadata in step for older readers. The auth-state listing
  // skips unpaired sessions, so a missing entry is expected and not an error.
  const saved = await getSavedSessionsWithMetadata<Record<string, unknown>>().catch(
    () => [] as SavedEntry[],
  );
  const entry = saved.find((item) => item.id === sessionId);
  if (entry) {
    await updateSessionMetadata(sessionId, {
      ...((entry.metadata as Record<string, unknown> | null) || {}),
      ownerId: ownerId || undefined,
    }).catch(() => {});
  }

  try {
    connectionManager.getSession(sessionId).updateOptions({ ownerId: ownerId || undefined });
  } catch {
    /* not connected right now */
  }
}

/** Drop an owner whose session was deleted. */
export function forgetSessionOwner(sessionId: string): void {
  if (!owners.delete(sessionId)) return;
  persist();
}

export function sessionOwnersLoaded(): boolean {
  return loadedOnce;
}
