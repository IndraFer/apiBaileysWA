import { createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  createReadStream,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { getMediaKeys } from "@whiskeysockets/baileys";
import type { getChatAttachment } from "@/dashboard/chatPresentation";
import logger from "@/lib/logger";

const ROOT = join(process.cwd(), "data", "chat-room-media");
const TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 1_000;
const MAX_IN_FLIGHT = 2;
const MAX_ENCRYPTED_BYTES = MAX_MEDIA_BYTES + 26; // CBC padding + 10-byte MAC
const namePattern = /^[a-f0-9]{64}\.[a-f0-9]{64}\.[a-f0-9]{64}\.bin$/;

type Attachment = NonNullable<ReturnType<typeof getChatAttachment>>;
type Entry = { name: string; size: number; expiresAt: number };
const cached = new Map<string, Entry>();
const pending = new Map<string, { controller: AbortController; result: Promise<Entry> }>();
let expiryTimer: NodeJS.Timeout | undefined;
let cacheBytes = 0;

export class ChatMediaError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 413 | 502 | 503,
  ) {
    super(message);
  }
}

function unavailable(): ChatMediaError {
  return new ChatMediaError("Media Unavailable", 404);
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function roomPrefix(sessionId: string, jid: string): string {
  return `${digest(sessionId)}.${digest(jid)}.`;
}

function evict(entry: Entry) {
  rmSync(join(ROOT, entry.name), { force: true });
  cached.delete(entry.name);
  cacheBytes -= entry.size;
}

function prune() {
  for (const entry of cached.values()) {
    if (entry.expiresAt <= Date.now()) evict(entry);
  }
  // Preserve newest fetches. Reading never extends an attachment's lifetime.
  for (const entry of cached.values()) {
    if (cached.size <= MAX_CACHE_ENTRIES && cacheBytes <= MAX_CACHE_BYTES) break;
    evict(entry);
  }
}

function scheduleExpiry() {
  clearTimeout(expiryTimer);
  if (!cached.size) return;
  const nextExpiry = Math.min(...Array.from(cached.values(), (entry) => entry.expiresAt));
  expiryTimer = setTimeout(
    () => {
      try {
        prune();
        scheduleExpiry();
      } catch (err) {
        logger.error("[Chat Media] Expiry cleanup failed: %s", (err as Error).message);
        expiryTimer = setTimeout(scheduleExpiry, 60_000).unref();
      }
    },
    Math.max(1, nextExpiry - Date.now()),
  ).unref();
}

// Restore the expiry schedule after restart without downloading anything.
function restoreCache() {
  let files: string[];
  try {
    files = readdirSync(ROOT);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const entries: Entry[] = [];
  for (const name of files) {
    if (!namePattern.test(name)) {
      if (name.endsWith(".bin.part")) rmSync(join(ROOT, name), { force: true });
      continue;
    }
    const { size, mtimeMs } = statSync(join(ROOT, name));
    entries.push({ name, size, expiresAt: Math.floor(mtimeMs) + TTL_MS });
  }
  for (const entry of entries.sort((a, b) => a.expiresAt - b.expiresAt)) {
    cached.set(entry.name, entry);
    cacheBytes += entry.size;
  }
  prune();
  scheduleExpiry();
}

try {
  restoreCache();
} catch (err) {
  logger.error("[Chat Media] Could not restore cache: %s", (err as Error).message);
}

function mediaKey(raw: unknown): Buffer {
  // The message store serializes both Buffer and plain Uint8Array to JSON.
  if (raw instanceof Uint8Array && raw.byteLength === 32) return Buffer.from(raw);
  if (typeof raw === "string" && /^[A-Za-z0-9+/]{43}=$/.test(raw))
    return Buffer.from(raw, "base64");
  if (raw && typeof raw === "object") {
    const fields = raw as Record<string, unknown>;
    const value =
      fields.type === "Buffer" ? fields.data : Array.from({ length: 32 }, (_, i) => fields[i]);
    if (
      Array.isArray(value) &&
      value.length === 32 &&
      value.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
    ) {
      return Buffer.from(value);
    }
  }
  throw unavailable();
}

function mediaUrl({ directPath, url }: Attachment["data"]): URL {
  const isWhatsApp = (url: URL) =>
    url.protocol === "https:" &&
    !url.port &&
    !url.username &&
    !url.password &&
    url.hostname.endsWith(".whatsapp.net");
  let published: URL | undefined;
  try {
    const candidate = new URL(url || "");
    if (isWhatsApp(candidate)) published = candidate;
  } catch {
    // A directPath can still be used through the default WhatsApp CDN.
  }
  if (directPath?.startsWith("/") && !directPath.startsWith("//") && !directPath.includes("\\")) {
    const origin = published?.origin ?? "https://mmg.whatsapp.net";
    const target = new URL(directPath, origin);
    if (target.origin === origin) return target;
  }
  if (published) return published;
  throw unavailable();
}

async function fetchBytes(attachment: Attachment, key: Buffer, url: URL, signal: AbortSignal) {
  signal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  const response = await fetch(url, {
    redirect: "error",
    signal,
    headers: { Origin: "https://web.whatsapp.com" },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw unavailable();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > MAX_ENCRYPTED_BYTES) {
      throw new ChatMediaError("Media is too large to fetch", 413);
    }
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_ENCRYPTED_BYTES) throw new ChatMediaError("Media is too large to fetch", 413);
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const wire = Buffer.concat(chunks, size);
  if (wire.length < 26) throw unavailable();
  const ciphertext = wire.subarray(0, -10);
  const { iv, cipherKey, macKey } = await getMediaKeys(key, attachment.kind);
  if (!macKey) throw unavailable();
  const mac = createHmac("sha256", macKey).update(iv).update(ciphertext).digest().subarray(0, 10);
  if (!timingSafeEqual(mac, wire.subarray(-10))) throw unavailable();
  const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
  const bytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (bytes.length > MAX_MEDIA_BYTES) throw new ChatMediaError("Media is too large to fetch", 413);
  return bytes;
}

export function loadChatMedia(
  sessionId: string,
  jid: string,
  messageId: string,
  attachment: Attachment,
): Promise<Entry> {
  const key = mediaKey(attachment.data.mediaKey);
  const url = mediaUrl(attachment.data);
  const fingerprint = digest(JSON.stringify([messageId, attachment.kind, digest(key)]));
  const name = `${roomPrefix(sessionId, jid)}${fingerprint}.bin`;
  const cachedEntry = cached.get(name);
  if (cachedEntry) {
    if (cachedEntry.expiresAt > Date.now()) return Promise.resolve(cachedEntry);
    evict(cachedEntry);
  }
  const inFlight = pending.get(name);
  if (inFlight && !inFlight.controller.signal.aborted) return inFlight.result;
  if (inFlight) throw new ChatMediaError("Media is being cleared; try again", 409);
  if (pending.size >= MAX_IN_FLIGHT)
    throw new ChatMediaError("Media downloads are busy; try again", 503);

  const controller = new AbortController();
  const file = join(ROOT, name);
  const temp = `${file}.part`;
  const result = (async () => {
    try {
      const bytes = await fetchBytes(attachment, key, url, controller.signal);
      const fetchedAt = Date.now();
      controller.signal.throwIfAborted();
      mkdirSync(ROOT, { recursive: true, mode: 0o700 });
      await writeFile(temp, bytes, { mode: 0o600 });
      await utimes(temp, fetchedAt / 1000, fetchedAt / 1000);
      controller.signal.throwIfAborted();
      renameSync(temp, file);
      const entry = { name, size: bytes.length, expiresAt: fetchedAt + TTL_MS };
      cached.set(name, entry);
      cacheBytes += entry.size;
      prune();
      scheduleExpiry();
      return entry;
    } catch (err) {
      if (controller.signal.aborted) throw new ChatMediaError("Media was cleared; try again", 409);
      if (err instanceof ChatMediaError) throw err;
      throw new ChatMediaError("Media Unavailable", 502);
    } finally {
      try {
        rmSync(temp, { force: true });
      } finally {
        pending.delete(name);
      }
    }
  })();
  pending.set(name, { controller, result });
  return result;
}

export async function purgeChatMedia(sessionId: string, jids?: string[]) {
  const prefixes = jids?.map((jid) => roomPrefix(sessionId, jid)) ?? [`${digest(sessionId)}.`];
  const matches = (name: string) => prefixes.some((prefix) => name.startsWith(prefix));
  const clearing = [...pending.entries()].filter(([name]) => matches(name));
  for (const [, task] of clearing) task.controller.abort();
  for (const entry of cached.values()) if (matches(entry.name)) evict(entry);
  scheduleExpiry();
  await Promise.allSettled(clearing.map(([, task]) => task.result));
}

function requestedRange(header: string, size: number): [number, number] | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || start >= size || start > end) return null;
  return [start, end];
}

