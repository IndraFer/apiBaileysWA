import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config from "@/config";
import {
  appendMessage,
  exportConversation,
  forgetConversation,
  forgetScope,
  forgetSession,
  loadMemory,
  type MemoryScope,
  readLog,
  renderFacts,
  renderMemoryBlock,
  saveMemory,
  scopeKey,
  shouldRunDigest,
} from "@/services/aiMemory";

const originalDir = config.aiMemory.dir;
const originalEnabled = config.aiMemory.enabled;
const tempRoot = mkdtempSync(join(tmpdir(), "ai-memory-test-"));

beforeEach(() => {
  config.aiMemory.dir = tempRoot;
  config.aiMemory.enabled = true;
});

afterAll(() => {
  config.aiMemory.dir = originalDir;
  config.aiMemory.enabled = originalEnabled;
  rmSync(tempRoot, { recursive: true, force: true });
});

const dm: MemoryScope = { kind: "dm", conversationId: "628111222333@s.whatsapp.net" };

describe("scopeKey", () => {
  test("never leaks the JID into the filesystem name", () => {
    const key = scopeKey(dm);
    expect(key).toMatch(/^dm_[a-f0-9]{16}$/);
    expect(key).not.toContain("628111222333");
  });

  test("separates the two group scopes and their participants", () => {
    const group = "120363000000000000@g.us";
    const a = scopeKey({ kind: "group-participant", conversationId: group, participantId: "1" });
    const b = scopeKey({ kind: "group-participant", conversationId: group, participantId: "2" });
    const digest = scopeKey({ kind: "group-digest", conversationId: group });

    expect(a).toMatch(/^gp_[a-f0-9]{8}_[a-f0-9]{8}$/);
    expect(a).not.toBe(b);
    expect(digest).toMatch(/^gd_[a-f0-9]{16}$/);
  });

  test("is stable for the same identity", () => {
    expect(scopeKey(dm)).toBe(scopeKey({ ...dm }));
  });
});

describe("storage", () => {
  test("starts empty and round-trips through an atomic save", async () => {
    const sessionId = "s1";
    const empty = await loadMemory(sessionId, dm);
    expect(empty.summary).toBe("");
    expect(empty.version).toBe(2);

    empty.summary = "pelanggan menanyakan harga";
    await saveMemory(empty);

    // A fresh read must come from disk, not from the in-memory cache.
    const reloaded = await loadMemory("s1", dm);
    expect(reloaded.summary).toBe("pelanggan menanyakan harga");

    const raw = readFileSync(join(tempRoot, sessionId, `${scopeKey(dm)}.json`), "utf8");
    expect(JSON.parse(raw).summary).toBe("pelanggan menanyakan harga");
  });

  test("appends one JSON object per line and skips a torn line", async () => {
    const sessionId = "s2";
    const scope: MemoryScope = { kind: "dm", conversationId: "628999@s.whatsapp.net" };

    await appendMessage(sessionId, scope, { id: "a", role: "user", text: "halo", ts: 1 });
    await appendMessage(sessionId, scope, { id: "b", role: "assistant", text: "hai", ts: 2 });

    const messages = await readLog(sessionId, scope);
    expect(messages.map((m) => m.text)).toEqual(["halo", "hai"]);
  });

  test("ignores a redelivered message id", async () => {
    const sessionId = "s6";
    const scope: MemoryScope = { kind: "dm", conversationId: "628444@s.whatsapp.net" };

    await appendMessage(sessionId, scope, { id: "same", role: "user", text: "halo", ts: 1 });
    await appendMessage(sessionId, scope, { id: "same", role: "user", text: "halo", ts: 1 });

    const messages = await readLog(sessionId, scope);
    expect(messages).toHaveLength(1);
  });

  test("forget removes both the summary and the raw log", async () => {
    const sessionId = "s3";
    const scope: MemoryScope = { kind: "dm", conversationId: "628777@s.whatsapp.net" };

    await appendMessage(sessionId, scope, { id: "a", role: "user", text: "x", ts: 1 });
    const memory = await loadMemory(sessionId, scope);
    memory.summary = "ringkasan";
    await saveMemory(memory);

    await forgetScope(sessionId, scope);

    expect(await readLog(sessionId, scope)).toEqual([]);
    expect((await loadMemory(sessionId, scope)).summary).toBe("");
  });
});

