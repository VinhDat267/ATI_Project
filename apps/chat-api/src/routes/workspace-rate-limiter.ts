import type { Request, Response, NextFunction } from 'express';

export interface WorkspaceRateLimitConfig {
  limit?: number;
  windowMs?: number;
  clock?: () => number;
  maxBuckets?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class WorkspaceRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: () => number;
  private readonly maxBuckets: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(config?: WorkspaceRateLimitConfig) {
    if (config?.limit !== undefined && (!Number.isSafeInteger(config.limit) || config.limit <= 0)) {
      throw new TypeError('limit must be a positive safe integer');
    }
    if (config?.windowMs !== undefined && (!Number.isSafeInteger(config.windowMs) || config.windowMs <= 0)) {
      throw new TypeError('windowMs must be a positive safe integer');
    }
    if (config?.maxBuckets !== undefined && (!Number.isSafeInteger(config.maxBuckets) || config.maxBuckets <= 0)) {
      throw new TypeError('maxBuckets must be a positive safe integer');
    }

    this.limit = config?.limit ?? 60;
    this.windowMs = config?.windowMs ?? 60_000;
    this.clock = config?.clock ?? Date.now;
    this.maxBuckets = config?.maxBuckets ?? 10_000;
  }

  check(actorId: string, action: string): { allowed: boolean; retryAfter?: number } {
    const now = this.clock();
    const key = `${actorId}:${action}`;
    const existing = this.buckets.get(key);

    if (existing) {
      if (existing.resetAt <= now) {
        existing.count = 1;
        existing.resetAt = now + this.windowMs;
        return { allowed: true };
      }

      if (existing.count >= this.limit) {
        const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
        return { allowed: false, retryAfter };
      }

      existing.count += 1;
      return { allowed: true };
    }

    // New key: if capacity reached, evict expired entries first
    if (this.buckets.size >= this.maxBuckets) {
      for (const [k, b] of this.buckets) {
        if (b.resetAt <= now) {
          this.buckets.delete(k);
        }
      }
    }

    // Enforce hard cap to prevent unbounded active bucket memory growth
    if (this.buckets.size >= this.maxBuckets) {
      const retryAfter = Math.max(1, Math.ceil(this.windowMs / 1000));
      return { allowed: false, retryAfter };
    }

    this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
    return { allowed: true };
  }
}

export function createWorkspaceRateLimitMiddleware(limiter: WorkspaceRateLimiter, action: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const actorId = (req as any).user?.id;
    if (!actorId) {
      res.status(401).json({ code: 'UNAUTHORIZED', error: 'Authentication required' });
      return;
    }

    const result = limiter.check(actorId, action);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfter ?? 60));
      res.status(429).json({
        code: 'TOO_MANY_REQUESTS',
        error: 'Too many requests. Please try again later.',
      });
      return;
    }

    next();
  };
}
