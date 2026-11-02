import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BaileysEventEmitter, WAMessage } from "@whiskeysockets/baileys";
import { jidNormalizedUser, toNumber } from "@whiskeysockets/baileys";
import logger from "@/lib/logger";

interface StoreConfig {
  sessionId: string;
  maxMessagesPerChat?: number;
  autoSaveInterval?: number;
}

const SESSIONS_DIR = join(process.cwd(), "sessions");

/**
 * In-memory store for chats, messages, contacts, and group metadata.
 * Persists to JSON file for recovery across restarts.
 */
export class MemoryStore extends EventEmitter {
  private sessionId: string;
  private maxMessagesPerChat: number;
  private storeFile: string;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private deleted = false;

  public chats = new Map<string, Record<string, unknown>>();
  public messages = new Map<string, Map<string, WAMessage>>();
  public contacts = new Map<string, Record<string, unknown>>();
  public groupMetadata = new Map<string, Record<string, unknown>>();

  constructor(config: StoreConfig) {
    super();
    this.sessionId = config.sessionId;
    this.maxMessagesPerChat = config.maxMessagesPerChat ?? 50;
    this.storeFile = join(SESSIONS_DIR, `${config.sessionId}_store.json`);

    if (!existsSync(SESSIONS_DIR)) {
      mkdirSync(SESSIONS_DIR, { recursive: true });
    }

    // Auto-save every 60 seconds
    const interval = config.autoSaveInterval ?? 60000;
    if (interval > 0) {
      this.autoSaveTimer = setInterval(() => {
        this.writeToFile().catch(() => {});
      }, interval);
    }
  }

  bind(ev: BaileysEventEmitter) {
    ev.on("messages.delete", (item) => {
      // { jid, all: true } arrives when a chat is cleared on the account;
      // per-key deletions arrive for individual messages.
      const keys = "keys" in item ? item.keys : [];

      if (keys.length === 0 && "all" in item && item.all === true && item.jid) {
        const jid = jidNormalizedUser(item.jid);
        this.messages.delete(jid);
        const chat = this.chats.get(jid);
        if (chat) chat.unreadCount = 0;
        return;
      }

      for (const key of keys) {
        if (!key?.remoteJid || !key.id) continue;
        const jid = jidNormalizedUser(key.remoteJid);
        this.messages.get(jid)?.delete(key.id);
      }
    });

    ev.on("messages.upsert", ({ messages: newMessages, type }) => {
      for (const msg of newMessages) {
        try {
          if (!msg.key.remoteJid) continue;
          const jid = jidNormalizedUser(msg.key.remoteJid);
          // Create the room for every upsert type. Some Baileys versions deliver
          // live messages without type "notify"; gating on it left the chat list
          // empty even though messages were stored.
          const timestamp = toNumber(msg.messageTimestamp || 0);
          const isNew = this.addMessage(jid, msg);
          const existing = this.chats.get(jid);
          if (!existing) {
            this.chats.set(jid, {
              id: jid,
              name: msg.pushName || undefined,
              conversationTimestamp: timestamp,
              unreadCount: type === "notify" && !msg.key.fromMe && isNew ? 1 : 0,
            });
          } else {
            existing.conversationTimestamp = timestamp;
            if (!existing.name && msg.pushName) existing.name = msg.pushName;
            if (type === "notify" && !msg.key.fromMe && isNew) {
              existing.unreadCount = Number(existing.unreadCount || 0) + 1;
            }
          }
        } catch {
          // Ignore individual message errors
        }
      }
    });

    ev.on("messaging-history.set", ({ chats, contacts, messages }) => {
      for (const chat of chats || []) {
        if (!chat.id) continue;
        if (!this.chats.has(chat.id)) {
          this.chats.set(chat.id, { ...chat });
        }
      }
      for (const contact of contacts || []) {
        try {
          if (!contact.id) continue;
          const jid = jidNormalizedUser(contact.id);
          this.contacts.set(jid, { ...contact });
        } catch {
          // Skip invalid contacts
        }
      }
      for (const msg of messages || []) {
        try {
          if (!msg.key.remoteJid) continue;
          const jid = jidNormalizedUser(msg.key.remoteJid);
          this.addMessage(jid, msg);
        } catch {
          // Skip invalid messages
        }
      }
    });

    ev.on("chats.upsert", (newChats) => {
      for (const chat of newChats) {
        if (!chat.id) continue;
        const existing = this.chats.get(chat.id);
        this.chats.set(chat.id, { ...(existing || {}), ...chat });
      }
    });

    ev.on("chats.update", (updates) => {
      for (const update of updates) {
        if (!update.id) continue;
        const existing = this.chats.get(update.id);
        if (existing) {
          Object.assign(existing, update);
        }
      }
    });

    ev.on("chats.delete", (deletions) => {
      for (const chatId of deletions) {
        this.chats.delete(chatId);
        this.messages.delete(chatId);
      }
    });

    ev.on("contacts.upsert", (newContacts) => {
      for (const contact of newContacts) {
        try {
          const jid = jidNormalizedUser(contact.id);
          const existing = this.contacts.get(jid);
          this.contacts.set(jid, { ...(existing || {}), ...contact });
        } catch {
          // Skip invalid contacts
        }
      }
    });

    ev.on("groups.update", (updates) => {
      for (const update of updates) {
        if (update.id) {
          const existing = this.groupMetadata.get(update.id);
          this.groupMetadata.set(update.id, { ...(existing || {}), ...update });
        }
      }
    });
  }

