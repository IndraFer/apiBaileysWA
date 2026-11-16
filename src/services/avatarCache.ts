/**
 * Bounded in-memory cache for WhatsApp profile pictures.
 *
 * Why memory and not disk:
 * - `profilePictureUrl()` returns a signed URL with a limited lifetime, so
 *   caching the URL alone is useless; either the bytes are kept or the picture
 *   is fetched again.
 * - A profile picture is third-party personal data. Writing it to disk would put
 *   it inside backups produced by the data migration export.
 *
 * The cache is keyed by `${sessionId}:${jid}` because the permission to read a
 * picture is per session, not global.
 */
import { validateOutboundUrl } from "@/lib/urlGuard";

const MAX_ENTRIES = 500;
const TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 60 * 1000;
const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const CONCURRENCY = 3;
/** Profile pictures are served from WhatsApp media hosts only. */
const ALLOWED_HOST_SUFFIX = ".whatsapp.net";

export interface AvatarImage {
  buffer: Buffer;
  contentType: string;
  etag: string;
}

interface Entry {
  value: AvatarImage;
  at: number;
}

const images = new Map<string, Entry>();
/** Contacts without a picture: retrying on every render would be wasteful. */
const misses = new Map<string, number>();
const inflight = new Map<string, Promise<AvatarImage | null>>();

let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await run();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

function evict(): void {
  while (images.size > MAX_ENTRIES) {
    const oldest = images.keys().next();
    if (oldest.done) return;
    images.delete(oldest.value);
  }
}

async function download(rawUrl: string): Promise<AvatarImage | null> {
  if (validateOutboundUrl(rawUrl, { blockInternal: true })) return null;

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return null;
  }
  if (target.protocol !== "https:") return null;
  if (!target.hostname.endsWith(ALLOWED_HOST_SUFFIX)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Redirects are refused: an allowlisted host must not bounce us elsewhere.
    // pi-lens-ignore: ts-ssrf -- https + *.whatsapp.net allowlist + validateOutboundUrl above; redirect:"error" blocks hops
    const response = await fetch(target, { redirect: "error", signal: controller.signal });
    if (!response.ok) return null;

    const contentType = (response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith("image/")) return null;

    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return null;

    return { buffer, contentType, etag: `"${etagFor(buffer)}"` };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Cheap content fingerprint for HTTP revalidation. */
export function etagFor(buffer: Buffer): string {
  let hash = 0x811c9dc5;
  for (const byte of buffer) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}-${buffer.byteLength.toString(16)}`;
}

/**
 * Return a profile picture, fetching it at most once per TTL even under
 * concurrent requests. `resolveUrl` is called only on a cache miss.
 */
export async function getAvatar(
  sessionId: string,
  jid: string,
  resolveUrl: () => Promise<string | null | undefined>,
): Promise<AvatarImage | null> {
  const key = `${sessionId}:${jid}`;

  const cached = images.get(key);
  if (cached) {
    if (Date.now() - cached.at < TTL_MS) {
      // Refresh insertion order so the LRU keeps hot entries.
      images.delete(key);
      images.set(key, cached);
      return cached.value;
    }
    images.delete(key);
  }

  const missedAt = misses.get(key);
  if (missedAt && Date.now() - missedAt < NEGATIVE_TTL_MS) return null;

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = withSlot(async () => {
    let url: string | null | undefined = null;
    try {
      url = await resolveUrl();
    } catch {
      url = null;
    }

    const image = url ? await download(url) : null;
    if (image) {
      images.set(key, { value: image, at: Date.now() });
      misses.delete(key);
      evict();
    } else {
      misses.set(key, Date.now());
    }
    return image;
  }).finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

/** Test hook: drop everything. */
export function resetAvatarCache(): void {
  images.clear();
  misses.clear();
  inflight.clear();
}
