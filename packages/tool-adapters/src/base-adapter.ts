import type { AllowedScope } from '@wap/tool-schemas';
import type { GlobalRateLimiter } from './rate-limiter.js';

export type ErrorCategory =
  | 'AUTH_ERROR'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export interface StepErrorOptions {
  message: string;
  category: ErrorCategory;
  statusCode?: number;
  retryable?: boolean;
  details?: any;
  cause?: unknown;
}

export class StepError extends Error {
  public readonly category: ErrorCategory;
  public readonly statusCode?: number;
  public readonly retryable: boolean;
  public readonly details?: any;

  constructor(options: StepErrorOptions) {
    super(options.message);
    this.name = 'StepError';
    this.category = options.category;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    if (options.cause) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, StepError.prototype);
  }
}

export interface BaseAdapterConfig {
  allowedScope?: AllowedScope;
  rateLimiter?: GlobalRateLimiter;
}

export abstract class BaseAdapter {
  public abstract readonly service: string;
  protected allowedScope?: AllowedScope;
  protected rateLimiter?: GlobalRateLimiter;

  constructor(config: BaseAdapterConfig = {}) {
    this.allowedScope = config.allowedScope;
    this.rateLimiter = config.rateLimiter;
  }

  public abstract execute(
    toolName: string,
    args: Record<string, any>,
    context?: any
  ): Promise<any>;

  /**
   * Asserts that the target resource belongs to the AllowedScope whitelist.
   * Throws a non-retryable StepError with category AUTH_ERROR if disallowed.
   */
  protected assertAllowedScope(
    type: 'board' | 'channel' | 'repo',
    targetIdOrName: string
  ): void {
    if (!this.allowedScope) return;

    if (type === 'board' && this.allowedScope.boards && this.allowedScope.boards.length > 0) {
      if (!this.allowedScope.boards.includes(targetIdOrName)) {
        throw new StepError({
          message: `Allowed scope restriction: board '${targetIdOrName}' is not in allowed list [${this.allowedScope.boards.join(', ')}]`,
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
        });
      }
    }

    if (type === 'channel' && this.allowedScope.channels && this.allowedScope.channels.length > 0) {
      if (!this.allowedScope.channels.includes(targetIdOrName)) {
        throw new StepError({
          message: `Allowed scope restriction: channel '${targetIdOrName}' is not in allowed list [${this.allowedScope.channels.join(', ')}]`,
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
        });
      }
    }

    if (type === 'repo' && this.allowedScope.repos && this.allowedScope.repos.length > 0) {
      if (!this.allowedScope.repos.includes(targetIdOrName)) {
        throw new StepError({
          message: `Allowed scope restriction: repo '${targetIdOrName}' is not in allowed list [${this.allowedScope.repos.join(', ')}]`,
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
        });
      }
    }
  }
}
