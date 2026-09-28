import { BaseAdapter, StepError } from '../base-adapter.js';
import type { TrelloBaseAdapterConfig, TrelloCredentials } from './types.js';

export class TrelloBaseAdapter extends BaseAdapter {
  public readonly service = 'trello';
  protected credentials: TrelloCredentials;
  protected baseUrl: string;
  protected fetchFn: typeof fetch;

  constructor(config: TrelloBaseAdapterConfig) {
    super(config);
    this.credentials = config.credentials;
    this.baseUrl = config.baseUrl || 'https://api.trello.com/1';
    this.fetchFn = config.fetchFn || globalThis.fetch;
  }

  /**
   * Executes HTTP request against Trello REST API, automatically injecting apiKey and token,
   * and normalizing response error statuses to StepError categories.
   */
  async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const rawUrl = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    const url = new URL(rawUrl);
    url.searchParams.set('key', this.credentials.apiKey);
    url.searchParams.set('token', this.credentials.token);

    let res: Response;
    try {
      res = await this.fetchFn(url.toString(), options);
    } catch (err: any) {
      throw new StepError({
        message: `Trello network request failed: ${err?.message || err}`,
        category: 'NETWORK',
        retryable: true,
        cause: err,
      });
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
