/**
 * Backup and restore for a file-based installation.
 *
 * The archive is a plain zip of a whitelisted set of paths. Two rules matter:
 *
 * 1. **Secrets are decrypted on export and re-encrypted on import.** Metadata
 *    secrets and AI credentials are bound to CONFIG_ENC_KEY, so copying the
 *    ciphertext to another machine would produce unreadable values. Anything that
 *    cannot be decrypted here is listed in the manifest instead of being dropped
 *    silently.
 * 2. **The archive never contains .env or dashboard users.** The first holds this
 *    machine's keys; the second holds password hashes and admin accounts. The
 *    manifest states this explicitly so a restore is not mistaken for complete.
 *
 * WhatsApp auth under sessions/md_<id>/ is Baileys' own format and is not bound
 * to CONFIG_ENC_KEY, so it moves as-is.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { decodeMetadataSecrets, encodeMetadataSecrets } from "@/baileys/authState/metadataSecrets";
import logger from "@/lib/logger";
import { decryptSecret, encryptSecret } from "@/lib/secretBox";
import { errorToString } from "@/utils/validation";

const ROOT = process.cwd();
const SESSIONS_DIR = join(ROOT, "sessions");
const DATA_DIR = join(ROOT, "data");
const MEMORY_DIR = join(DATA_DIR, "ai-memory");
const MEDIA_DIR = join(ROOT, "media");
const API_KEYS_FILE = join(DATA_DIR, "api-keys.json");

const MANIFEST_PATH = "manifest.json";
const ALLOWED_PREFIXES = ["sessions/", "data/ai-memory/", "media/"];
const ALLOWED_FILES = ["data/api-keys.json", MANIFEST_PATH];

/** Hard limits so one archive cannot exhaust memory or the disk. */
const MAX_UNCOMPRESSED_BYTES = 1_500_000_000;
const MAX_ENTRIES = 50_000;

export interface BackupSession {
  id: string;
  /** Phone number from the auth creds, when readable. */
  number: string | null;
  hasCreds: boolean;
  memoryScopes: number;
}

export interface BackupManifest {
  version: 1;
  createdAt: number;
  host: string;
  appVersion: string;
  includesMedia: boolean;
  /** Dashboard users are never bundled; a restore creates them again. */
  includesDashboardUsers: false;
  /** Every secret in this archive is plaintext inside the zip. */
  secrets: "plaintext";
  sessions: BackupSession[];
  /** Fields that could not be decrypted on this machine. */
  unreadable: string[];
  notes: string[];
}

export interface ImportReport {
  imported: string[];
  replaced: string[];
  skipped: string[];
  unreadable: string[];
  files: number;
  warnings: string[];
}

function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      version?: string;
    };
    return String(pkg.version ?? "unknown");
  } catch {
    return "unknown";
  }
}

