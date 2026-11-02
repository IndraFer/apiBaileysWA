import { describe, expect, test } from "bun:test";
import { publicErrorMessage } from "@/lib/errorMessage";
import { isPathInside } from "@/lib/pathSafe";
import { isValidSessionId } from "@/lib/sessionId";
import { validateOutboundUrl } from "@/lib/urlGuard";
import { hashToken, keyAllowsSession } from "@/services/apiKeys";

describe("session id validation", () => {
  test("accepts the documented format", () => {
    for (const id of ["ROG8", "a", "a_b-1", "x".repeat(64)]) {
      expect(isValidSessionId(id)).toBe(true);
    }
  });

  test("rejects traversal, separators, dots and oversize ids", () => {
    for (const id of ["../x", "a/b", "a\\b", "a.b", "", "x".repeat(65), "../../etc"]) {
      expect(isValidSessionId(id)).toBe(false);
    }
  });
});

describe("outbound URL guard (SSRF)", () => {
  test("blocks private, loopback and link-local hosts", () => {
    for (const url of [
      "http://127.0.0.1:6379/",
      "http://localhost/",
      "http://192.168.1.4/x",
      "http://10.0.0.2/x",
      "http://172.16.0.1/x",
      "http://169.254.169.254/latest/meta-data",
    ]) {
      expect(validateOutboundUrl(url, { blockInternal: true })).not.toBeNull();
    }
  });

  test("allows public http(s) and blocks other schemes", () => {
    expect(validateOutboundUrl("https://example.com/file.pdf", { blockInternal: true })).toBeNull();
    expect(validateOutboundUrl("file:///etc/passwd", { blockInternal: true })).not.toBeNull();
    expect(validateOutboundUrl("gopher://example.com", { blockInternal: true })).not.toBeNull();
  });

  test("internal hosts stay allowed when the block is disabled", () => {
    expect(validateOutboundUrl("http://127.0.0.1:11434/x", { blockInternal: false })).toBeNull();
  });
});

describe("path containment", () => {
  test("accepts children and rejects siblings/traversal", () => {
    expect(isPathInside("/srv/media", "/srv/media/a.png")).toBe(true);
    expect(isPathInside("/srv/media", "/srv/media")).toBe(true);
    expect(isPathInside("/srv/media", "/srv/media-evil/a.png")).toBe(false);
    expect(isPathInside("/srv/media", "/srv/other/a.png")).toBe(false);
    expect(isPathInside("/srv/media", "/srv/media/../../etc/passwd")).toBe(false);
  });
});

describe("5xx message sanitization", () => {
  test("hides internal errors only in production", () => {
    expect(publicErrorMessage("ENOENT /srv/sessions/md_x", 500, "production")).toBe(
      "Internal server error",
    );
    expect(publicErrorMessage("ENOENT /srv/sessions/md_x", 500, "development")).toContain("ENOENT");
    expect(publicErrorMessage("messages is required", 400, "production")).toBe(
      "messages is required",
    );
  });
});

describe("api key helpers", () => {
  test("hashes deterministically and never returns the token", () => {
    const hash = hashToken("wa_test");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashToken("wa_test"));
    expect(hash).not.toContain("wa_test");
  });

  test("scope matching", () => {
    expect(keyAllowsSession(["*"], "any")).toBe(true);
    expect(keyAllowsSession(["a"], "a")).toBe(true);
    expect(keyAllowsSession(["a"], "b")).toBe(false);
    expect(keyAllowsSession(undefined, "b")).toBe(true);
  });
});
