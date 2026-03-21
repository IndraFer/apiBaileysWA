import {
  type AuthenticationCreds,
  type AuthenticationState,
  BufferJSON,
  initAuthCreds,
  proto,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { getRedis } from "@/lib/redis";
import logger from "@/lib/logger";

const REDIS_KEY_PREFIX = "@baileys-wa-api:connections";

export async function useRedisAuthState(
  sessionId: string,
  metadata?: unknown
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis is not available for auth state");

  const createKey = (key: string) => `${REDIS_KEY_PREFIX}:${sessionId}:${key}`;

  const writeData = (key: string, field: string, data: unknown) =>
    redis.hSet(createKey(key), field, JSON.stringify(data, BufferJSON.replacer));

  const readData = async (key: string, field: string) => {
    const data = await redis.hGet(createKey(key), field);
    return data ? JSON.parse(data, BufferJSON.reviver) : null;
  };

  const creds: AuthenticationCreds =
    (await readData("authState", "creds")) || initAuthCreds();

  // Store metadata (webhook URL, options, etc.)
  if (metadata) {
    await redis.hSet(createKey("authState"), "metadata", JSON.stringify(metadata));
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [_: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              const value = await readData("authState", `${type}-${id}`);
              data[id] =
                type === "app-state-sync-key" && value
                  ? proto.Message.AppStateSyncKeyData.fromObject(value)
                  : value;
            })
          );
          return data;
        },
        set: async (data) => {
          type DataKey = keyof typeof data;
          const multi = redis.multi();
          for (const category in data) {
            for (const id in data[category as DataKey]) {
              const field = `${category}-${id}`;
              const value = data[category as DataKey]?.[id];
              if (value) {
                multi.hSet(
                  createKey("authState"),
                  field,
                  JSON.stringify(value, BufferJSON.replacer)
                );
              } else {
                multi.hDel(createKey("authState"), field);
              }
            }
          }
          await multi.execAsPipeline();
        },
        clear: async () => {
          await redis.del(createKey("authState"));
          logger.debug("[Redis Auth] Cleared auth state for session: %s", sessionId);
        },
      },
    },
    saveCreds: async () => {
      await writeData("authState", "creds", creds);
    },
  };
}

/**
 * Get all saved session IDs from Redis with their metadata.
 */
export async function getRedisSavedSessionIds<T>(): Promise<
  Array<{ id: string; metadata: T }>
> {
  const redis = getRedis();
  if (!redis) return [];

  const keys = await redis.keys(`${REDIS_KEY_PREFIX}:*:authState`);
  const ids = keys.map((key) => key.split(":").at(-2) ?? "").filter(Boolean);

  if (ids.length === 0) return [];

  const multi = redis.multi();
  for (const id of ids) {
    multi.hGet(`${REDIS_KEY_PREFIX}:${id}:authState`, "metadata");
  }
  const metadata = await multi.execAsPipeline();

  return ids
    .map((id, i) => ({
      id,
      metadata: metadata[i] ? JSON.parse(metadata[i] as unknown as string) : null,
    }))
    .filter((item) => item.metadata) as Array<{ id: string; metadata: T }>;
}

/**
 * Delete Redis auth state for a session.
 */
export async function deleteRedisAuthState(sessionId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(`${REDIS_KEY_PREFIX}:${sessionId}:authState`);
}

export async function updateRedisSessionMetadata(sessionId: string, metadata: unknown): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hSet(`${REDIS_KEY_PREFIX}:${sessionId}:authState`, "metadata", JSON.stringify(metadata));
}