function isSafeEntry(name: string): boolean {
  if (!name || name.startsWith("/") || name.includes("\\") || name.includes("\0")) return false;
  if (name.split("/").includes("..")) return false;
  if (ALLOWED_FILES.includes(name)) return true;
  return ALLOWED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function readDirRecursive(dir: string, prefix: string, out: Record<string, Uint8Array>): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${entry.name}`;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      readDirRecursive(full, `${rel}/`, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out[rel] = new Uint8Array(readFileSync(full));
  }
}

function rawMetadataOf(sessionId: string): Record<string, unknown> | null {
  const file = join(SESSIONS_DIR, `md_${sessionId}`, "metadata.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Turn a stored metadata file into a portable one: every secret plaintext, so
 * the importing machine can encrypt it with its own key.
 */
function portableMetadata(
  raw: Record<string, unknown> | null,
  unreadable: string[],
  sessionId: string,
): Record<string, unknown> {
  if (!raw) return {};
  const next: Record<string, unknown> = { ...raw };

  // decodeMetadataSecrets leaves an undecryptable field as undefined, so inspect
  // the stored form first to tell "absent" from "cannot read".
  for (const key of ["webhookSecret", "webhookSecretPrevious"] as const) {
    const stored = raw[key];
    if (typeof stored !== "string" || stored.length === 0) continue;
    const plain = decryptSecret(stored);
    if (plain === null) {
      unreadable.push(`${sessionId}.${key}`);
      delete next[key];
      continue;
    }
    next[key] = plain;
  }

  const ai = next.ai;
  if (ai && typeof ai === "object" && !Array.isArray(ai)) {
    const aiRecord = { ...(ai as Record<string, unknown>) };
    const blob = aiRecord.credentials;
    if (typeof blob === "string" && blob.length > 0) {
      const plain = decryptSecret(blob);
      if (plain === null) {
        unreadable.push(`${sessionId}.ai.credentials`);
        delete aiRecord.credentials;
      } else {
        // Explicit marker: the import re-encrypts and removes this field.
        aiRecord.credentialsPlain = plain;
        delete aiRecord.credentials;
      }
    }
    next.ai = aiRecord;
  }

  return next;
}

function countMemoryScopes(sessionId: string): number {
  const dir = join(MEMORY_DIR, sessionId);
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function sessionNumber(sessionId: string): string | null {
  const file = join(SESSIONS_DIR, `md_${sessionId}`, "creds.json");
  if (!existsSync(file)) return null;
  try {
    const creds = JSON.parse(readFileSync(file, "utf8")) as { me?: { id?: string } };
    const id = creds.me?.id;
    return typeof id === "string" ? id.replace(/:\d+@/, "@").replace(/@.*$/, "") : null;
  } catch {
    return null;
  }
}

/** Build the archive. Returns the bytes, the manifest and a suggested filename. */
export function buildBackup(options: { includeMedia?: boolean } = {}): {
  zip: Uint8Array;
  manifest: BackupManifest;
  filename: string;
} {
  const files: Record<string, Uint8Array> = {};
  const unreadable: string[] = [];

  // Sessions: every md_<id> directory plus the per-session store snapshots.
  if (existsSync(SESSIONS_DIR)) {
    for (const entry of readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("md_")) {
        readDirRecursive(join(SESSIONS_DIR, entry.name), `sessions/${entry.name}/`, files);
      } else if (entry.isFile() && entry.name.endsWith("_store.json")) {
        files[`sessions/${entry.name}`] = new Uint8Array(
          readFileSync(join(SESSIONS_DIR, entry.name)),
        );
      }
    }
  }

  // Memory is derived data, but restoring it avoids rebuilding every summary.
  readDirRecursive(MEMORY_DIR, "data/ai-memory/", files);

  if (existsSync(API_KEYS_FILE)) {
    files["data/api-keys.json"] = new Uint8Array(readFileSync(API_KEYS_FILE));
  }

  if (options.includeMedia === true) {
    readDirRecursive(MEDIA_DIR, "media/", files);
  }

  const sessionIds = new Set<string>();
  for (const path of Object.keys(files)) {
    const match = /^sessions\/md_([^/]+)\//.exec(path);
    if (match?.[1]) sessionIds.add(match[1]);
    // Also include sessions that only have a store snapshot.
    const store = /^sessions\/([^/]+)_store\.json$/.exec(path);
    if (store?.[1]) sessionIds.add(store[1]);
  }

  const sessions: BackupSession[] = [];
  for (const id of sessionIds) {
    const raw = rawMetadataOf(id);
    const portable = portableMetadata(raw, unreadable, id);
    files[`sessions/md_${id}/metadata.json`] = new TextEncoder().encode(
      JSON.stringify(portable, null, 2),
    );
    sessions.push({
      id,
      number: sessionNumber(id),
      hasCreds: existsSync(join(SESSIONS_DIR, `md_${id}`, "creds.json")),
      memoryScopes: countMemoryScopes(id),
    });
  }

  const manifest: BackupManifest = {
    version: 1,
    createdAt: Date.now(),
    host: hostname(),
    appVersion: appVersion(),
    includesMedia: options.includeMedia === true,
    includesDashboardUsers: false,
    secrets: "plaintext",
    sessions,
    unreadable,
    notes: [
      "Dashboard users are NOT included. Create accounts again on the target machine.",
      ".env is NOT included. Copy CONFIG_ENC_KEY yourself if secrets must stay readable.",
      "Secrets inside this archive are plaintext. Treat the zip like an .env file.",
      "One credential set belongs to one running instance. Do not run both machines at once.",
    ],
  };
  files[MANIFEST_PATH] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

  let totalBytes = 0;
  for (const content of Object.values(files)) totalBytes += content.byteLength;
  if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Backup too large (${Math.round(totalBytes / 1_000_000)} MB). Retry without media.`,
    );
  }
  if (Object.keys(files).length > MAX_ENTRIES) {
    throw new Error("Too many files for one backup; exclude media or split the sessions.");
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const safeHost = hostname().replace(/[^a-zA-Z0-9._-]/g, "-");
  return {
    zip: zipSync(files, { level: 6 }),
    manifest,
    filename: `${stamp}-${safeHost}-Backup.zip`,
  };
}

