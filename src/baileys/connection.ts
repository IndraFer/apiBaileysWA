import type { Boom } from "@hapi/boom";
import makeWASocket, {
  type AnyMessageContent,
  type BaileysEventMap,
  Browsers,
  type ConnectionState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  type ParticipantAction,
  type proto,
  type WAMessage,
  type WAPresence,
  type WAConnectionState,
  type ChatModification,
  type MessageReceiptType,
  WAMessageStatus,
  delay,
  fetchLatestBaileysVersion,
  getAggregateVotesInPollMessage,
} from "@whiskeysockets/baileys";
import { toDataURL } from "qrcode";
import NodeCache from "node-cache";
import { LRUCache } from "lru-cache";
import { useAuthState, type AuthStateResult } from "@/baileys/authState";
import { shouldIgnoreJid } from "@/baileys/helpers/shouldIgnoreJid";
import { downloadMediaFromMessages } from "@/baileys/helpers/downloadMedia";
import type { SessionOptions, SessionMetadata, WebhookPayload } from "@/baileys/types";
import { MemoryStore } from "@/baileys/store/memoryStore";
import config from "@/config";
import { asyncSleep } from "@/utils/asyncSleep";
import { errorToString } from "@/utils/validation";
import logger, { baileysLogger, deepSanitizeObject } from "@/lib/logger";
import eventBus from "@/dashboard/eventBus";

const msgRetryCounterCache = new NodeCache({
  stdTTL: 3600,
  checkperiod: 600,
});

export class BaileysNotConnectedError extends Error {
  constructor() {
    super("Session is not connected");
  }
}

const LOGGER_OMIT_KEYS = [
  "qr", "qrDataUrl", "fileSha256", "jpegThumbnail", "fileEncSha256",
  "scansSidecar", "midQualityFileSha256", "mediaKey", "senderKeyHash",
  "recipientKeyHash", "messageSecret", "thumbnailSha256", "thumbnailEncSha256",
  "appStateSyncKeyShare",
];

export class BaileysConnection {
  public sessionId: string;
  private options: SessionOptions;
  private socket: ReturnType<typeof makeWASocket> | null = null;
  private authResult: AuthStateResult | null = null;
  private store: MemoryStore;
  private reconnectCount = 0;
  private clearOnlinePresenceTimeout: ReturnType<typeof setTimeout> | null = null;
  private _isConnected = false;
  private _qrCode: string | null = null;
  private _pairingCode: string | null = null;

  constructor(sessionId: string, options: SessionOptions) {
    this.sessionId = sessionId;
    this.options = options;
    this.store = new MemoryStore({ sessionId });
  }

  get isConnected(): boolean {
    return this._isConnected && this.socket !== null;
  }

  get qrCode(): string | null {
    return this._qrCode;
  }

  get pairingCode(): string | null {
    return this._pairingCode;
  }

  get user() {
    return this.socket?.user ?? null;
  }

  updateOptions(options: Partial<SessionOptions>) {
    this.options = { ...this.options, ...options };
  }

