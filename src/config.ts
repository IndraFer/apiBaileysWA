import type { LevelWithSilentOrString } from "pino";

const {
  NODE_ENV,
  HOST,
  PORT,
  LOG_LEVEL,
  AUTH_GLOBAL_TOKEN,
  REDIS_ENABLED,
  REDIS_URL,
  REDIS_PASSWORD,
  BAILEYS_LOG_LEVEL,
  BAILEYS_CLIENT_VERSION,
  MAX_RETRIES,
  RECONNECT_INTERVAL,
  IGNORE_GROUP_MESSAGES,
  IGNORE_STATUS_MESSAGES,
  IGNORE_BROADCAST_MESSAGES,
  IGNORE_NEWSLETTER_MESSAGES,
  IGNORE_BOT_MESSAGES,
  IGNORE_META_AI_MESSAGES,
  WEBHOOK_URL,
  WEBHOOK_ALLOWED_EVENTS,
  WEBHOOK_RETRY_MAX,
  WEBHOOK_RETRY_INTERVAL,
  WEBHOOK_BACKOFF_FACTOR,
  WEBHOOK_SIGNATURE_MODE,
  WEBHOOK_ALLOW_GLOBAL_TOKEN_FALLBACK,
  BROADCAST_MIN_DELAY_MS,
  BROADCAST_MAX_DELAY_MS,
  BROADCAST_BATCH_SIZE,
  BROADCAST_BATCH_PAUSE_MS,
  MEDIA_INCLUDE_BASE64,
  MEDIA_CLEANUP_ENABLED,
  MEDIA_CLEANUP_INTERVAL_MS,
  MEDIA_MAX_AGE_HOURS,
  CORS_ORIGIN,
  DASHBOARD_ENABLED,
  DASHBOARD_REGISTRATION_ENABLED,
  DASHBOARD_REGISTRATION_REQUIRE_APPROVAL,
  DASHBOARD_JWT_SECRET,
  DASHBOARD_PASSWORD_MIN_LENGTH,
  SIMULATE_TYPING_BEFORE_SEND,
  SIMULATE_TYPING_DELAY_MIN_MS,
  SIMULATE_TYPING_DELAY_MAX_MS,
  AUTO_READ_MESSAGES,
  AUTO_MARK_ONLINE,
  MAX_SESSIONS,
  REJECT_CALLS,
} = process.env;

