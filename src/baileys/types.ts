import type {
  AnyMessageContent,
  BaileysEventMap,
  ConnectionState,
  ParticipantAction,
  WAMessage,
  WAPresence,
  WAConnectionState,
  proto,
  ChatModification,
  MessageReceiptType,
} from "@whiskeysockets/baileys";

export interface SessionOptions {
  /** Display name for the client browser */
  clientName?: string;
  /** Webhook URL for this session */
  webhookUrl?: string;
  /** Whether to use pairing code instead of QR */
  usePairingCode?: boolean;
  /** Phone number for pairing code */
  phoneNumber?: string;
  /** Include media as base64 in webhook events */
  includeMedia?: boolean;
  /** Sync full message history */
  syncFullHistory?: boolean;
  /** Callback when connection closes */
  onConnectionClose?: () => void;
  /** Whether this is a reconnection */
  isReconnect?: boolean;
  /** Override: simulate typing before send (per-session) */
  simulateTyping?: boolean;
  /** Override: auto-read incoming messages (per-session) */
  autoReadMessages?: boolean;
}

export interface SessionMetadata {
  clientName?: string;
  webhookUrl?: string;
  includeMedia?: boolean;
  syncFullHistory?: boolean;
}

export interface WebhookPayload {
  sessionId: string;
  event: string;
  data: unknown;
  extra?: Record<string, unknown>;
}

export interface BroadcastMessage {
  receiver: string;
  message: AnyMessageContent;
  delay?: number;
}

export interface BroadcastJob {
  id: string;
  sessionId: string;
  messages: BroadcastMessage[];
  status: "pending" | "running" | "completed" | "cancelled" | "failed";
  progress: number;
  total: number;
  errors: Array<{ index: number; receiver: string; error: string }>;
  createdAt: number;
}