  async connect(): Promise<{ qrCode?: string; pairingCode?: string }> {
    if (this.socket) return {};

    const metadata: SessionMetadata = {
      clientName: this.options.clientName,
      webhookUrl: this.options.webhookUrl,
      includeMedia: this.options.includeMedia,
      syncFullHistory: this.options.syncFullHistory,
    };

    this.authResult = await useAuthState(this.sessionId, metadata);
    const { state, saveCreds } = this.authResult;

    let version: [number, number, number] | undefined;
    try {
      const result = await fetchLatestBaileysVersion();
      version = result.version;
      logger.info("[%s] Using WA v%s (isLatest: %s)", this.sessionId, version.join("."), result.isLatest);
    } catch (error) {
      logger.warn("[%s] Failed to fetch WA version, using default: %s", this.sessionId, errorToString(error));
    }

    // Load store from file
    await this.store.readFromFile();

    try {
      this.socket = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        logger: baileysLogger,
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        browser: Browsers.windows(this.options.clientName || "Chrome"),
        syncFullHistory: this.options.syncFullHistory ?? false,
        shouldIgnoreJid: (jid: string) => shouldIgnoreJid(jid),
        getMessage: async (key) => {
          const msg = this.store.getMessage(key.remoteJid!, key.id!);
          return msg?.message || undefined;
        },
      });
    } catch (error) {
      logger.error("[%s] Failed to create socket: %s", this.sessionId, errorToString(error));
      this.options.onConnectionClose?.();
      return {};
    }

    this.store.bind(this.socket.ev);
    this.addEventListeners(saveCreds);

    // Handle pairing code
    if (this.options.usePairingCode && this.options.phoneNumber && !state.creds.registered) {
      if (!state.creds.account) {
        // Wait for the first QR to be generated before requesting pairing code
        await new Promise<void>((resolve) => {
          this.socket!.ev.on("connection.update", (update) => {
            if (update.qr) resolve();
          });
        });
        const code = await this.socket.requestPairingCode(this.options.phoneNumber);
        this._pairingCode = code;
        return { pairingCode: code };
      }
    }

    return {};
  }

  private addEventListeners(saveCreds: () => Promise<void>) {
    if (!this.socket) return;

    this.socket.ev.on("creds.update", saveCreds);

    // Connection events
    this.socket.ev.on("connection.update", async (update) => {
      await this.handleConnectionUpdate(update);
    });

    // Message events
    this.socket.ev.on("messages.upsert", async (m) => {
      await this.handleMessagesUpsert(m);
    });

    this.socket.ev.on("messages.update", async (m) => {
      await this.handleMessagesUpdate(m);
    });

    this.socket.ev.on("messages.delete", (m) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "messages.delete", data: m });
    });

    this.socket.ev.on("messages.reaction", (m) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "messages.reaction", data: m });
    });

    this.socket.ev.on("messages.media-update", (m) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "messages.media-update", data: m });
    });

    this.socket.ev.on("message-receipt.update", async (m) => {
      await this.handleMessageReceiptUpdate(m);
    });

    // Chat events
    this.socket.ev.on("chats.upsert", (c) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "chats.upsert", data: c });
    });

    this.socket.ev.on("chats.update", (c) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "chats.update", data: c });
    });

    this.socket.ev.on("chats.delete", (c) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "chats.delete", data: c });
    });

    // Contact events
    this.socket.ev.on("contacts.upsert", (c) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "contacts.upsert", data: c });
    });

    this.socket.ev.on("contacts.update", (c) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "contacts.update", data: c });
    });

    // Group events
    this.socket.ev.on("groups.upsert", (g) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "groups.upsert", data: g });
    });

    this.socket.ev.on("groups.update", (g) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "groups.update", data: g });
    });

    this.socket.ev.on("group-participants.update", (g) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "group-participants.update", data: g });
    });

    // Presence & labels
    this.socket.ev.on("presence.update", (p) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "presence.update", data: p });
    });

    this.socket.ev.on("labels.edit", (l) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "labels.edit", data: l });
    });

    this.socket.ev.on("labels.association", (l) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "labels.association", data: l });
    });

    // Blocklist
    this.socket.ev.on("blocklist.set", (b) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "blocklist.set", data: b });
    });

    this.socket.ev.on("blocklist.update", (b) => {
      this.sendToWebhook({ sessionId: this.sessionId, event: "blocklist.update", data: b });
    });

    // History sync
    this.socket.ev.on("messaging-history.set", (h) => {
      if (this.options.syncFullHistory) {
        this.sendToWebhook({ sessionId: this.sessionId, event: "messaging-history.set", data: h });
      }
    });
  }

  // ──────────────────────────────────────
  // Event Handlers
  // ──────────────────────────────────────

  private async handleConnectionUpdate(update: Partial<ConnectionState>) {
    const { connection, lastDisconnect, qr } = update;

    if (connection === "open") {
      this._isConnected = true;
      this._qrCode = null;
      this.reconnectCount = 0;
      logger.info("[%s] Connected successfully", this.sessionId);
    }

    if (connection === "close") {
      this._isConnected = false;
      const error = lastDisconnect?.error as Boom;
      const statusCode = error?.output?.statusCode;
      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut &&
        this.reconnectCount < config.baileys.maxRetries;

      if (shouldReconnect) {
        this.reconnectCount++;
        logger.info("[%s] Reconnecting (attempt %d/%d)...", this.sessionId, this.reconnectCount, config.baileys.maxRetries);
        this.socket = null;
        setTimeout(() => {
          this.connect().catch((err) => {
            logger.error("[%s] Reconnection failed: %s", this.sessionId, errorToString(err));
          });
        }, statusCode === DisconnectReason.restartRequired ? 0 : config.baileys.reconnectInterval);
        return;
      }

      logger.info("[%s] Connection closed permanently (statusCode: %d)", this.sessionId, statusCode);
      await this.close();
      return;
    }

    if (qr) {
      this._qrCode = await toDataURL(qr);
      this.sendToWebhook({
        sessionId: this.sessionId,
        event: "connection.update",
        data: { ...update, qrDataUrl: this._qrCode },
      });
      return;
    }

    this.sendToWebhook({
      sessionId: this.sessionId,
      event: "connection.update",
      data: update,
    });
  }

  private async handleMessagesUpsert(data: BaileysEventMap["messages.upsert"]) {
    const payload: WebhookPayload = {
      sessionId: this.sessionId,
      event: "messages.upsert",
      data,
    };

    // Download media if configured
    const includeMedia = this.options.includeMedia ?? config.media.includeBase64;
    if (includeMedia) {
      try {
        const media = await downloadMediaFromMessages(data.messages, { includeBase64: true });
        if (media) {
          payload.extra = { media };
        }
      } catch (error) {
        logger.error("[%s] Media download error: %s", this.sessionId, errorToString(error));
      }
    }

    this.sendToWebhook(payload);
  }

  private async handleMessagesUpdate(data: BaileysEventMap["messages.update"]) {
    const enriched = data.map(({ key, update }) => ({
      key,
      update: {
        ...update,
        status: update.status ? WAMessageStatus[update.status] : undefined,
      },
    }));
    this.sendToWebhook({ sessionId: this.sessionId, event: "messages.update", data: enriched });
  }

  private async handleMessageReceiptUpdate(data: BaileysEventMap["message-receipt.update"]) {
    this.sendToWebhook({ sessionId: this.sessionId, event: "message-receipt.update", data });
  }

  // ──────────────────────────────────────
  // Public API Methods
  // ──────────────────────────────────────

  private safeSocket() {
    if (!this.socket) throw new BaileysNotConnectedError();
    return this.socket;
  }

  async sendMessage(receiver: string, message: AnyMessageContent, options?: { quoted?: WAMessage }) {
    return this.safeSocket().sendMessage(receiver, message, { quoted: options?.quoted });
  }

  async sendMessageWithDelay(receiver: string, message: AnyMessageContent, delayMs = 1000) {
    await delay(delayMs);
    return this.safeSocket().sendMessage(receiver, message);
  }

  async sendPresenceUpdate(type: WAPresence, toJid?: string) {
    if (!this.safeSocket().authState.creds.me) return;

    await this.safeSocket().sendPresenceUpdate(type, toJid);

    // Auto-clear online presence
    if (this.clearOnlinePresenceTimeout && ["unavailable", "available"].includes(type)) {
      clearTimeout(this.clearOnlinePresenceTimeout);
      this.clearOnlinePresenceTimeout = null;
    }
    if (type === "available") {
      this.clearOnlinePresenceTimeout = setTimeout(() => {
        this.socket?.sendPresenceUpdate("unavailable", toJid);
      }, 60000);
    }
  }

  async readMessages(keys: proto.IMessageKey[]) {
    return this.safeSocket().readMessages(keys);
  }

  async deleteMessage(jid: string, key: proto.IMessageKey & { id: string }) {
    return this.safeSocket().sendMessage(jid, { delete: key });
  }

  async editMessage(jid: string, key: proto.IMessageKey, messageContent: AnyMessageContent) {
    return this.safeSocket().sendMessage(jid, { ...messageContent, edit: key } as AnyMessageContent);
  }

  async chatModify(mod: ChatModification, jid: string) {
    return this.safeSocket().chatModify(mod, jid);
  }

  async fetchMessageHistory(count: number, oldestMsgKey: proto.IMessageKey, oldestMsgTimestamp: number) {
    return this.safeSocket().fetchMessageHistory(count, oldestMsgKey, oldestMsgTimestamp);
  }

  async sendReceipts(keys: proto.IMessageKey[], type: MessageReceiptType) {
    return this.safeSocket().sendReceipts(keys, type);
  }

  async onWhatsApp(...jids: string[]) {
    return this.safeSocket().onWhatsApp(...jids);
  }

  async isOnWhatsApp(jid: string): Promise<boolean> {
    try {
      const results = await this.safeSocket().onWhatsApp(jid);
      return results?.[0]?.exists ?? false;
    } catch {
      return false;
    }
  }

  async profilePictureUrl(jid: string, type?: "preview" | "image") {
    return this.safeSocket().profilePictureUrl(jid, type);
  }

  async updateProfilePicture(jid: string, image: { url: string } | Buffer) {
    return this.safeSocket().updateProfilePicture(jid, image);
  }

  async updateProfileStatus(status: string) {
    return this.safeSocket().updateProfileStatus(status);
  }

  async updateProfileName(name: string) {
    return this.safeSocket().updateProfileName(name);
  }

  async fetchStatus(jid: string) {
    return this.safeSocket().fetchStatus(jid);
  }

  async updateBlockStatus(jid: string, action: "block" | "unblock") {
    return this.safeSocket().updateBlockStatus(jid, action);
  }

  // Group operations
  async groupCreate(name: string, participants: string[]) {
    return this.safeSocket().groupCreate(name, participants);
  }

  async groupMetadata(jid: string) {
    return this.safeSocket().groupMetadata(jid);
  }

  async groupFetchAllParticipating() {
    return this.safeSocket().groupFetchAllParticipating();
  }

  async groupParticipantsUpdate(jid: string, participants: string[], action: ParticipantAction) {
    return this.safeSocket().groupParticipantsUpdate(jid, participants, action);
  }

  async groupUpdateSubject(jid: string, subject: string) {
    return this.safeSocket().groupUpdateSubject(jid, subject);
  }

  async groupUpdateDescription(jid: string, description?: string) {
    return this.safeSocket().groupUpdateDescription(jid, description);
  }

  async groupSettingUpdate(jid: string, setting: "announcement" | "not_announcement" | "locked" | "unlocked") {
    return this.safeSocket().groupSettingUpdate(jid, setting);
  }

  async groupLeave(jid: string) {
    return this.safeSocket().groupLeave(jid);
  }

  async groupInviteCode(jid: string) {
    return this.safeSocket().groupInviteCode(jid);
  }

  async groupRevokeInvite(jid: string) {
    return this.safeSocket().groupRevokeInvite(jid);
  }

  async groupAcceptInvite(code: string) {
    return this.safeSocket().groupAcceptInvite(code);
  }

  // Store access
  getStore(): MemoryStore {
    return this.store;
  }

  // ──────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────

  private async close() {
    if (this.authResult?.clearState) {
      await this.authResult.clearState();
    }
    this.socket = null;
    this._isConnected = false;
    this.reconnectCount = 0;
    if (this.clearOnlinePresenceTimeout) {
      clearTimeout(this.clearOnlinePresenceTimeout);
    }
    this.options.onConnectionClose?.();
  }

  async logout() {
    try {
      await this.safeSocket().logout();
    } catch (error) {
      logger.error("[%s] Logout error: %s", this.sessionId, errorToString(error));
    }
    await this.close();
  }

  async destroy() {
    this.store.writeToFile();
    await this.close();
  }

  // ──────────────────────────────────────
  // Webhook
  // ──────────────────────────────────────

  private async sendToWebhook(payload: WebhookPayload) {
    const webhookUrl = this.options.webhookUrl || config.webhook.url;
    if (!webhookUrl) return;

    // Check allowed events
    const eventName = payload.event.toUpperCase().replace(/[.-]/g, "_");
    if (!config.webhook.allowedEvents.has("ALL") && !config.webhook.allowedEvents.has(eventName)) {
      return;
    }

    // Emit to dashboard event bus (for SSE monitor)
    eventBus.emit("baileys-event", {
      sessionId: payload.sessionId,
      event: payload.event,
      data: payload.data,
      timestamp: Date.now(),
    });

    const sanitizedPayload = deepSanitizeObject(payload, { omitKeys: [...LOGGER_OMIT_KEYS] });
    logger.debug({ sessionId: this.sessionId, payload: sanitizedPayload }, "Webhook payload");

    const { maxRetries, retryInterval, backoffFactor } = config.webhook.retryPolicy;
    let attempt = 0;
    let currentDelay = retryInterval;

    while (attempt <= maxRetries) {
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          logger.debug("[%s] Webhook delivered successfully", this.sessionId);
          return;
        }

        logger.warn("[%s] Webhook failed (HTTP %d), attempt %d/%d",
          this.sessionId, response.status, attempt + 1, maxRetries);
      } catch (error) {
        logger.error("[%s] Webhook error: %s, attempt %d/%d",
          this.sessionId, errorToString(error), attempt + 1, maxRetries);
      }

      attempt++;
      if (attempt <= maxRetries) {
        const jitter = Math.floor(Math.random() * 1000);
        await asyncSleep(currentDelay + jitter);
        currentDelay *= backoffFactor;
      }
    }

    logger.error("[%s] Webhook failed after %d attempts", this.sessionId, maxRetries + 1);
  }
}
