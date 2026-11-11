import { describe, expect, test } from "bun:test";
import { maskOwnNumbers } from "@/services/aiAgent";

const own = ["628123456789@s.whatsapp.net", "111222333444555@lid", "628999000111@s.whatsapp.net"];

describe("maskOwnNumbers", () => {
  test("masks the conversation's own number in common shapes", () => {
    expect(maskOwnNumbers("nomor saya 628123456789", own)).toBe("nomor saya [nomor]");
    expect(maskOwnNumbers("wa: +628123456789 ya", own)).toBe("wa: [nomor] ya");
    expect(maskOwnNumbers("628123456789:12@s.whatsapp.net", own)).toBe("[nomor]:12@s.whatsapp.net");
  });

  test("masks the LID alias and the session's own number", () => {
    expect(maskOwnNumbers("id 111222333444555", own)).toBe("id [nomor]");
    expect(maskOwnNumbers("admin 628999000111", own)).toBe("admin [nomor]");
  });

  test("leaves every other number intact", () => {
    // The old blanket rule replaced all 10+ digit runs, which hid exactly the
    // answers customers ask for.
    expect(maskOwnNumbers("order 2024000123", own)).toBe("order 2024000123");
    expect(maskOwnNumbers("hubungi supplier +628111222333", own)).toBe(
      "hubungi supplier +628111222333",
    );
    expect(maskOwnNumbers("NIK 3201234567890001", own)).toBe("NIK 3201234567890001");
  });

  test("never cuts a longer digit run in half", () => {
    // The own number embedded in a longer run must not be partially replaced.
    expect(maskOwnNumbers("96281234567890000", own)).toBe("96281234567890000");
    expect(maskOwnNumbers("06281234567899", own)).toBe("06281234567899");
  });

  test("groups and unknown identities are ignored", () => {
    expect(maskOwnNumbers("grup 120363000000000000", ["120363000000000000@g.us"])).toBe(
      "grup 120363000000000000",
    );
    expect(maskOwnNumbers("nomor 628123456789", undefined)).toBe("nomor 628123456789");
    expect(maskOwnNumbers("nomor 628123456789", [])).toBe("nomor 628123456789");
  });

  test("masks every occurrence, including a repeated one", () => {
    expect(maskOwnNumbers("628123456789 lalu 628123456789", own)).toBe("[nomor] lalu [nomor]");
  });
});
