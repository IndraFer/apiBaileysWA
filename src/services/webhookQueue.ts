import config from "@/config";

/**
 * Global Webhook Queue to prevent memory leaks and EMFILE errors
 * during traffic spikes or when the webhook server is slow/down.
 */

class ConcurrencyQueue {
  private concurrency: number;
  private running = 0;
  private queue: (() => void)[] = [];

  constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  async add<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  get pending() {
    return this.queue.length;
  }
}

// Allow up to concurrent webhook delivery fetches globally.
// This prevents NodeJS from crashing with EMFILE or OOM during massive spikes.
// Can be customized via WEBHOOK_CONCURRENCY in .env
export const webhookQueue = new ConcurrencyQueue(config.webhook.concurrency);
