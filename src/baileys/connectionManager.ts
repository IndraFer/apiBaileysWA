import { BaileysConnection, BaileysNotConnectedError } from "@/baileys/connection";
import { getSavedSessionsWithMetadata, deleteAuthState } from "@/baileys/authState";
import type { SessionOptions, SessionMetadata } from "@/baileys/types";
import config from "@/config";
import logger from "@/lib/logger";
import { errorToString } from "@/utils/validation";

/**
 * Manages all active WhatsApp sessions.
 */
class ConnectionManager {
  private connections = new Map<string, BaileysConnection>();

  /**
   * Reconnect all saved sessions on startup.
   */
  async reconnectSavedSessions(): Promise<void> {
    const saved = await getSavedSessionsWithMetadata<SessionMetadata>();

    if (saved.length === 0) {
      logger.info("No saved sessions to reconnect");
      return;
    }

    logger.info("Reconnecting %d saved sessions: %o", saved.length, saved.map((s) => s.id));

    for (const { id, metadata } of saved) {
      try {
        const connection = new BaileysConnection(id, {
          clientName: metadata?.clientName,
          webhookUrl: metadata?.webhookUrl,
          includeMedia: metadata?.includeMedia,
          syncFullHistory: metadata?.syncFullHistory,
          isReconnect: true,
          onConnectionClose: () => {
            this.connections.delete(id);
            logger.debug("Session closed: %s (active: %d)", id, this.connections.size);
          },
        });

        this.connections.set(id, connection);
        await connection.connect();
        logger.info("Reconnected session: %s", id);
      } catch (error) {
        logger.error("Failed to reconnect session %s: %s", id, errorToString(error));
      }
    }
  }

  /**
   * Create or reconnect a session.
   */
  async createSession(
    sessionId: string,
    options: SessionOptions
  ): Promise<{ qrCode?: string; pairingCode?: string }> {
    // If session exists and is connected, return existing state
    const existing = this.connections.get(sessionId);
    if (existing?.isConnected) {
      return { qrCode: existing.qrCode ?? undefined };
    }

    // If exists but not connected, clean up
    if (existing) {
      await existing.destroy();
      this.connections.delete(sessionId);
    }

    // Enforce maximum session limit
    if (this.connections.size >= config.maxSessions) {
      throw new Error(`Maximum session limit (${config.maxSessions}) reached. Delete unused sessions first.`);
    }

    const connection = new BaileysConnection(sessionId, {
      ...options,
      onConnectionClose: () => {
        this.connections.delete(sessionId);
        options.onConnectionClose?.();
        logger.debug("Session closed: %s (active: %d)", sessionId, this.connections.size);
      },
    });

    this.connections.set(sessionId, connection);
    const result = await connection.connect();
    logger.info("Session created: %s (active: %d)", sessionId, this.connections.size);

    return result;
  }

  /**
   * Get an active connection by session ID.
   */
  getSession(sessionId: string): BaileysConnection {
    const conn = this.connections.get(sessionId);
    if (!conn) throw new BaileysNotConnectedError();
    return conn;
  }

  /**
   * Check if a session exists.
   */
  hasSession(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  /**
   * Get session status.
   */
  getSessionStatus(sessionId: string): {
    exists: boolean;
    connected: boolean;
    user: unknown;
    qrCode: string | null;
  } {
    const conn = this.connections.get(sessionId);
    return {
      exists: !!conn,
      connected: conn?.isConnected ?? false,
      user: conn?.user ?? null,
      qrCode: conn?.qrCode ?? null,
    };
  }

  /**
   * List all active sessions.
   */
  listSessions(): Array<{ sessionId: string; connected: boolean; user: unknown }> {
    return [...this.connections.entries()].map(([id, conn]) => ({
      sessionId: id,
      connected: conn.isConnected,
      user: conn.user,
    }));
  }

  /**
   * Delete a session and its auth state.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const conn = this.connections.get(sessionId);
    if (conn) {
      await conn.logout();
      this.connections.delete(sessionId);
    }
    await deleteAuthState(sessionId);
    logger.info("Session deleted: %s (active: %d)", sessionId, this.connections.size);
  }

  /**
   * Graceful shutdown — save all stores and clean up.
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down %d sessions...", this.connections.size);
    const promises = [...this.connections.values()].map((conn) => conn.destroy());
    await Promise.allSettled(promises);
    this.connections.clear();
  }
}

// Singleton
const connectionManager = new ConnectionManager();
export default connectionManager;
