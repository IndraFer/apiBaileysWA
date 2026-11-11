import { describe, expect, test } from "bun:test";
import config from "@/config";
import {
  canonicalizeAutoReply,
  fallbackStaticAllowed,
  normalizeAutoReplyConfig,
  policyToLegacy,
  primaryStaticAllowed,
  resolveAutoReplyConfig,
  resolveAutoReplyPolicy,
  staticWindowMatches,
} from "@/services/autoReply";

test("a blank auto-reply message falls back to the environment default", () => {
  const normalized = normalizeAutoReplyConfig({
    enabled: true,
    type: "always",
    message: "   ",
  });
  expect(normalized?.message).toBe(config.autoReply.message);
  expect(normalized?.message).not.toBe("Halo!");
  expect(resolveAutoReplyConfig({ enabled: true, message: "" }).message).toBe(
    config.autoReply.message,
  );
});

test("a custom auto-reply message is preserved", () => {
  const custom = resolveAutoReplyConfig({
    enabled: true,
    type: "always",
    message: "Custom away message",
  });
  expect(custom.message).toBe("Custom away message");
});

describe("auto reply policy", () => {
  const at = (hour: number, minute = 0) => new Date(2026, 0, 1, hour, minute);

  test("legacy role and type migrate to one policy", () => {
    expect(resolveAutoReplyPolicy({})).toBe("both");
    expect(resolveAutoReplyPolicy({ role: "both", type: "always" })).toBe("both");
    expect(resolveAutoReplyPolicy({ role: "both", type: "time_range" })).toBe("window");
    expect(resolveAutoReplyPolicy({ role: "both", type: "on_webhook_fail" })).toBe("fallback");
    // "primary" is folded into "both": it never answered as a fallback, which
    // "both" already covers.
    expect(resolveAutoReplyPolicy({ role: "primary" })).toBe("both");
    expect(resolveAutoReplyPolicy({ policy: "primary" })).toBe("both");
    expect(resolveAutoReplyPolicy({ role: "fallback" })).toBe("fallback");
    // An explicit policy always wins over the legacy fields.
    expect(resolveAutoReplyPolicy({ policy: "window", role: "primary" })).toBe("window");
    expect(resolveAutoReplyPolicy({ policy: "nope" as never })).toBe("both");
  });

  test("window policy matches normal and overnight ranges", () => {
    const normal = { timeStart: "09:00", timeEnd: "17:00" };
    expect(staticWindowMatches(normal, at(10))).toBe(true);
    expect(staticWindowMatches(normal, at(20))).toBe(false);

    const overnight = { timeStart: "22:00", timeEnd: "06:00" };
    expect(staticWindowMatches(overnight, at(23))).toBe(true);
    expect(staticWindowMatches(overnight, at(2))).toBe(true);
    expect(staticWindowMatches(overnight, at(12))).toBe(false);

    expect(staticWindowMatches({}, at(10))).toBe(false);
  });

  test("primary eligibility follows the policy", () => {
    expect(primaryStaticAllowed("both", false)).toBe(true);
    expect(primaryStaticAllowed("window", true)).toBe(true);
    expect(primaryStaticAllowed("window", false)).toBe(false);
    expect(primaryStaticAllowed("fallback", true)).toBe(false);
  });

  test("fallback eligibility follows the policy", () => {
    expect(fallbackStaticAllowed("both", false)).toBe(true);
    expect(fallbackStaticAllowed("fallback", false)).toBe(true);
    expect(fallbackStaticAllowed("window", true)).toBe(true);
    expect(fallbackStaticAllowed("window", false)).toBe(false);
  });

  test("legacy configs are canonicalised so every session stores one shape", () => {
    const base = { enabled: true, message: "hi", type: "always" as const };

    // role "primary" was folded into "both".
    expect(canonicalizeAutoReply({ ...base, role: "primary" })).toEqual({
      ...base,
      role: "both",
      policy: "both",
    });
    expect(canonicalizeAutoReply({ ...base, role: "primary", policy: "primary" })).toEqual({
      ...base,
      role: "both",
      policy: "both",
    });

    // role/type that disagree with the stored policy are corrected.
    expect(canonicalizeAutoReply({ ...base, policy: "window" })).toEqual({
      ...base,
      role: "both",
      type: "time_range",
      policy: "window",
    });

    // Already canonical: no write.
    expect(canonicalizeAutoReply({ ...base, role: "both", policy: "both" })).toBeNull();
    expect(
      canonicalizeAutoReply({ ...base, role: "both", type: "time_range", policy: "window" }),
    ).toBeNull();
    expect(canonicalizeAutoReply(undefined)).toBeNull();
  });

  test("policy writes consistent legacy fields", () => {
    expect(policyToLegacy("both")).toEqual({ role: "both", type: "always" });
    expect(policyToLegacy("window")).toEqual({ role: "both", type: "time_range" });
    expect(policyToLegacy("fallback")).toEqual({ role: "fallback", type: "always" });
  });
});
