const LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;

// Wrong passwords at login and at password change share one (IP, email) budget
// in this API instance, like the other in-memory limits.
export class LoginFailures {
  private failures = new Map<string, { count: number; expiresAt: number }>();
  private pending = new Map<string, Promise<unknown>>();
  constructor(private clock: () => number = Date.now) {}

  static key(ip: string | undefined, email: string): string { return JSON.stringify([ip, email]); }

  /** Seconds until attempts are allowed again, or null when they are allowed now. */
  retryAfter(key: string): number | null {
    const now = this.clock();
    const bucket = this.failures.get(key);
    if (bucket && bucket.expiresAt <= now) { this.failures.delete(key); return null; }
    return bucket && bucket.count >= LIMIT ? Math.ceil((bucket.expiresAt - now) / 1000) : null;
  }

  record(key: string): void {
    const now = this.clock();
    for (const [oldKey, failure] of this.failures) if (failure.expiresAt <= now) this.failures.delete(oldKey);
    // Verification awaits PostgreSQL: count against the current bucket, including
    // failures that other requests completed during that await.
    const current = this.failures.get(key);
    this.failures.set(key, { count: (current?.count ?? 0) + 1, expiresAt: current?.expiresAt ?? now + WINDOW_MS });
  }

  clear(key: string): void { this.failures.delete(key); }

  /** Serializes password checks per key so concurrent requests cannot all pass the limit at once. */
  async serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const preceding = this.pending.get(key) ?? Promise.resolve();
    const run = preceding.catch(() => {}).then(task);
    this.pending.set(key, run);
    try { return await run; }
    finally { if (this.pending.get(key) === run) this.pending.delete(key); }
  }
}
