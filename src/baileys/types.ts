import type { AnyMessageContent } from "@whiskeysockets/baileys";

export interface AutoReplyConfig {
  enabled: boolean;
  message: string;
  type: "always" | "time_range" | "on_webhook_fail";
  timeStart?: string; // HH:mm
  timeEnd?: string; // HH:mm
}

export interface SessionOptions {
  /** Display name for the client browser */
  clientName?: string;
  /** Webhook URL for this session */
  webhookUrl?: string;
  /** Optional per-session webhook secret header value */
  webhookSecret?: string;
  /** Whether to use pairing code instead of QR */
  usePairingCode?: boolean;
  /** Phone number for pairing code */
  phoneNumber?: string;
  /** Include media as base64 in webhook events */
  includeMedia?: boolean;
  /** Session-level webhook events */
  webhookEvents?: string[];
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
  /** Auto-reply configuration */
  autoReply?: AutoReplyConfig;
}

export interface SessionMetadata {
  clientName?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookEvents?: string[];
  includeMedia?: boolean;
  syncFullHistory?: boolean;
  autoReply?: AutoReplyConfig;
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
