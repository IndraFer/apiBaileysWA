import { expect, test } from "bun:test";
import { matchOtpFilter, resolveOtpFilter } from "@/services/otpFilter";

const filter = resolveOtpFilter({
  enabled: true,
  ignoredSenders: ["628123456789", "120363000000000000@g.us"],
  keywordFilter: true,
  keywords: ["verification code", "otp code"],
  excludeKeywords: ["not received"],
});

test("ignored sender matches a phone or JID, including group participants", () => {
  expect(
    matchOtpFilter({ remoteJid: "628123456789:4@s.whatsapp.net", text: "hello" }, filter).ignored,
  ).toBe(true);
  expect(
    matchOtpFilter({ remoteJid: "120363000000000000@g.us", text: "group message" }, filter).ignored,
  ).toBe(true);
  expect(
    matchOtpFilter(
      {
        remoteJid: "120363000000000000@g.us",
        participant: "628123456789@s.whatsapp.net",
        text: "group message",
      },
      filter,
    ).ignored,
  ).toBe(true);
  expect(
    matchOtpFilter({ remoteJid: "628987654321@s.whatsapp.net", text: "hello" }, filter).ignored,
  ).toBe(false);
});

test("keyword filter is case-insensitive and exclude keywords win", () => {
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: "YOUR VERIFICATION CODE: 1234" },
      filter,
    ).ignored,
  ).toBe(true);
  expect(
    matchOtpFilter(
      { remoteJid: "628987654321@s.whatsapp.net", text: "verification code not received" },
      filter,
    ).ignored,
  ).toBe(false);
});

test("master switch and empty operator lists do not filter anything", () => {
  expect(
    matchOtpFilter(
      { remoteJid: "628123456789@s.whatsapp.net", text: "verification code" },
      resolveOtpFilter({
        enabled: false,
        ignoredSenders: ["628123456789"],
        keywordFilter: true,
        keywords: ["verification code"],
      }),
    ).ignored,
  ).toBe(false);
  expect(
    matchOtpFilter(
      { remoteJid: "628123456789@s.whatsapp.net", text: "verification code" },
      resolveOtpFilter({ enabled: true }),
    ).ignored,
  ).toBe(false);
  expect(resolveOtpFilter({ enabled: true }).keywords).toEqual([]);
});