export function chatMediaResponse(
  entry: Entry,
  attachment: Attachment,
  download: boolean,
  range?: string,
) {
  if (!cached.has(entry.name) || entry.expiresAt <= Date.now()) throw unavailable();
  const inline = !download && attachment.mime;
  const original = "fileName" in attachment.data ? attachment.data.fileName : null;
  const extension =
    attachment.mime === "application/pdf"
      ? "pdf"
      : attachment.mime?.split("/")[1]?.replace("jpeg", "jpg") || "bin";
  const fallback = `${attachment.kind}.${extension}`;
  const filename =
    original
      ?.replace(/[^a-zA-Z0-9_.-]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 160) || fallback;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Type": inline
      ? (attachment.mime ?? "application/octet-stream")
      : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  const bounds = range ? requestedRange(range, entry.size) : null;
  if (range && !bounds) {
    headers.set("Content-Range", `bytes */${entry.size}`);
    return new Response(null, { status: 416, headers });
  }
  const start = bounds?.[0] ?? 0;
  const end = bounds?.[1] ?? entry.size - 1;
  if (bounds) headers.set("Content-Range", `bytes ${start}-${end}/${entry.size}`);
  headers.set("Content-Length", String(end - start + 1));
  // Open before yielding so a concurrent purge can unlink the file without
  // a late-opening stream racing with a different fetch of the same message.
  const file = join(ROOT, entry.name);
  const fd = openSync(file, "r");
  if (inline === "application/pdf") {
    try {
      // Use the same descriptor as the response, including for Range requests.
      const prefix = Buffer.alloc(8);
      if (
        readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length ||
        !/^%PDF-[12]\.\d$/.test(prefix.toString("latin1"))
      )
        throw unavailable();
    } catch (err) {
      closeSync(fd);
      throw err;
    }
  }
  const stream = createReadStream(file, { fd, ...(bounds ? { start, end } : {}) });
  // SAFETY: Readable.toWeb creates a WHATWG stream; Node and DOM declarations differ in BYOB overloads.
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: bounds ? 206 : 200,
    headers,
  });
}
