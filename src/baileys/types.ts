import type { AnyMessageContent } from "@whiskeysockets/baileys";

/**
 * One switch decides both "when" and "in what role" the static message runs:
 * - "both"     primary when the AI is off / out of window, fallback on failure
 * - "window"   same, but only inside the configured time range
 * - "fallback" only when the AI or webhook delivery fails
 *
 * "primary" is a legacy alias: it answered first but never as a fallback, which
 * is already covered by "both". Stored configs using it resolve to "both".
 */
export type AutoReplyPolicy = "both" | "window" | "primary" | "fallback";

export interface AutoReplyConfig {
  enabled: boolean;
  message: string;
  type: "always" | "time_range" | "on_webhook_fail";
  timeStart?: string; // HH:mm
  timeEnd?: string; // HH:mm
  /**
   * Role inside the responder chain:
   * - "primary"  answers when the AI is off or outside its window
   * - "fallback" answers only when the AI fails (credits, API error, guard)
   * - "both"     both of the above (default, backwards compatible)
   */
  role?: "primary" | "fallback" | "both";
  /**
   * Current selector. When present it wins over `role`/`type`, which stay for
   * older stored configs and API clients.
   */
  policy?: AutoReplyPolicy;
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
  /**
   * Structured parameter list (convenience form). A raw JSON Schema may be
   * supplied instead — either here as an object or via `parameters`.
   */
  params?: RagEndpointParam[] | Record<string, unknown>;
  /** Raw JSON Schema (OpenAI tool schema), forwarded to the model unchanged. */
  parameters?: Record<string, unknown>;
  timeoutMs?: number;
  maxResponseChars?: number;
}

/**
 * Per-number AI agent configuration.
 * Credentials stay encrypted (see lib/secretBox) and are never returned raw.
 */
/** Built-in "send a WhatsApp message" tool for the OpenAI-compatible driver. */
export interface AiSendMessageConfig {
  /** Default false: the tool is not sent to the model unless enabled. */
  enabled?: boolean;
  /** allowlist = current chat plus listed recipients; any = any number/JID. */
  scope?: "allowlist" | "any";
  /** Phone numbers or JIDs allowed when scope is "allowlist". */
  allowlist?: string[];
  /** Hard cap per session, sliding one-hour window. */
  maxPerHour?: number;
}

export type OtpFilterSensitivity = "conservative" | "balanced" | "aggressive";

/**
 * Who may trigger an automatic reply in a group:
 * - "all"     — any participant, in any group
 * - "senders" — only listed participants, in any group
 * - "mention" — only when the account is @mentioned or its message is quoted
 */
export type GroupReplyMode = "all" | "senders" | "mention";

/** Per-session group auto-reply policy. Applies to both AI and static replies. */
export interface GroupReplyConfig {
  /** Default: "mention". */
  mode?: GroupReplyMode;
  /** Participants allowed in "senders" mode. Phone numbers or JIDs. */
  senders?: string[];
  /**
   * Allow the static auto reply in a group when the AI cannot answer there
   * (disabled, outside its window, or failed). Default false: a repeated fixed
   * message in a group is easy to identify as a bot.
   */
  fallbackToStatic?: boolean;
}

/**
 * Group conversation memory. Off by default: it costs one summary call per
 * participant interaction, plus a periodic group digest.
 */
export interface GroupMemoryConfig {
  /** Per-member memory, for groups where the number is addressed. */
  enabled?: boolean;
  /** Digest of the whole group conversation (not only addressed messages). */
  digest?: boolean;
  /** Digest trigger overrides; unset values fall back to the env defaults. */
  digestIdleMs?: number;
  digestMinMessages?: number;
  /** 0 means no daily cap. */
  digestMaxPerDay?: number;
}
export type OtpFilterDetectionMode = "keywords" | "smart";

/** Optional deny-list/keyword filter for OTP and verification messages. */
export interface OtpFilterConfig {
  enabled?: boolean;
  /** Senders whose auto-replies are skipped. One number/JID per entry. */
  ignoredSenders?: string[];
  /** Detection mode; defaults to smart for new configurations. */
  detectionMode?: OtpFilterDetectionMode;
  /** @deprecated Use detectionMode. Retained for old stored configs. */
  keywordFilter?: boolean;
  /** @deprecated Use detectionMode. Retained for old stored configs. */
  smart?: boolean;
  /** Smart-mode threshold; defaults to balanced. */
  sensitivity?: OtpFilterSensitivity;
  /** Operator-maintained keywords; no built-in values. */
  keywords?: string[];
  /** If a keyword matches, do not treat the message as OTP. */
  excludeKeywords?: string[];
}

/**
 * How far the assistant may leave the operator's domain:
 * - "strict"   — only the configured domain, everything else is declined
 * - "flexible" — the domain first, but brief general questions are allowed
 */
