import { jidNormalizedUser, toNumber } from "@whiskeysockets/baileys";
import type { BaileysEventEmitter, WAMessage } from "@whiskeysockets/baileys";
import { EventEmitter } from "events";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
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

  public chats = new Map<string, Record<string, unknown>>();
  public messages = new Map<string, Map<string, WAMessage>>();
  public contacts = new Map<string, Record<string, unknown>>();
  public groupMetadata = new Map<string, Record<string, unknown>>();

  constructor(config: StoreConfig) {
    super();
    this.sessionId = config.sessionId;
    this.maxMessagesPerChat = config.maxMessagesPerChat ?? 500;
    this.storeFile = join(SESSIONS_DIR, `${config.sessionId}_store.json`);

    if (!existsSync(SESSIONS_DIR)) {
      mkdirSync(SESSIONS_DIR, { recursive: true });
    }

    // Auto-save every 60 seconds
    const interval = config.autoSaveInterval ?? 60000;
    if (interval > 0) {
      this.autoSaveTimer = setInterval(() => {
        this.writeToFile();
      }, interval);
    }
  }

  bind(ev: BaileysEventEmitter) {
    ev.on("messages.upsert", ({ messages: newMessages, type }) => {
      for (const msg of newMessages) {
        try {
          if (!msg.key.remoteJid) continue;
          const jid = jidNormalizedUser(msg.key.remoteJid);
          this.addMessage(jid, msg);

          if (type === "notify" && !this.chats.has(jid)) {
            this.chats.set(jid, {
              id: jid,
              conversationTimestamp: toNumber(msg.messageTimestamp!),
              unreadCount: 1,
            });
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
        const existing = this.chats.get(update.id!);
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

  private addMessage(jid: string, msg: WAMessage) {
    if (!this.messages.has(jid)) {
      this.messages.set(jid, new Map());
    }

    const chatMessages = this.messages.get(jid)!;
    chatMessages.set(msg.key.id!, msg);

    // Evict oldest if over limit
    if (chatMessages.size > this.maxMessagesPerChat) {
      const sorted = Array.from(chatMessages.entries()).sort(
        ([, a], [, b]) =>
          Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0)
      );
      const toDelete = sorted.slice(0, chatMessages.size - this.maxMessagesPerChat);
      for (const [id] of toDelete) {
        chatMessages.delete(id);
      }
    }
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
    const filter = isGroup ? "@g.us" : "@s.whatsapp.net";
    return [...this.chats.values()].filter((chat) =>
      (chat.id as string)?.endsWith(filter)
    );
  }

  getContactList(): string[] {
    return [...this.contacts.keys()];
  }

  writeToFile() {
    try {
      const data = {
        version: "1.0",
        timestamp: Date.now(),
        chats: [...this.chats.entries()],
        messages: Object.fromEntries(
          [...this.messages.entries()].map(([jid, msgs]) => [jid, [...msgs.entries()]])
        ),
        contacts: [...this.contacts.entries()],
        groupMetadata: [...this.groupMetadata.entries()],
      };
      const tempFile = `${this.storeFile}.tmp.${Date.now()}`;
      writeFileSync(tempFile, JSON.stringify(data));
      // Atomic rename
      const { renameSync } = require("fs");
      renameSync(tempFile, this.storeFile);
    } catch (error) {
      logger.error("[Store:%s] Write error: %s", this.sessionId, (error as Error).message);
    }
  }

  readFromFile() {
    try {
      if (!existsSync(this.storeFile)) return;

      const raw = readFileSync(this.storeFile, "utf-8");
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

      logger.info("[Store:%s] Loaded %d chats, %d contacts",
        this.sessionId, this.chats.size, this.contacts.size);
    } catch (error) {
      logger.error("[Store:%s] Read error: %s", this.sessionId, (error as Error).message);
    }
  }

  destroy() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    this.writeToFile();
  }
}
