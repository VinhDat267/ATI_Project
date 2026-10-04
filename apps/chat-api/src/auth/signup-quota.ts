/** Shared email/Google signup policy for one API instance, as AUTH-common requires. */
export class SignupRateLimitError extends Error {
  constructor(readonly retryAfter: number) { super('Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.'); }
}
export class SignupQuota {
  private buckets = new Map<string, { count: number; expiresAt: number }>();
  constructor(private clock: () => number = Date.now) {}
  take(ip: string): void {
    const now = this.clock();
    for (const [key, bucket] of this.buckets) if (bucket.expiresAt <= now) this.buckets.delete(key);
    const bucket = this.buckets.get(ip) ?? { count: 0, expiresAt: now + 3600000 };
    if (bucket.count >= 10) throw new SignupRateLimitError(Math.ceil((bucket.expiresAt - now) / 1000));
    bucket.count++; this.buckets.set(ip, bucket);
  }
}
