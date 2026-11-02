/**
 * Session metadata is persisted as JSON or Redis hashes, so credential fields
 * inside it must not be stored in plaintext. Only the webhook secret is
 * encrypted here; AI credentials already travel through their own encrypted
 * fields.
 *
 * Read path is backward compatible:
 * - legacy plaintext (no prefix) is returned as-is and re-encrypted on the
 *   next write,
 * - `plain:` prefixes (no CONFIG_ENC_KEY) and `v1:` blobs are decoded,
 * - an unreadable blob becomes undefined instead of being used as a secret.
 */
import { decryptSecret, encryptSecret, isEncrypted } from "@/lib/secretBox";

type MetadataRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MetadataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function encodeMetadataSecrets<T>(metadata: T): T {
  if (!isRecord(metadata)) return metadata;
  const secret = metadata.webhookSecret;
  if (typeof secret !== "string" || secret.length === 0) return metadata;
  // Already stored in a recognized format: do not double-encrypt on every save.
  if (isEncrypted(secret) || secret.startsWith("plain:")) return metadata;
  return { ...metadata, webhookSecret: encryptSecret(secret) } as T;
}

export function decodeMetadataSecrets<T>(metadata: T): T {
  if (!isRecord(metadata)) return metadata;
  const secret = metadata.webhookSecret;
  if (typeof secret !== "string" || secret.length === 0) return metadata;
  if (!isEncrypted(secret) && !secret.startsWith("plain:")) {
    // Legacy plaintext from an older build; keep it usable and migrate on save.
    return metadata;
  }
  return { ...metadata, webhookSecret: decryptSecret(secret) ?? undefined } as T;
}