/** Re-encrypt a portable metadata file with this machine's key. */
function sealMetadata(portable: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...portable };

  const ai = next.ai;
  if (ai && typeof ai === "object" && !Array.isArray(ai)) {
    const aiRecord = { ...(ai as Record<string, unknown>) };
    const plain = aiRecord.credentialsPlain;
    if (typeof plain === "string" && plain.length > 0) {
      const sealed = encryptSecret(plain);
      if (sealed) aiRecord.credentials = sealed;
      delete aiRecord.credentialsPlain;
    }
    next.ai = aiRecord;
  }

  // encodeMetadataSecrets encrypts any plaintext webhook secret it finds.
  return encodeMetadataSecrets(decodeMetadataSecrets(next)) as Record<string, unknown>;
}

/**
 * Apply an archive. `skip` leaves existing sessions untouched, `replace`
 * overwrites them. A connected session is never overwritten.
 */
export function applyBackup(
  zipBytes: Uint8Array,
  strategy: "skip" | "replace",
  isConnected: (sessionId: string) => boolean,
): ImportReport {
  const entries = unzipSync(zipBytes);
  const names = Object.keys(entries);
  if (names.length > MAX_ENTRIES) throw new Error("Archive contains too many entries");

  let totalBytes = 0;
  for (const name of names) {
    if (!isSafeEntry(name)) throw new Error(`Refusing unsafe path in archive: ${name}`);
    totalBytes += entries[name]?.byteLength ?? 0;
  }
  if (totalBytes > MAX_UNCOMPRESSED_BYTES) throw new Error("Archive expands beyond the size limit");

  const manifestRaw = entries[MANIFEST_PATH];
  let manifest: BackupManifest | null = null;
  if (manifestRaw) {
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as BackupManifest;
    } catch {
      manifest = null;
    }
  }

  const report: ImportReport = {
    imported: [],
    replaced: [],
    skipped: [],
    unreadable: manifest?.unreadable ?? [],
    files: 0,
    warnings: [],
  };

  // Which session IDs this archive carries, and whether they already exist here.
  const archived = new Set<string>();
  for (const name of names) {
    const match = /^sessions\/md_([^/]+)\//.exec(name);
    if (match?.[1]) archived.add(match[1]);
    const store = /^sessions\/([^/]+)_store\.json$/.exec(name);
    if (store?.[1]) archived.add(store[1]);
  }

  for (const name of names) {
    if (name === MANIFEST_PATH) continue;
    if (!isSafeEntry(name)) continue;

    const sessionMatch = /^sessions\/(?:md_)?([^/]+)/.exec(name);
    const sessionId = sessionMatch?.[1]?.replace(/_store\.json$/, "");

    if (sessionId && archived.has(sessionId)) {
      const exists = existsSync(join(SESSIONS_DIR, `md_${sessionId}`));
      if (exists) {
        if (strategy === "skip") {
          if (!report.skipped.includes(sessionId)) report.skipped.push(sessionId);
          continue;
        }
        if (isConnected(sessionId)) {
          report.warnings.push(`${sessionId} is connected; disconnect it before replacing.`);
          if (!report.skipped.includes(sessionId)) report.skipped.push(sessionId);
          continue;
        }
        if (!report.replaced.includes(sessionId)) report.replaced.push(sessionId);
      } else if (!report.imported.includes(sessionId)) {
        report.imported.push(sessionId);
      }
    }

    const target = join(ROOT, name);
    mkdirSync(dirname(target), { recursive: true });

    if (name.endsWith("/metadata.json")) {
      try {
        const portable = JSON.parse(new TextDecoder().decode(entries[name])) as Record<
          string,
          unknown
        >;
        writeFileSync(target, JSON.stringify(sealMetadata(portable), null, 2), "utf8");
      } catch (error) {
        report.warnings.push(`metadata skipped: ${errorToString(error)}`);
      }
    } else {
      writeFileSync(target, entries[name]);
    }
    report.files += 1;
  }

  if (!manifest) report.warnings.push("manifest.json missing or unreadable; version not verified");

  logger.info(
    "[DataMigration] import done: %d imported, %d replaced, %d skipped",
    report.imported.length,
    report.replaced.length,
    report.skipped.length,
  );
  return report;
}
