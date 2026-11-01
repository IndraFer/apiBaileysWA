/**
 * Outbound URL guard for configured integrations.
 *
 * The allowlist itself is the configuration (only URLs an operator stored are
 * ever called); this module adds a protocol check and an optional private-host
 * block for deployments that must not reach internal networks.
 */

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /\.local$/i,
  /\.internal$/i,
];

/**
 * True when the hostname points at a private/loopback/link-local target.
 * Hostnames are matched textually — deliberately no DNS resolution here, so a
 * lookup failure can never turn into an allow.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return true;
  if (host.startsWith("fe80")) return true;
  return false;
}

/**
 * Validate an outbound URL before it is fetched.
 * Returns an error message, or null when the URL is acceptable.
 */
export function validateOutboundUrl(
  raw: string,
  options: { blockInternal: boolean },
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "Invalid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Unsupported protocol: ${parsed.protocol}`;
  }
  if (options.blockInternal && isPrivateHost(parsed.hostname)) {
    return "Target host is internal/private (blocked by AI_TOOL_BLOCK_INTERNAL)";
  }
  return null;
}