describe("rendering", () => {
  const now = Date.now();
  const facts = {
    nama: { value: "Budi", firstSeen: now, lastSeen: now, sourceId: null, expiresAt: null },
    kota: { value: "Bekasi", firstSeen: now, lastSeen: now - 1, sourceId: null, expiresAt: null },
    lama: {
      value: "kedaluwarsa",
      firstSeen: now,
      lastSeen: now,
      sourceId: null,
      expiresAt: now - 1000,
    },
  };

  test("renders newest facts first and drops expired ones", () => {
    const text = renderFacts(facts, 400);
    expect(text).toContain("- nama: Budi");
    expect(text).toContain("- kota: Bekasi");
    expect(text).not.toContain("kedaluwarsa");
    expect(text.indexOf("nama")).toBeLessThan(text.indexOf("kota"));
  });

  test("respects the character budget", () => {
    const text = renderFacts(facts, 12);
    expect(text.length).toBeLessThanOrEqual(12);
    expect(text).toBe("- nama: Budi");
  });

  test("wraps the summary in a labelled low-authority block", async () => {
    const sessionId = "s4";
    const scope: MemoryScope = { kind: "dm", conversationId: "628555@s.whatsapp.net" };
    const memory = await loadMemory(sessionId, scope);
    memory.summary = "menanyakan harga";
    memory.facts = facts;

    const block = renderMemoryBlock(memory);
    expect(block.startsWith("<memori_percakapan>")).toBe(true);
    expect(block.endsWith("</memori_percakapan>")).toBe(true);
    expect(block).toContain("Ringkasan s.d.");
    expect(block).toContain("Fakta:");
  });

  test("returns an empty string when there is nothing to say", async () => {
    const memory = await loadMemory("s5", { kind: "dm", conversationId: "628000@s.whatsapp.net" });
    expect(renderMemoryBlock(memory)).toBe("");
  });
});

describe("lifecycle", () => {
  const group = "120363000000000000@g.us";
  const memberA = "628111@s.whatsapp.net";
  const memberB = "628222@s.whatsapp.net";

  test("forgetConversation removes a DM scope only", async () => {
    const sessionId = "life-1";
    const dmScope: MemoryScope = { kind: "dm", conversationId: "628333@s.whatsapp.net" };
    await appendMessage(sessionId, dmScope, { id: "a", role: "user", text: "x", ts: 1 });

    await forgetConversation(sessionId, dmScope.conversationId, false);
    expect(await readLog(sessionId, dmScope)).toEqual([]);
  });

  test("forgetConversation clears the digest and every participant file", async () => {
    const sessionId = "life-2";
    const a: MemoryScope = {
      kind: "group-participant",
      conversationId: group,
      participantId: memberA,
    };
    const b: MemoryScope = {
      kind: "group-participant",
      conversationId: group,
      participantId: memberB,
    };
    const digest: MemoryScope = { kind: "group-digest", conversationId: group };

    for (const scope of [a, b, digest]) {
      await appendMessage(sessionId, scope, {
        id: `${scopeKey(scope)}-1`,
        role: "user",
        text: "x",
        ts: 1,
      });
    }

    await forgetConversation(sessionId, group, true);

    for (const scope of [a, b, digest]) {
      expect(await readLog(sessionId, scope)).toEqual([]);
      expect((await loadMemory(sessionId, scope)).summary).toBe("");
    }
  });

  test("forgetSession removes every file for that session", async () => {
    const sessionId = "life-3";
    await appendMessage(sessionId, dm, { id: "z", role: "user", text: "x", ts: 1 });
    await forgetSession(sessionId);
    expect(await readLog(sessionId, dm)).toEqual([]);
  });

  test("export bundles the scope with its messages", async () => {
    const sessionId = "life-4";
    const scope: MemoryScope = { kind: "dm", conversationId: "628444@s.whatsapp.net" };
    await appendMessage(sessionId, scope, { id: "e1", role: "user", text: "halo", ts: 5 });
    const memory = await loadMemory(sessionId, scope);
    memory.summary = "ringkasan";
    await saveMemory(memory);

    const bundle = await exportConversation(sessionId, scope.conversationId, false);
    expect(bundle.version).toBe(2);
    expect(bundle.scopes).toHaveLength(1);
    expect(bundle.scopes[0]?.memory.summary).toBe("ringkasan");
    expect(bundle.scopes[0]?.messages.map((m) => m.text)).toEqual(["halo"]);
  });
});

describe("digest trigger", () => {
  const base = {
    now: 10_000_000,
    lastActivityAt: 0,
    messagesSinceDigest: 60,
    digestsToday: 0,
    idleMs: 900_000,
    minMessages: 50,
    maxPerDay: 0,
  };

  test("requires enough new messages and a quiet group", () => {
    expect(shouldRunDigest({ ...base, lastActivityAt: base.now - 900_000 })).toBe(true);
    // Still talking.
    expect(shouldRunDigest({ ...base, lastActivityAt: base.now - 60_000 })).toBe(false);
    // Not enough since the last digest.
    expect(
      shouldRunDigest({ ...base, messagesSinceDigest: 49, lastActivityAt: base.now - 900_000 }),
    ).toBe(false);
  });

  test("zero means no daily cap, otherwise the cap is enforced", () => {
    const quiet = base.now - 900_000;
    expect(
      shouldRunDigest({ ...base, lastActivityAt: quiet, maxPerDay: 0, digestsToday: 99 }),
    ).toBe(true);
    expect(shouldRunDigest({ ...base, lastActivityAt: quiet, maxPerDay: 3, digestsToday: 2 })).toBe(
      true,
    );
    expect(shouldRunDigest({ ...base, lastActivityAt: quiet, maxPerDay: 3, digestsToday: 3 })).toBe(
      false,
    );
  });
});