  private addMessage(jid: string, msg: WAMessage): boolean {
    if (!this.messages.has(jid)) {
      this.messages.set(jid, new Map());
    }

    const chatMessages = this.messages.get(jid);
    if (!chatMessages || !msg.key.id) return false;
    const isNew = !chatMessages.has(msg.key.id);
    chatMessages.set(msg.key.id, msg);

    // Evict oldest if over limit
    if (chatMessages.size > this.maxMessagesPerChat) {
      const sorted = Array.from(chatMessages.entries()).sort(
        ([, a], [, b]) => Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0),
      );
      const toDelete = sorted.slice(0, chatMessages.size - this.maxMessagesPerChat);
      for (const [id] of toDelete) {
        chatMessages.delete(id);
      }
    }

    return isNew;
  }

  getMessage(jid: string, messageId: string): WAMessage | undefined {
    return this.messages.get(jid)?.get(messageId);
  }

  loadMessages(jid: string, count = 25): WAMessage[] {
    const chatMessages = this.messages.get(jid);
    if (!chatMessages) return [];
    return Array.from(chatMessages.values())
      .sort((a, b) => Number(b.messageTimestamp || 0) - Number(a.messageTimestamp || 0))
      .slice(0, count);
  }

  getChatList(isGroup = false): Record<string, unknown>[] {
    if (isGroup) {
      return [...this.chats.values()].filter((chat) => String(chat.id ?? "").endsWith("@g.us"));
    }
    // Individual chats use either the classic JID (@s.whatsapp.net) or the
    // newer LID addressing (@lid). Both are 1:1 conversations; groups,
    // broadcasts, status and newsletters are excluded.
    return [...this.chats.values()].filter((chat) => {
      const id = String(chat.id ?? "");
      if (id.endsWith("@g.us") || id.endsWith("@broadcast") || id.endsWith("@newsletter")) {
        return false;
      }
      return id.endsWith("@s.whatsapp.net") || id.endsWith("@lid");
    });
  }

  /** Clear the unread badge for a chat (also used when the UI opens it). */
  markChatRead(jid: string): void {
    const target = normalizeJidKey(jid);
    for (const [key, chat] of this.chats) {
      if (normalizeJidKey(key) === target) {
        chat.unreadCount = 0;
      }
    }
  }

  /** Remove stored messages for one chat, keeping the room in the list. */
  clearChat(jid: string): number {
    const target = normalizeJidKey(jid);
    let removed = 0;
    for (const [key, map] of this.messages) {
      if (normalizeJidKey(key) === target) {
        removed += map.size;
        map.clear();
      }
    }
    this.markChatRead(jid);
    return removed;
  }

  /** Remove one chat entry and its messages (used after a remote delete). */
  deleteChat(jid: string): { chats: number; messages: number } {
    const target = normalizeJidKey(jid);
    let messages = 0;
    for (const [key, map] of this.messages) {
      if (normalizeJidKey(key) !== target) continue;
      messages += map.size;
      this.messages.delete(key);
    }
    let chats = 0;
    for (const key of [...this.chats.keys()]) {
      if (normalizeJidKey(key) === target) {
        this.chats.delete(key);
        chats += 1;
      }
    }
    return { chats, messages };
  }

  /** Remove every stored chat and message for this session. */
  clearAllChats(): { chats: number; messages: number } {
    let messages = 0;
    for (const map of this.messages.values()) messages += map.size;
    const chats = this.chats.size;
    this.messages.clear();
    this.chats.clear();
    return { chats, messages };
  }

  getContactList(): string[] {
    return [...this.contacts.keys()];
  }

  /** Mark the session deleted: late close events must not resurrect the file. */
  markDeleted(): void {
    this.deleted = true;
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    try {
      rmSync(this.storeFile, { force: true });
    } catch {
      // The file may already be gone.
    }
  }

  async writeToFile() {
    if (this.deleted) return;
    try {
      const data = {
        version: "1.0",
        timestamp: Date.now(),
        chats: [...this.chats.entries()],
        messages: Object.fromEntries(
          [...this.messages.entries()].map(([jid, msgs]) => [jid, [...msgs.entries()]]),
        ),
        contacts: [...this.contacts.entries()],
        groupMetadata: [...this.groupMetadata.entries()],
      };

      const tempFile = `${this.storeFile}.tmp.${Date.now()}`;

      // Strip out heavy base64 data to save memory & storage and speed up serialization
      const jsonStr = JSON.stringify(data, (key, value) => {
        if (key === "jpegThumbnail" || key === "historySyncBase64") return undefined;
        return value;
      });

      const { writeFile, rename } = await import("node:fs/promises");
      await writeFile(tempFile, jsonStr);
      await rename(tempFile, this.storeFile);
    } catch (error) {
      logger.error("[Store:%s] Write error: %s", this.sessionId, (error as Error).message);
    }
  }

  async readFromFile() {
    try {
      if (!existsSync(this.storeFile)) return;

      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(this.storeFile, "utf-8");
      if (!raw.trim()) return;

      const data = JSON.parse(raw);

      // Load chats
      if (Array.isArray(data.chats)) {
        for (const [jid, chat] of data.chats) {
          this.chats.set(jid, chat);
        }
      }

      // Load messages
      if (data.messages) {
        for (const [jid, msgs] of Object.entries(data.messages)) {
          this.messages.set(jid, new Map(msgs as [string, WAMessage][]));
        }
      }

      // Load contacts
      if (Array.isArray(data.contacts)) {
        for (const [jid, contact] of data.contacts) {
          this.contacts.set(jid, contact);
        }
      }

      // Load group metadata
      if (Array.isArray(data.groupMetadata)) {
        for (const [jid, meta] of data.groupMetadata) {
          this.groupMetadata.set(jid, meta);
        }
      }

      logger.info(
        "[Store:%s] Loaded %d chats, %d contacts",
        this.sessionId,
        this.chats.size,
        this.contacts.size,
      );
    } catch (error) {
      logger.error("[Store:%s] Read error: %s", this.sessionId, (error as Error).message);
    }
  }

  async destroy() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    await this.writeToFile();
  }
}

/** JIDs may carry a device suffix (123:4@s.whatsapp.net); compare without it. */
function normalizeJidKey(value: unknown): string {
  return String(value || "").replace(/:\d+(?=@)/, "");
}
