import { afterAll, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { readFileSync, rmSync } from "node:fs";
import { MemoryStore } from "@/baileys/store/memoryStore";

const sessionId = "store-unread";
afterAll(() => {
  rmSync(`sessions/${sessionId}_store.json`, { force: true });
});

const pn = "628123456789@s.whatsapp.net";

test("marking a chat read survives a snapshot write", async () => {
  const store = new MemoryStore({ sessionId, autoSaveInterval: 0 });
  const events = new EventEmitter();
  store.bind(events as unknown as Parameters<MemoryStore["bind"]>[0]);

  events.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: { id: "unread-1", remoteJid: pn },
        messageTimestamp: 100,
        message: { conversation: "halo" },
      },
    ],
  } as never);

  expect(store.getChatList(false)[0]?.unreadCount).toBe(1);

  store.markChatRead(pn);
  expect(store.getChatList(false)[0]?.unreadCount).toBe(0);

  // The bug: the reset lived only in memory, so the saved snapshot restored the
  // badge after a restart. Force a snapshot and read it back.
  await store.writeToFile(true);
  const raw = JSON.parse(readFileSync(`sessions/${sessionId}_store.json`, "utf8")) as {
    chats: Array<[string, { unreadCount?: number }]>;
  };
  const saved = raw.chats.find(([jid]) => jid === pn)?.[1];
  expect(saved?.unreadCount).toBe(0);

  await store.destroy();
});

test("a chat update from app-state sync clears the badge", async () => {
  const store = new MemoryStore({ sessionId: "store-unread-sync", autoSaveInterval: 0 });
  const events = new EventEmitter();
  store.bind(events as unknown as Parameters<MemoryStore["bind"]>[0]);

  events.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: { id: "sync-1", remoteJid: pn },
        messageTimestamp: 100,
        message: { conversation: "halo" },
      },
    ],
  } as never);
  expect(store.getChatList(false)[0]?.unreadCount).toBe(1);

  // Reading the chat on the phone reaches the gateway as an app-state patch.
  events.emit("chats.update", [{ id: pn, unreadCount: 0 }] as never);
  expect(store.getChatList(false)[0]?.unreadCount).toBe(0);

  await store.destroy();
  rmSync("sessions/store-unread-sync_store.json", { force: true });
});
