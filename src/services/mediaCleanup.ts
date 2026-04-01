import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import config from "@/config";
import logger from "@/lib/logger";

const MEDIA_DIR = join(process.cwd(), "media");

export class MediaCleanupService {
  private maxAgeHours: number;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: { maxAgeHours?: number; intervalMs?: number }) {
    this.maxAgeHours = options?.maxAgeHours ?? config.media.maxAgeHours;
    this.intervalMs = options?.intervalMs ?? config.media.cleanupIntervalMs;
  }

  start() {
    logger.info(
      "Media cleanup service started (interval: %dms, maxAge: %dh)",
      this.intervalMs,
      this.maxAgeHours,
    );
    this.timer = setInterval(() => this.cleanup(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private cleanup() {
    try {
      const files = readdirSync(MEDIA_DIR);
      const now = Date.now();
      const maxAge = this.maxAgeHours * 60 * 60 * 1000;
      let deleted = 0;

      for (const file of files) {
        const filePath = join(MEDIA_DIR, file);
        const stats = statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
          unlinkSync(filePath);
          deleted++;
        }
      }

      if (deleted > 0) {
        logger.info("Media cleanup: deleted %d files older than %dh", deleted, this.maxAgeHours);
      }
    } catch (error) {
      // Media directory may not exist yet
      logger.debug("Media cleanup skipped: %s", (error as Error).message);
    }
  }
}
