// Per-instance limits, keyed by trusted Express socket IP (no proxy header trust).
export class RateLimit {
  private entries = new Map<string, { count: number; until: number }>();
  constructor(
    private max: number,
    private windowMs: number,
    private now = Date.now,
  ) {}
  blocked(key: string) {
    const entry = this.entries.get(key);
    return entry && entry.until > this.now() && entry.count >= this.max
      ? Math.ceil((entry.until - this.now()) / 1000)
      : 0;
  }
  record(key: string) {
    const now = this.now();
    for (const [id, e] of this.entries)
      if (e.until <= now) this.entries.delete(id);
    const entry = this.entries.get(key) || {
      count: 0,
      until: now + this.windowMs,
    };
    entry.count++;
    this.entries.set(key, entry);
  }
  clear(key: string) {
    this.entries.delete(key);
  }
}
