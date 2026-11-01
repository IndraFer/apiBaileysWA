import type { AnyMessageContent } from "@whiskeysockets/baileys";

export interface AutoReplyConfig {
  enabled: boolean;
  message: string;
  type: "always" | "time_range" | "on_webhook_fail";
  timeStart?: string; // HH:mm
  timeEnd?: string; // HH:mm
}

/**
 * Time-based routing between a human CS and the AI agent.
 *
 * Every value is optional on the wire: whatever the dashboard does not set
 * falls back to the global env defaults (`config.routing`).
 */
export interface RoutingConfig {
  /** IANA timezone used to evaluate the AI window. Default: Asia/Jakarta. */
  timezone?: string;
  /** Start of the AI window (HH:mm). Supports windows crossing midnight. */
  aiWindowStart?: string;
  /** End of the AI window (HH:mm). */
  aiWindowEnd?: string;
  /** Debounce before forwarding: reset on every new inbound message. */
  batchIdleMs?: number;
  /** Hard cap so a continuously typing customer cannot delay forever. */
  batchMaxWaitMs?: number;
  /** Max messages folded into a single AI prompt. */
  maxBatchMessages?: number;
  /** How long a conversation stays human-owned after human activity. */
  humanIdleMs?: number;
  /** Pause applied when the AI asks for a human takeover. */
  handoffPauseMs?: number;
}

/**
 * One parameter of a knowledge endpoint, as exposed to the model.
 * Each endpoint declares its own parameters — nothing is hardcoded.
 */
export interface RagEndpointParam {
  name: string;
  type: "string" | "number" | "integer" | "boolean";
  description: string;
  required?: boolean;
  /** Where the value goes. Default: query for GET, body for POST. */
  in?: "query" | "body" | "path";
  enum?: string[];
  default?: string | number | boolean;
}

/**
 * A simple, non-vector knowledge endpoint the AI may call.
 * The gateway turns this into a tool schema; the URL must already be
 * allowlisted by configuration (never taken from a prompt).
 */
export interface RagEndpointConfig {
  name: string;
  description: string;
  method: "GET" | "POST";
  url: string;
  /** Declared parameters; unset values fall back to each default. */
  params?: RagEndpointParam[];
  timeoutMs?: number;
  maxResponseChars?: number;
}

/**
 * Per-number AI agent configuration.
 * Credentials stay encrypted (see lib/secretBox) and are never returned raw.
 */
export interface AiAgentConfig {
  enabled?: boolean;
  /** "openai" = OpenAI-compatible (OpenRouter/OpenAI/Groq/Ollama); "webhook" = external gateway. */
  driver?: "openai" | "webhook";
  /** OpenAI-compatible base URL, e.g. https://openrouter.ai/api/v1 */
  baseUrl?: string;
  /** Model slug, e.g. openai/gpt-4o-mini */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Max tool-calling rounds per reply (guards loops). */
  toolMaxRounds?: number;
  timeoutMs?: number;
  /** Gateway URL for the webhook driver; falls back to AI_AGENT_URL. */
  agentUrl?: string;
  /** Per-number system instruction (persona + tool guidance). */
  systemInstruction?: string;
  ragEndpoints?: RagEndpointConfig[];
  /** Encrypted JSON blob with per-endpoint credentials and the provider key. */
  credentials?: string;
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
  /** Time-based routing between human CS and AI agent */
  routing?: RoutingConfig;
  /** Per-number AI agent settings */
  ai?: AiAgentConfig;
}

export interface SessionMetadata {
  clientName?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookEvents?: string[];
  includeMedia?: boolean;
  syncFullHistory?: boolean;
  autoReply?: AutoReplyConfig;
  routing?: RoutingConfig;
  ai?: AiAgentConfig;
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
