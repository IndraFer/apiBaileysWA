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
  DASHBOARD_JWT_SECRET,
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
      WEBHOOK_ALLOWED_EVENTS
        ? WEBHOOK_ALLOWED_EVENTS.split(",").map((e) => e.trim())
        : ["ALL"]
    ),
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

  corsOrigin: CORS_ORIGIN || "*",

  dashboard: {
    enabled: DASHBOARD_ENABLED ? DASHBOARD_ENABLED === "true" : true,
    registrationEnabled: DASHBOARD_REGISTRATION_ENABLED === "true",
    jwtSecret: DASHBOARD_JWT_SECRET || "baileys-wa-api-dashboard-secret-change-me",
  },
};

export default config;
export type Config = typeof config;