export type AiPersonaScope = "strict" | "flexible";

/** Persona scope. The injection-resistance block is not configurable. */
export interface AiPersonaConfig {
  /** Default: "flexible". */
  scope?: AiPersonaScope;
}

/** Per-session memory settings. Empty model means AI_MEMORY_MODEL, then the main model. */
export interface AiMemorySettings {
  model?: string;
}

/** Keyword retrieval over stored memory; needs AI_MEMORY_ENABLED. */
export interface AiRetrievalConfig {
  enabled?: boolean;
}

/** Opt-in built-in web_search tool backed by the operator's SearXNG instance. */
export interface AiWebSearchConfig {
  enabled?: boolean;
}

/** Opt-in image understanding for the OpenAI-compatible driver. */
export interface AiVisionConfig {
  enabled?: boolean;
  /** Optional vision-capable model slug; empty means the main model. */
  model?: string;
}

export interface AiAgentConfig {
  enabled?: boolean;
  /**
   * When the AI may answer:
   * - "off"     — never (use the static auto-reply instead)
   * - "window"  — only inside aiWindowStart..aiWindowEnd (default)
   * - "always"  — 24/7 full handling; a human reply still pauses it
   */
  mode?: "off" | "window" | "always";
  /** "openai" = OpenAI-compatible (OpenRouter/OpenAI/Groq/Ollama); "webhook" = external gateway. */
  driver?: "openai" | "webhook";
  /** OpenAI-compatible base URL, e.g. https://openrouter.ai/api/v1 */
  baseUrl?: string;
  /** Model slug, e.g. openai/gpt-4o-mini */
  model?: string;
  temperature?: number;
  /** Nucleus sampling; standard default 1. */
  topP?: number;
  /** Min-p sampling (OpenRouter / llama.cpp style); 0 = off. */
  minP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
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
  /** Optional built-in send-message tool (default off). */
  sendMessage?: AiSendMessageConfig;
  /** Persona scope: how far the model may leave the configured domain. */
  persona?: AiPersonaConfig;
  /** Keyword retrieval over conversation memory (default on when memory runs). */
  retrieval?: AiRetrievalConfig;
  /** Memory summarisation model (empty = env model, then main model). */
  memory?: AiMemorySettings;
  /** Optional built-in web search tool (default off, requires SEARXNG_URL). */
  webSearch?: AiWebSearchConfig;
  /** Optional image understanding (default off). */
  vision?: AiVisionConfig;
  /** Optional OTP/verification auto-reply filter (default off). */
  otpFilter?: OtpFilterConfig;
}

export interface SessionOptions {
  /** Dashboard user that created this session. */
  ownerId?: string;
  /** Display name for the client browser */
  clientName?: string;
  /** Webhook URL for this session */
  webhookUrl?: string;
  /** Optional per-session webhook secret header value */
  webhookSecret?: string;
  /** Secret kept during a rotation grace window (still accepted until expiry). */
  webhookSecretPrevious?: string;
  /** Epoch ms when webhookSecretPrevious stops being accepted. */
  webhookSecretPreviousExpiresAt?: number;
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
  /** Override: mark presence "available" before composing (per-session) */
  autoMarkOnline?: boolean;
  /** Override: reject incoming calls automatically (per-session) */
  rejectCalls?: boolean;
  /** Auto-reply configuration */
  autoReply?: AutoReplyConfig;
  /** Time-based routing between human CS and AI agent */
  routing?: RoutingConfig;
  /** Per-number AI agent settings */
  ai?: AiAgentConfig;
  /** Group auto-reply policy (applies to AI and static replies). */
  groupReply?: GroupReplyConfig;
  /** Group conversation memory. */
  groupMemory?: GroupMemoryConfig;
}

export interface SessionMetadata {
  /** Dashboard user that created this session (absent for legacy sessions). */
  ownerId?: string;
  clientName?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookSecretPrevious?: string;
  webhookSecretPreviousExpiresAt?: number;
  webhookEvents?: string[];
  includeMedia?: boolean;
  syncFullHistory?: boolean;
  autoReply?: AutoReplyConfig;
  routing?: RoutingConfig;
  ai?: AiAgentConfig;
  groupReply?: GroupReplyConfig;
  groupMemory?: GroupMemoryConfig;
  autoReadMessages?: boolean;
  autoMarkOnline?: boolean;
  rejectCalls?: boolean;
}

export interface WebhookPayload {
  sessionId: string;
  event: string;
  data: unknown;
  extra?: Record<string, unknown>;
  /**
   * Responder-chain context, so an external system knows the AI/static setup
   * and does not reply a second time.
   */
  routing?: {
    aiEnabled: boolean;
    aiMode: "off" | "window" | "always";
    window: string;
    timezone: string;
    staticRole: "primary" | "fallback" | "both";
  };
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
