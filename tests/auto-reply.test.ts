import { describe, expect, test } from "bun:test";
import config from "@/config";
import {
  normalizeAutoReplyConfig,
  resolveAutoReplyConfig,
  staticTriggerMatches,
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

describe("static trigger rules", () => {
  const at = (hour: number, minute = 0) => new Date(2026, 0, 1, hour, minute);

  test("always fires regardless of failures or time", () => {
    const config = { type: "always" as const };
    expect(staticTriggerMatches(config, { webhookFailed: false, now: at(3) })).toBe(true);
    expect(staticTriggerMatches(config, { webhookFailed: true, now: at(3) })).toBe(true);
  });

  test("on_webhook_fail follows the observed webhook outcome only", () => {
    const config = { type: "on_webhook_fail" as const };
    expect(staticTriggerMatches(config, { webhookFailed: true })).toBe(true);
    // An AI failure is not a webhook failure.
    expect(staticTriggerMatches(config, { webhookFailed: false })).toBe(false);
  });

  test("time_range covers normal and overnight windows", () => {
    const normal = { type: "time_range" as const, timeStart: "09:00", timeEnd: "17:00" };
    expect(staticTriggerMatches(normal, { webhookFailed: false, now: at(10) })).toBe(true);
    expect(staticTriggerMatches(normal, { webhookFailed: false, now: at(20) })).toBe(false);

    const overnight = { type: "time_range" as const, timeStart: "22:00", timeEnd: "06:00" };
    expect(staticTriggerMatches(overnight, { webhookFailed: false, now: at(23) })).toBe(true);
    expect(staticTriggerMatches(overnight, { webhookFailed: false, now: at(2) })).toBe(true);
    expect(staticTriggerMatches(overnight, { webhookFailed: false, now: at(12) })).toBe(false);
  });

  test("time_range without bounds never fires", () => {
    expect(staticTriggerMatches({ type: "time_range" }, { webhookFailed: false })).toBe(false);
  });
});
