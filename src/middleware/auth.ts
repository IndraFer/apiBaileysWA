import type { Context, Next } from "hono";
import config from "@/config";
import { getRedis, isRedisAvailable } from "@/lib/redis";
import logger from "@/lib/logger";

const REDIS_API_KEY_PREFIX = "@baileys-wa-api:api-keys";

export interface AuthData {
  role: "user" | "admin";
}

/**
 * Authentication middleware.
 * - Development: skips auth
 * - Simple mode (AUTH_GLOBAL_TOKEN): checks `Authorization: Bearer <token>` header
 * - Redis mode: checks `x-api-key` header against Redis-stored keys
 */
export async function authMiddleware(c: Context, next: Next) {
  // Skip auth in development
  if (config.env === "development") {
    return next();
  }

  // Try simple token auth first
  if (config.auth.globalToken) {
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (token === config.auth.globalToken) {
      return next();
    }
  }

  // Try Redis API key auth
  if (isRedisAvailable()) {
    const apiKey = c.req.header("x-api-key");
    if (apiKey) {
      try {
        const redis = getRedis()!;
        const raw = await redis.get(`${REDIS_API_KEY_PREFIX}:${apiKey}`);

        if (raw) {
          const auth: AuthData = JSON.parse(raw);
          c.set("auth", auth);
          return next();
        }
      } catch (error) {
        logger.error("Auth middleware error: %s", (error as Error).message);
      }
    }
  }

  // No simple token and no Redis key → check if simple token was configured
  if (config.auth.globalToken) {
    return c.json({ success: false, message: "Unauthorized: invalid token" }, 401);
  }

  return c.json({ success: false, message: "Unauthorized: API key required" }, 401);
}

/**
 * Admin-only guard (requires Redis API key with admin role).
 */
export async function adminGuard(c: Context, next: Next) {
  await authMiddleware(c, async () => {});

  const auth = c.get("auth") as AuthData | undefined;
  if (auth?.role !== "admin" && config.env !== "development") {
    return c.json({ success: false, message: "Forbidden: admin access required" }, 403);
  }

  return next();
}
