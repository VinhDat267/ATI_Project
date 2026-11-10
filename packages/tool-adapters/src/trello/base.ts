import { BaseAdapter, StepError } from '../base-adapter.js';
import { GlobalRateLimiter } from '../rate-limiter.js';
import type { TrelloBaseAdapterConfig, TrelloCredentials } from './types.js';

const sharedTrelloLimiter = new GlobalRateLimiter({ maxRequests: 100, windowMs: 10_000 });

export const TRELLO_ADAPTER_RESOURCE_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function assertValidTrelloResourceId(value: unknown, fieldName = 'id'): string {
  if (typeof value !== 'string' || !TRELLO_ADAPTER_RESOURCE_ID_REGEX.test(value)) {
    throw new StepError({
      message: `Invalid Trello resource ID for ${fieldName}`,
      category: 'VALIDATION',
      statusCode: 400,
      retryable: false,
      details: { requestSent: false, field: fieldName },
    });
  }
  return value;
}

export class TrelloBaseAdapter extends BaseAdapter {
  public readonly service = 'trello';
  protected credentials: TrelloCredentials;
  protected allowedBoardIds: readonly string[];
  protected baseUrl: string;
  protected fetchFn: typeof fetch;

  constructor(config: TrelloBaseAdapterConfig) {
    super(config);
    this.credentials = config.credentials;
    this.allowedBoardIds = config.allowedBoardIds ?? config.allowedScope?.boards ?? [];
    this.baseUrl = config.baseUrl || 'https://api.trello.com/1';
    this.fetchFn = config.fetchFn || globalThis.fetch;
  }

  protected assertValidResourceId(value: unknown, fieldName = 'id'): string {
    return assertValidTrelloResourceId(value, fieldName);
  }

  protected override assertAllowedScope(scopeKey: string, targetIdOrName: string): void {
    if (scopeKey === 'boards') {
      this.assertValidResourceId(targetIdOrName, 'boardId');
      if (!this.allowedBoardIds.includes(targetIdOrName)) {
        throw new StepError({
          message: `Allowed scope restriction: board '${targetIdOrName}' is not in allowed list [${this.allowedBoardIds.join(', ')}]`,
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
          details: { requestSent: false },
        });
      }
      return;
    }
    super.assertAllowedScope(scopeKey, targetIdOrName);
  }

  protected assertParentBoard(parent: unknown, boundBoardId?: string): void {
    if (boundBoardId !== undefined) {
      this.assertValidResourceId(boundBoardId, 'boardId');
    }
    const boardId = (parent as { idBoard?: unknown } | null)?.idBoard;
    if (typeof boardId !== 'string' || !boardId.trim() || !TRELLO_ADAPTER_RESOURCE_ID_REGEX.test(boardId)) {
      throw new StepError({
        message: 'Allowed scope restriction: parent board could not be verified',
        category: 'AUTH_ERROR',
        statusCode: 403,
        retryable: false,
        details: { requestSent: false },
      });
    }
    if (boundBoardId && boardId !== boundBoardId) {
      throw new StepError({
        message: `Step bound to board '${boundBoardId}', but parent resource belongs to board '${boardId}'`,
        category: 'AUTH_ERROR',
        statusCode: 403,
        retryable: false,
        details: { requestSent: false },
      });
    }
    this.assertAllowedScope('boards', boardId);
  }

  private resolveSafeEndpointUrl(endpoint: string): URL {
    if (
      typeof endpoint !== 'string' ||
      !endpoint.startsWith('/') ||
      endpoint.startsWith('//') ||
      endpoint.includes('#') ||
      /[\u0000-\u001f\u007f]/.test(endpoint)
    ) {
      throw new StepError({
        message: 'Invalid Trello API endpoint path',
        category: 'VALIDATION',
        statusCode: 400,
        retryable: false,
        details: { requestSent: false },
      });
    }

    const qIndex = endpoint.indexOf('?');
    const rawPathPart = qIndex >= 0 ? endpoint.slice(0, qIndex) : endpoint;
    if (
      rawPathPart.includes('\\') ||
      rawPathPart.includes('//') ||
      /(?:^|\/)\.\.?(?:\/|$)/.test(rawPathPart) ||
      /%(?:2e|2f|5c|00|25(?:2e|2f|5c|00))/i.test(rawPathPart)
    ) {
      throw new StepError({
        message: 'Invalid Trello API endpoint path: traversal or encoded separator rejected',
        category: 'VALIDATION',
        statusCode: 400,
        retryable: false,
        details: { requestSent: false },
      });
    }

    const normalizedBase = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    const base = new URL(normalizedBase);
    const basePathname = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;
    const expectedPathname = `${basePathname}${rawPathPart}`;
    const url = new URL(`${base.origin}${expectedPathname}${qIndex >= 0 ? endpoint.slice(qIndex) : ''}`);

    if (url.origin !== base.origin || url.pathname !== expectedPathname) {
      throw new StepError({
        message: 'Invalid Trello API endpoint path: normalized path mismatch',
        category: 'VALIDATION',
        statusCode: 400,
        retryable: false,
        details: { requestSent: false },
      });
    }

    return url;
  }

  /**
   * Executes HTTP request against Trello REST API, sending Bearer token in Authorization header,
   * and normalizing response error statuses to StepError categories.
   */
  async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (options.signal?.aborted) {
      throw new StepError({
        message: 'Trello network request aborted',
        category: 'NETWORK',
        retryable: true,
        cause: options.signal.reason,
      });
    }

    const url = this.resolveSafeEndpointUrl(endpoint);
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.credentials.accessToken}`);

    let res: Response;
    for (let attempt = 0; ; attempt++) {
      await this.waitForTransportSlot(this.rateLimiter ?? sharedTrelloLimiter, this.service, options.signal ?? undefined);
      try {
        res = await this.fetchFn(url.toString(), { ...options, headers });
      } catch (err: any) {
        throw new StepError({
          message: `Trello network request failed: ${err?.message || err}`,
          category: 'NETWORK',
          retryable: true,
          cause: err,
        });
      }
      if (res.status !== 429 || attempt >= 1) break;
      await this.waitForRetryAfter(res.headers?.get?.('Retry-After'), options.signal ?? undefined);
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new StepError({
          message: `Trello authentication error (${res.status}): ${errorText || res.statusText}`,
          category: 'AUTH_ERROR',
          statusCode: res.status,
          retryable: false,
        });
      }

      if (res.status === 404) {
        throw new StepError({
          message: `Trello resource not found (404): ${errorText || res.statusText}`,
          category: 'NOT_FOUND',
          statusCode: 404,
          retryable: false,
        });
      }

      if (res.status === 429) {
        throw new StepError({
          message: `Trello rate limit exceeded (429): ${errorText || res.statusText}`,
          category: 'RATE_LIMIT',
          statusCode: 429,
          retryable: true,
        });
      }

      if (res.status >= 500) {
        throw new StepError({
          message: `Trello server error (${res.status}): ${errorText || res.statusText}`,
          category: 'SERVER_ERROR',
          statusCode: res.status,
          retryable: false,
        });
      }

      throw new StepError({
        message: `Trello request failed (${res.status}): ${errorText || res.statusText}`,
        category: 'UNKNOWN',
        statusCode: res.status,
        retryable: false,
      });
    }

    return (await res.json()) as T;
  }

  async execute(toolName: string, args: Record<string, any>, context?: any): Promise<any> {
    throw new StepError({
      message: `Tool '${toolName}' execution must be implemented in specialized adapter.`,
      category: 'VALIDATION',
      retryable: false,
    });
  }
}
