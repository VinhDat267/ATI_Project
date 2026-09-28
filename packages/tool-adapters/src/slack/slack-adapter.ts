import { BaseAdapter, StepError } from '../base-adapter.js';
import type { SlackAdapterConfig, SlackCredentials } from './types.js';

export class SlackAdapter extends BaseAdapter {
  public readonly service = 'slack';
  protected credentials: SlackCredentials;
  protected baseUrl: string;
  protected fetchFn: typeof fetch;

  constructor(config: SlackAdapterConfig) {
    super(config);
    this.credentials = config.credentials;
    this.baseUrl = config.baseUrl || 'https://slack.com/api';
    this.fetchFn = config.fetchFn || globalThis.fetch;
  }

  /**
   * Executes HTTP request against Slack Web API, automatically injecting Bearer authorization,
   * and normalizing response error statuses and Slack body error fields to StepError categories.
   */
  async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const rawUrl = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.credentials.botToken}`);
    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json; charset=utf-8');
    }

    let res: Response;
    try {
      res = await this.fetchFn(rawUrl, {
        ...options,
        headers,
      });
    } catch (err: any) {
      throw new StepError({
        message: `Slack network request failed: ${err?.message || err}`,
        category: 'NETWORK',
        retryable: true,
        cause: err,
      });
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new StepError({
          message: `Slack authentication error (${res.status}): ${errorText || res.statusText}`,
          category: 'AUTH_ERROR',
          statusCode: res.status,
          retryable: false,
        });
      }

      if (res.status === 404) {
        throw new StepError({
          message: `Slack resource not found (404): ${errorText || res.statusText}`,
          category: 'NOT_FOUND',
          statusCode: 404,
          retryable: false,
        });
      }

      if (res.status === 429) {
        throw new StepError({
          message: `Slack rate limit exceeded (429): ${errorText || res.statusText}`,
          category: 'RATE_LIMIT',
          statusCode: 429,
          retryable: true,
        });
      }

      if (res.status >= 500) {
        throw new StepError({
          message: `Slack server error (${res.status}): ${errorText || res.statusText}`,
          category: 'SERVER_ERROR',
          statusCode: res.status,
          retryable: false,
        });
      }

      throw new StepError({
        message: `Slack request failed with HTTP ${res.status}: ${errorText || res.statusText}`,
        category: 'UNKNOWN',
        statusCode: res.status,
        retryable: false,
      });
    }

    const data: any = await res.json();
    if (data && data.ok === false) {
      const err = String(data.error || 'unknown_error');
      if (
        err === 'invalid_auth' ||
        err === 'not_authed' ||
        err === 'account_inactive' ||
        err === 'token_revoked'
      ) {
        throw new StepError({
          message: `Slack authentication failed: ${err}`,
          category: 'AUTH_ERROR',
          statusCode: 401,
          retryable: false,
        });
      }

      if (err === 'channel_not_found') {
        throw new StepError({
          message: `Slack channel not found: ${err}`,
          category: 'NOT_FOUND',
          statusCode: 404,
          retryable: false,
        });
      }

      if (err === 'ratelimited') {
        throw new StepError({
          message: `Slack rate limited: ${err}`,
          category: 'RATE_LIMIT',
          statusCode: 429,
          retryable: true,
        });
      }

      throw new StepError({
        message: `Slack API error: ${err}`,
        category: 'UNKNOWN',
        retryable: false,
        details: data,
      });
    }

    return data as T;
  }

  /**
   * Search Slack channels by query, filtered by AllowedScope.
   */
  async searchChannels(args: {
    query: string;
    limit?: number;
  }): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
    const data = await this.request<any>(
      '/conversations.list?types=public_channel,private_channel&limit=100'
    );

    const channels: any[] = Array.isArray(data?.channels) ? data.channels : [];
    const queryLower = (args.query || '').toLowerCase();
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 10);

    let filtered = channels.filter((ch) =>
      (ch.name || '').toLowerCase().includes(queryLower)
    );

    // Apply AllowedScope channel whitelist if configured
    if (this.allowedScope?.channels && this.allowedScope.channels.length > 0) {
      filtered = filtered.filter(
        (ch) =>
          this.allowedScope!.channels!.includes(ch.id) ||
          this.allowedScope!.channels!.includes(ch.name)
      );
    }

    return filtered.slice(0, limit).map((ch) => ({
      id: String(ch.id),
      name: String(ch.name),
      isPrivate: Boolean(ch.is_private),
    }));
  }

  /**
   * Send a message to a Slack channel.
   */
  async sendMessage(args: {
    channel: string;
    text: string;
  }): Promise<{ ts: string; channel: string }> {
    this.assertAllowedScope('channel', args.channel);

    const res = await this.request<any>('/chat.postMessage', {
      method: 'POST',
      body: JSON.stringify({
        channel: args.channel,
        text: args.text,
      }),
    });

    return {
      ts: String(res.ts),
      channel: String(res.channel || args.channel),
    };
  }

  override async execute(toolName: string, args: Record<string, any>): Promise<any> {
    switch (toolName) {
      case 'slack.search_channels':
        return this.searchChannels(args as any);
      case 'slack.send_message':
        return this.sendMessage(args as any);
      default:
        throw new StepError({
          message: `Tool '${toolName}' is not supported by SlackAdapter`,
          category: 'VALIDATION',
          retryable: false,
        });
    }
  }
}
