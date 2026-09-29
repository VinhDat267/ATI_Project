export interface GlobalRateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

export function waitWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delayMs);
    function done() {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

/** Retry-After accepts seconds or an HTTP date. Unknown values use a short bounded delay. */
export function retryAfterMs(header: string | null | undefined): number {
  if (header == null) return 1000;
  const trimmed = header.trim();
  const numeric = /^\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) * 1000 : NaN;
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(trimmed) - Date.now();
  return Number.isFinite(parsed) ? Math.min(30_000, Math.max(0, parsed)) : 1000;
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
  async waitForSlot(key: string, timeoutMs: number = 30000, pollIntervalMs: number = 50, signal?: AbortSignal): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start <= timeoutMs) {
      if (signal?.aborted) throw signal.reason;
      if (await this.acquire(key)) {
        return true;
      }
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) break;
      await waitWithSignal(Math.min(pollIntervalMs, remaining), signal);
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
