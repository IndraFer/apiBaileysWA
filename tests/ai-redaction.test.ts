import { describe, expect, test } from "bun:test";
import { buildSecurityBlock } from "@/services/persona";
import { scrubModelOutput } from "@/services/promptGuard";
import { maskInternalIds } from "@/services/redaction";

const sessionId = "rog8";

describe("maskInternalIds", () => {
  test("removes raw JIDs, including a device suffix", () => {
    expect(maskInternalIds("628123456789@s.whatsapp.net", sessionId)).toBe("");
    expect(maskInternalIds("120363000000000000@g.us", sessionId)).toBe("");
    expect(maskInternalIds("kirim ke 628123456789:12@s.whatsapp.net", sessionId)).toBe("kirim ke");
    expect(maskInternalIds("lihat status@broadcast", sessionId)).toBe("lihat");
    expect(maskInternalIds("111222333444555@lid", sessionId)).toBe("");
  });

  test("removes the session id as a whole token", () => {
    expect(maskInternalIds("session rog8 aktif", sessionId)).toBe("session aktif");
    expect(maskInternalIds("dropbox rog8x", sessionId)).toBe("dropbox rog8x");
  });

  test("keeps every contact detail and ordinary number", () => {
    // The operator usually puts the answer itself here, so these must survive.
    expect(maskInternalIds("hubungi kami di 0812-3456-7890", sessionId)).toBe(
      "hubungi kami di 0812-3456-7890",
    );
    expect(maskInternalIds("email support@example.com", sessionId)).toBe(
      "email support@example.com",
    );
    expect(maskInternalIds("order 2024000123 siap", sessionId)).toBe("order 2024000123 siap");
    expect(maskInternalIds("nomor saya 628123456789", sessionId)).toBe("nomor saya 628123456789");
  });

  test("tidies the gaps a removed token leaves behind", () => {
    // The space left before punctuation is part of the cleanup.
    expect(maskInternalIds("hubungi 628123456789@s.whatsapp.net .", sessionId)).toBe("hubungi.");
    expect(maskInternalIds("a   b", sessionId)).toBe("a b");
  });
});

describe("scrubModelOutput", () => {
  test("still redacts credentials only", () => {
    expect(scrubModelOutput("key sk-abcdefghijklmno")).toBe("key [redacted]");
    expect(scrubModelOutput("nomor 0812-3456-7890")).toBe("nomor 0812-3456-7890");
  });
});

describe("security rules", () => {
  test("forbids printing internal identifiers", () => {
    const block = buildSecurityBlock();
    expect(block).toContain("Never print internal identifiers");
    expect(block).toContain("@s.whatsapp.net");
    expect(block).toContain("@lid");
    expect(block).toContain("internal session identifier");
  });

  test("forbids mentioning the removal itself", () => {
    const block = buildSecurityBlock();
    expect(block).toContain("Never say that something was removed, masked, censored or filtered");
    expect(block).toContain("never print a placeholder");
    // The reply must not be refused just because an identifier is absent.
    expect(block).toContain("answer with the details you do have");
  });

  test("keeps contact details answerable", () => {
    const block = buildSecurityBlock();
    expect(block).toContain("Ordinary contact details are not internal identifiers");
    expect(block).toContain("must be shared normally when asked");
  });
});
