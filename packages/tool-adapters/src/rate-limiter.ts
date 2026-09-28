export interface GlobalRateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

export class GlobalRateLimiter {
  private readonly timestamps: Map<string, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(options: GlobalRateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
  }

  /**
   * Tries to acquire an execution slot for the given key in the sliding window.
   * Returns true if allowed, false if limit exceeded.
   */
  async acquire(key: string): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let list = this.timestamps.get(key) || [];
    list = list.filter((ts) => ts > windowStart);

    if (list.length >= this.maxRequests) {
      this.timestamps.set(key, list);
      return false;
    }

    list.push(now);
    this.timestamps.set(key, list);
    return true;
  }

  /**
   * Waits until a slot becomes available or timeout expires.
   */
  async waitForSlot(key: string, timeoutMs: number = 30000, pollIntervalMs: number = 50): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.acquire(key)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return false;
  }

  /**
   * Resets rate limiter counter for a specific key, or clears all keys.
   */
  reset(key?: string): void {
    if (key) {
      this.timestamps.delete(key);
    } else {
      this.timestamps.clear();
    }
  }
}