const config = {
  env: (NODE_ENV || "development") as "development" | "production",
  host: HOST || "0.0.0.0",
  port: PORT ? Number(PORT) : 3000,
  logLevel: (LOG_LEVEL || "info") as LevelWithSilentOrString,

  auth: {
    globalToken: AUTH_GLOBAL_TOKEN || "",
  },

  redis: {
    enabled: REDIS_ENABLED === "true",
    url: REDIS_URL || "redis://localhost:6379",
    password: REDIS_PASSWORD || "",
  },

  baileys: {
    logLevel: (BAILEYS_LOG_LEVEL || "warn") as LevelWithSilentOrString,
    clientVersion: BAILEYS_CLIENT_VERSION || "default",
    maxRetries: MAX_RETRIES ? Number(MAX_RETRIES) : 5,
    reconnectInterval: RECONNECT_INTERVAL ? Number(RECONNECT_INTERVAL) : 5000,
    ignoreGroupMessages: IGNORE_GROUP_MESSAGES === "true",
    ignoreStatusMessages: IGNORE_STATUS_MESSAGES ? IGNORE_STATUS_MESSAGES === "true" : true,
    ignoreBroadcastMessages: IGNORE_BROADCAST_MESSAGES
      ? IGNORE_BROADCAST_MESSAGES === "true"
      : true,
    ignoreNewsletterMessages: IGNORE_NEWSLETTER_MESSAGES
      ? IGNORE_NEWSLETTER_MESSAGES === "true"
      : true,
    ignoreBotMessages: IGNORE_BOT_MESSAGES ? IGNORE_BOT_MESSAGES === "true" : true,
    ignoreMetaAiMessages: IGNORE_META_AI_MESSAGES ? IGNORE_META_AI_MESSAGES === "true" : true,
  },

  webhook: {
    url: WEBHOOK_URL || "",
    allowedEvents: new Set(
      WEBHOOK_ALLOWED_EVENTS ? WEBHOOK_ALLOWED_EVENTS.split(",").map((e) => e.trim()) : ["ALL"],
    ),
    signatureMode: (WEBHOOK_SIGNATURE_MODE || "optional") as "off" | "optional" | "required",
    allowGlobalTokenFallback:
      WEBHOOK_ALLOW_GLOBAL_TOKEN_FALLBACK !== undefined
        ? WEBHOOK_ALLOW_GLOBAL_TOKEN_FALLBACK === "true"
        : (NODE_ENV || "development") !== "production",
    retryPolicy: {
      maxRetries: WEBHOOK_RETRY_MAX ? Number(WEBHOOK_RETRY_MAX) : 3,
      retryInterval: WEBHOOK_RETRY_INTERVAL ? Number(WEBHOOK_RETRY_INTERVAL) : 5000,
      backoffFactor: WEBHOOK_BACKOFF_FACTOR ? Number(WEBHOOK_BACKOFF_FACTOR) : 3,
    },
  },

  broadcast: {
    minDelayMs: BROADCAST_MIN_DELAY_MS ? Number(BROADCAST_MIN_DELAY_MS) : 1500,
    maxDelayMs: BROADCAST_MAX_DELAY_MS ? Number(BROADCAST_MAX_DELAY_MS) : 3000,
    batchSize: BROADCAST_BATCH_SIZE ? Number(BROADCAST_BATCH_SIZE) : 10,
    batchPauseMs: BROADCAST_BATCH_PAUSE_MS ? Number(BROADCAST_BATCH_PAUSE_MS) : 5000,
  },

  media: {
    includeBase64: MEDIA_INCLUDE_BASE64 === "true",
    cleanupEnabled: MEDIA_CLEANUP_ENABLED ? MEDIA_CLEANUP_ENABLED === "true" : true,
    cleanupIntervalMs: MEDIA_CLEANUP_INTERVAL_MS ? Number(MEDIA_CLEANUP_INTERVAL_MS) : 3600000,
    maxAgeHours: MEDIA_MAX_AGE_HOURS ? Number(MEDIA_MAX_AGE_HOURS) : 24,
  },

  corsOrigin: (() => {
    const raw = CORS_ORIGIN || "*";
    if (raw === "*") return "*";
    const origins = raw
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    return origins.length === 1 ? origins[0] : origins;
  })(),

  /** Maximum concurrent sessions allowed */
  maxSessions: MAX_SESSIONS ? Number(MAX_SESSIONS) : 50,

  dashboard: {
    enabled: DASHBOARD_ENABLED ? DASHBOARD_ENABLED === "true" : true,
    registrationEnabled: DASHBOARD_REGISTRATION_ENABLED === "true",
    registrationRequireApproval: DASHBOARD_REGISTRATION_REQUIRE_APPROVAL === "true",
    jwtSecret: DASHBOARD_JWT_SECRET || "baileys-wa-api-dashboard-secret-change-me",
    passwordMinLength: DASHBOARD_PASSWORD_MIN_LENGTH ? Number(DASHBOARD_PASSWORD_MIN_LENGTH) : 6,
  },

  simulation: {
    typingBeforeSend: SIMULATE_TYPING_BEFORE_SEND !== "false",
    typingDelayMinMs: SIMULATE_TYPING_DELAY_MIN_MS ? Number(SIMULATE_TYPING_DELAY_MIN_MS) : 1500,
    typingDelayMaxMs: SIMULATE_TYPING_DELAY_MAX_MS ? Number(SIMULATE_TYPING_DELAY_MAX_MS) : 3000,
    autoReadMessages: AUTO_READ_MESSAGES === "true",
    autoMarkOnline: AUTO_MARK_ONLINE !== "false",
    rejectCalls: REJECT_CALLS === "true",
  },

  autoReply: {
    enabled: process.env.AUTO_REPLY_ENABLED === "true",
    message:
      process.env.AUTO_REPLY_MESSAGE ||
      "Hello, we're currently away.\nWe'll reply to your message soon.",
    type: (process.env.AUTO_REPLY_TYPE || "always") as "always" | "time_range" | "on_webhook_fail",
    timeStart: process.env.AUTO_REPLY_TIME_START || "18:00",
    timeEnd: process.env.AUTO_REPLY_TIME_END || "08:00",
  },
};

export default config;
export type Config = typeof config;
