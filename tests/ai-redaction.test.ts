import { describe, expect, test } from "bun:test";
import { maskSensitiveIdentities } from "@/services/aiAgent";
import { scrubModelOutput } from "@/services/promptGuard";

const self = ["628999000111@s.whatsapp.net", "111222333444555@lid"];

describe("maskSensitiveIdentities", () => {
  test("masks the account's own number, not the customer's", () => {
    // The customer's own number is visible to them and may be repeated back.
    expect(maskSensitiveIdentities("nomor saya 628123456789", self)).toBe(
      "nomor saya 628123456789",
    );
    expect(maskSensitiveIdentities("nomor kami 628999000111", self)).toBe("nomor kami");
    expect(maskSensitiveIdentities("wa: +628999000111 ya", self)).toBe("wa: ya");
  });

  test("masks the account's LID", () => {
    expect(maskSensitiveIdentities("id 111222333444555", self)).toBe("id");
  });

  test("masks every raw JID, whichever side it belongs to", () => {
    expect(maskSensitiveIdentities("628123456789@s.whatsapp.net", self)).toBe("");
    expect(maskSensitiveIdentities("120363000000000000@g.us", self)).toBe("");
    expect(maskSensitiveIdentities("kirim ke 628123456789:12@s.whatsapp.net", self)).toBe(
      "kirim ke",
    );
    expect(maskSensitiveIdentities("lihat status@broadcast", self)).toBe("lihat");
  });

  test("leaves order IDs, membership numbers and other phone numbers alone", () => {
    expect(maskSensitiveIdentities("order 2024000123", self)).toBe("order 2024000123");
    expect(maskSensitiveIdentities("hubungi supplier +628111222333", self)).toBe(
      "hubungi supplier +628111222333",
    );
    expect(maskSensitiveIdentities("NIK 3201234567890001", self)).toBe("NIK 3201234567890001");
  });

  test("never cuts a longer digit run in half", () => {
    expect(maskSensitiveIdentities("96289990001110000", self)).toBe("96289990001110000");
    expect(maskSensitiveIdentities("062899900011199", self)).toBe("062899900011199");
  });

  test("an empty identity list changes nothing except JIDs", () => {
    expect(maskSensitiveIdentities("nomor 628999000111", undefined)).toBe("nomor 628999000111");
    expect(maskSensitiveIdentities("nomor 628999000111", [])).toBe("nomor 628999000111");
  });
});

describe("scrubModelOutput", () => {
  test("keeps the customer's number but removes raw JIDs", () => {
    expect(scrubModelOutput("nomor Anda 628123456789")).toBe("nomor Anda 628123456789");
    expect(scrubModelOutput("chat 628123456789@s.whatsapp.net")).toBe("chat");
  });

  test("removes the session id as a whole token only", () => {
    expect(scrubModelOutput("session rog8 aktif", { sessionId: "rog8" })).toBe("session aktif");
    // Part of a longer word must not be rewritten.
    expect(scrubModelOutput("dropbox rog8x", { sessionId: "rog8" })).toBe("dropbox rog8x");
  });

  test("removes short session ids but never rewrites substrings", () => {
    // The id must not leak, whatever its length.
    expect(scrubModelOutput("ini cs kami", { sessionId: "cs" })).toBe("ini kami");
    // Whole-token matching keeps substrings of real words intact.
    expect(scrubModelOutput("lihat docs ini", { sessionId: "cs" })).toBe("lihat docs ini");
  });

  test("still scrubs credentials", () => {
    expect(scrubModelOutput("key sk-abcdefghijklmno")).toBe("key [redacted]");
    expect(scrubModelOutput("Authorization: Bearer abcdefghijklmnop")).toBe(
      "Authorization: Bearer [redacted]",
    );
  });
});
