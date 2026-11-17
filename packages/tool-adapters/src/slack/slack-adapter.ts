import { BaseAdapter, StepError } from '../base-adapter.js';
import { GlobalRateLimiter } from '../rate-limiter.js';
import type { SlackAdapterConfig, SlackCredentials } from './types.js';

const sharedSlackPostLimiter = new GlobalRateLimiter({ maxRequests: 1, windowMs: 1000 });

const SLACK_AUTH_ERRORS = new Set(['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked', 'token_expired']);
const SLACK_PERMISSION_ERRORS = new Set([
  'not_in_channel', 'missing_scope', 'access_denied', 'no_permission', 'restricted_action',
  'restricted_action_read_only_channel', 'restricted_action_thread_only_channel', 'not_allowed_token_type',
  'team_access_not_granted', 'org_login_required', 'ekm_access_denied', 'accesslimited', 'posting_to_general_channel_denied',
]);
const SLACK_NOT_FOUND_ERRORS = new Set(['channel_not_found', 'thread_not_found', 'message_not_found', 'users_not_found']);
const SLACK_VALIDATION_ERRORS = new Set([
  'is_archived', 'msg_too_long', 'no_text', 'invalid_arguments', 'invalid_arg_name', 'invalid_array_arg',
  'invalid_blocks', 'invalid_blocks_format', 'invalid_charset', 'invalid_form_data', 'invalid_post_type',
  'missing_post_type', 'too_many_attachments', 'invalid_cursor', 'invalid_limit', 'invalid_ts_latest', 'invalid_ts_oldest',
]);
const SLACK_ERROR_HINTS: Record<string, string> = {
  not_in_channel: 'mời bot vào kênh bằng /invite @bot',
  missing_scope: 'bot thiếu quyền, cần cài lại app với đủ scope: chat:write, channels:read, groups:read, channels:history, groups:history, users:read, users:read.email',
  is_archived: 'kênh đã lưu trữ',
  msg_too_long: 'tin nhắn vượt giới hạn của Slack',
};
const SLACK_CHANNEL_MAX_PAGES = 10;
const SLACK_USERS_MAX_PAGES = 5;
const SLACK_HISTORY_SCAN_LIMIT = 100;
const SLACK_MAX_BLOCKS = 50;

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
  async request<T = any>(endpoint: string, options: RequestInit = {}, beforeDispatch?: () => Promise<void>): Promise<T> {
    const rawUrl = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.credentials.botToken}`);
    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json; charset=utf-8');
    }

    const signal = options.signal ?? undefined;
    const isWrite = options.method?.toUpperCase() === 'POST' || rawUrl.includes('/chat.postMessage');
    let writeDispatched = false;

    if (signal?.aborted) {
      throw new StepError({
        message: 'Slack request aborted before dispatch',
        category: 'NETWORK',
        retryable: false,
        details: { requestSent: false },
      });
    }

    let res: Response;
    for (let attempt = 0; ; attempt++) {
      const limiter = this.rateLimiter ?? (rawUrl.includes('/chat.postMessage') ? sharedSlackPostLimiter : undefined);
      if (limiter) {
        try {
          await this.waitForTransportSlot(limiter, this.service, signal);
        } catch (err: any) {
          if (!writeDispatched) {
            if (err instanceof StepError) {
              throw new StepError({
                message: err.message,
                category: err.category,
                statusCode: err.statusCode,
                retryable: err.retryable,
                details: { ...err.details, requestSent: false },
                cause: err.cause ?? err,
              });
            }
            throw new StepError({
              message: `Slack request aborted before dispatch: ${err?.message || err}`,
              category: 'NETWORK',
              retryable: false,
              details: { requestSent: false },
              cause: err,
            });
          }
          throw err;
        }
      }
      if (beforeDispatch) await beforeDispatch();
      if (signal?.aborted && !writeDispatched) {
        throw new StepError({
          message: 'Slack request aborted before dispatch',
          category: 'NETWORK',
          retryable: false,
          details: { requestSent: false },
        });
      }
      try {
        if (isWrite) writeDispatched = true;
        res = await this.fetchFn(rawUrl, {
          ...options,
          headers,
        });
      } catch (err: any) {
        throw new StepError({
          message: `Slack network request failed: ${err?.message || err}`,
          category: 'NETWORK',
          retryable: !isWrite,
          ...(isWrite ? { details: { requestSent: writeDispatched } } : {}),
          cause: err,
        });
      }
      if (res.status !== 429 || isWrite || attempt >= 1) break;
      await this.waitForRetryAfter(res.headers?.get?.('Retry-After'), signal);
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new StepError({
          message: `Slack authentication error (${res.status}): ${errorText || res.statusText}`,
          category: 'AUTH_ERROR',
          statusCode: res.status,
          retryable: false,
          ...(isWrite ? { details: { requestSent: false } } : {}),
        });
      }

      if (res.status === 404) {
        throw new StepError({
          message: `Slack resource not found (404): ${errorText || res.statusText}`,
          category: 'NOT_FOUND',
          statusCode: 404,
          retryable: false,
          ...(isWrite ? { details: { requestSent: false } } : {}),
        });
      }

      if (res.status === 429) {
        throw new StepError({
          message: `Slack rate limit exceeded (429): ${errorText || res.statusText}`,
          category: 'RATE_LIMIT',
          statusCode: 429,
          retryable: !isWrite,
          ...(isWrite ? { details: { requestSent: false } } : {}),
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
      // Slack answered ok:false with a definitive code: the method did not execute,
      // so a write was NOT applied and must not be parked as `unknown`.
      const notSent = isWrite ? { requestSent: false } : {};
      const reject = (category: StepError['category'], statusCode: number | undefined, message: string, retryable = false) =>
        new StepError({
          message,
          category,
          ...(statusCode ? { statusCode } : {}),
          retryable,
          details: { ...data, ...notSent, slackError: err },
        });
      const hint = SLACK_ERROR_HINTS[err] ? ` (${SLACK_ERROR_HINTS[err]})` : '';

      if (SLACK_AUTH_ERRORS.has(err)) {
        throw reject('AUTH_ERROR', 401, `Slack authentication failed: ${err}`);
      }
      if (SLACK_PERMISSION_ERRORS.has(err)) {
        throw reject('AUTH_ERROR', 403, `Slack permission denied: ${err}${hint}`);
      }
      if (SLACK_NOT_FOUND_ERRORS.has(err)) {
        throw reject('NOT_FOUND', 404, `Slack resource not found: ${err}`);
      }
      if (SLACK_VALIDATION_ERRORS.has(err)) {
        throw reject('VALIDATION', undefined, `Slack rejected the request: ${err}${hint}`);
      }
      if (err === 'ratelimited' || err === 'rate_limited') {
        throw reject('RATE_LIMIT', 429, `Slack rate limited: ${err}`, !isWrite);
      }

      // Unrecognised code (e.g. internal_error, fatal_error, request_timeout): outcome unclear.
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
  async searchChannels(
    args: { query: string; limit?: number; channelId?: string },
    options?: { signal?: AbortSignal }
  ): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
    // A digest already has an approved channel ID and can verify it without scanning a directory.
    if (args.channelId !== undefined) {
      this.assertAllowedScope('channels', args.channelId);
      const data = await this.request(
        `/conversations.info?channel=${encodeURIComponent(args.channelId)}`,
        { signal: options?.signal },
      );
      const channel = data?.channel;
      if (channel?.id !== args.channelId || channel.is_archived === true || typeof channel.name !== 'string') {
        return [];
      }
      return [{ id: channel.id, name: channel.name, isPrivate: channel.is_private === true }];
    }

    // conversations.list is cursor-paginated; scan up to SLACK_CHANNEL_MAX_PAGES pages.
    const channels: any[] = [];
    let cursor = '';
    for (let page = 0; page < SLACK_CHANNEL_MAX_PAGES; page++) {
      const data = await this.request<any>(
        `/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`,
        { signal: options?.signal }
      );
      if (Array.isArray(data?.channels)) channels.push(...data.channels);
      cursor = typeof data?.response_metadata?.next_cursor === 'string' ? data.response_metadata.next_cursor : '';
      if (!cursor) break;
    }
    const queryLower = (args.query || '').toLowerCase();
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 200);

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
  async sendMessage(
    args: { channel: string; text: string; threadTs?: string; blocks?: Array<Record<string, unknown>> },
    options?: { signal?: AbortSignal; includePermalink?: boolean; beforeDispatch?: () => Promise<void> }
  ): Promise<{ ts: string; channel: string; permalink?: string }> {
    try {
      this.assertAllowedScope('channels', args.channel);
    } catch (err) {
      if (err instanceof StepError) {
        throw new StepError({
          message: err.message,
          category: err.category,
          statusCode: err.statusCode,
          retryable: false,
          details: { ...(err.details ?? {}), requestSent: false },
        });
      }
      throw err;
    }
    const threadTs = typeof args.threadTs === 'string' ? args.threadTs.trim() : '';
    if (threadTs && !/^\d+\.\d+$/.test(threadTs)) {
      throw new StepError({
        message: 'Slack threadTs must look like 1700000000.000100',
        category: 'VALIDATION',
        retryable: false,
        details: { requestSent: false },
      });
    }

    let validBlocks: Array<Record<string, unknown>> | undefined;
    if (args.blocks !== undefined) {
      if (
        !Array.isArray(args.blocks) ||
        args.blocks.length > SLACK_MAX_BLOCKS ||
        args.blocks.some((b) => !b || typeof b !== 'object' || Array.isArray(b))
      ) {
        throw new StepError({
          message: `Slack blocks must be an array of at most ${SLACK_MAX_BLOCKS} block objects`,
          category: 'VALIDATION',
          retryable: false,
          details: { requestSent: false },
        });
      }
      if (args.blocks.length > 0) {
        validBlocks = args.blocks;
      }
    }

    const res = await this.request<any>('/chat.postMessage', {
      method: 'POST',
      body: JSON.stringify({
        channel: args.channel,
        text: args.text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        ...(validBlocks ? { blocks: validBlocks } : {}),
      }),
      signal: options?.signal,
    }, options?.beforeDispatch);

    const rawTs = typeof res?.ts === 'string' ? res.ts.trim() : '';
    const rawChannel = typeof res?.channel === 'string' ? res.channel.trim() : '';
    if (
      !rawTs ||
      rawTs === 'undefined' ||
      rawTs === 'null' ||
      !rawChannel ||
      rawChannel === 'undefined' ||
      rawChannel === 'null'
    ) {
      throw new StepError({
        message:
          'Slack chat.postMessage returned a malformed receipt without valid string channel and timestamp (ts)',
        category: 'UNKNOWN',
        retryable: false,
        details: { requestSent: true },
      });
    }

    const permalink = options?.includePermalink ? await this.fetchPermalink(rawChannel, rawTs, options?.signal) : undefined;
    return {
      ts: rawTs,
      channel: rawChannel,
      ...(permalink ? { permalink } : {}),
    };
  }

  /**
   * Best-effort link to a posted message so users can verify the result in one click.
   * Runs only after a confirmed receipt and never throws: a failure here must not turn a
   * delivered message into a failed or unknown write.
   */
  private async fetchPermalink(channel: string, ts: string, signal?: AbortSignal): Promise<string | undefined> {
    try {
      if (signal?.aborted) return undefined;
      const res = await this.fetchFn(
        `${this.baseUrl}/chat.getPermalink?channel=${encodeURIComponent(channel)}&message_ts=${encodeURIComponent(ts)}`,
        { headers: { Authorization: `Bearer ${this.credentials.botToken}` }, signal },
      );
      if (!res?.ok) return undefined;
      const body: any = await res.json();
      const link = typeof body?.permalink === 'string' ? body.permalink : '';
      return body?.ok === true && /^https:\/\/[^\s]+\.slack\.com\//.test(link) ? link : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Read recent messages from an allowed Slack channel via conversations.history.
   */
  async readMessages(
    args: { channel: string; query?: string; limit?: number },
    options?: { signal?: AbortSignal }
  ): Promise<{
    channel: string;
    messages: Array<{ ts: string; user: string; text: string; replyCount?: number; threadTs?: string }>;
    scanned: number;
    matched: number;
    truncated: boolean;
  }> {
    if (typeof args.channel !== 'string' || !args.channel.trim()) {
      throw new StepError({
        message: 'Slack channel must be a non-empty string',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    this.assertAllowedScope('channels', args.channel);
    const limit = Math.min(Math.max(Number.isInteger(args.limit) ? Number(args.limit) : 15, 1), 25);
    const queryLower = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';

    // With a keyword filter, scan a wider recent window so the search is not limited to `limit` messages.
    const fetchLimit = queryLower ? SLACK_HISTORY_SCAN_LIMIT : limit;
    const data = await this.request<any>(
      `/conversations.history?channel=${encodeURIComponent(args.channel)}&limit=${fetchLimit}`,
      { signal: options?.signal }
    );

    const rawMessages: any[] = Array.isArray(data?.messages) ? data.messages : [];
    const filtered = queryLower
      ? rawMessages.filter((m) => String(m?.text ?? '').toLowerCase().includes(queryLower))
      : rawMessages;
    const shown = filtered.slice(0, limit);

    return {
      channel: args.channel,
      messages: shown.map((m) => ({
        ts: String(m?.ts ?? ''),
        user: String(m?.user ?? m?.username ?? 'unknown'),
        text: String(m?.text ?? ''),
        ...(Number(m?.reply_count) > 0 ? { replyCount: Number(m.reply_count), threadTs: String(m?.thread_ts ?? m?.ts ?? '') } : {}),
      })),
      // Honest coverage: how many recent messages were examined, how many matched, whether more exist.
      scanned: rawMessages.length,
      matched: filtered.length,
      truncated: filtered.length > shown.length || data?.has_more === true,
    };
  }

  /**
   * Read the parent message and replies of a Slack thread in an allowed channel via conversations.replies.
   */
  async readThread(
    args: { channel: string; threadTs: string; limit?: number },
    options?: { signal?: AbortSignal }
  ): Promise<{
    channel: string;
    threadTs: string;
    messages: Array<{ ts: string; user: string; text: string; isParent: boolean }>;
    scanned: number;
    truncated: boolean;
  }> {
    if (typeof args.channel !== 'string' || !args.channel.trim()) {
      throw new StepError({
        message: 'Slack channel must be a non-empty string',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    const threadTs = typeof args.threadTs === 'string' ? args.threadTs.trim() : '';
    if (!/^\d+\.\d+$/.test(threadTs)) {
      throw new StepError({
        message: 'Slack threadTs must look like 1700000000.000100',
        category: 'VALIDATION',
        retryable: false,
      });
    }
    this.assertAllowedScope('channels', args.channel);
    const limit = Math.min(Math.max(Number.isInteger(args.limit) ? Number(args.limit) : 25, 1), 50);

    const data = await this.request<any>(
      `/conversations.replies?channel=${encodeURIComponent(args.channel)}&ts=${encodeURIComponent(threadTs)}&limit=${limit}`,
      { signal: options?.signal }
    );

    const rawMessages: any[] = Array.isArray(data?.messages) ? data.messages : [];
    const shown = rawMessages.slice(0, limit);
    return {
      channel: args.channel,
      threadTs,
      messages: shown.map((m, index) => ({
        ts: String(m?.ts ?? ''),
        user: String(m?.user ?? m?.username ?? 'unknown'),
        text: String(m?.text ?? ''),
        isParent: String(m?.ts ?? '') === threadTs || index === 0,
      })),
      scanned: rawMessages.length,
      truncated: rawMessages.length > shown.length || data?.has_more === true,
    };
  }

  /**
   * Search active human workspace members via email lookup or cursor-paginated users.list.
   */
  async searchUsers(
    args: { query?: string; email?: string; limit?: number },
    options?: { signal?: AbortSignal }
  ): Promise<Array<{ id: string; name: string; realName?: string; displayName?: string; email?: string }>> {
    const normalizeUser = (u: any) => {
      const id = String(u?.id ?? '').trim();
      const name = String(u?.name ?? '').trim();
      const realName =
        typeof u?.profile?.real_name === 'string' && u.profile.real_name.trim()
          ? u.profile.real_name.trim()
          : typeof u?.real_name === 'string' && u.real_name.trim()
            ? u.real_name.trim()
            : undefined;
      const displayName =
        typeof u?.profile?.display_name === 'string' && u.profile.display_name.trim()
          ? u.profile.display_name.trim()
          : undefined;
      const email =
        typeof u?.profile?.email === 'string' && u.profile.email.trim()
          ? u.profile.email.trim()
          : undefined;
      return {
        id,
        name: name || displayName || realName || id,
        ...(realName ? { realName } : {}),
        ...(displayName ? { displayName } : {}),
        ...(email ? { email } : {}),
      };
    };

    const isActiveHuman = (u: any) =>
      u &&
      typeof u === 'object' &&
      typeof u.id === 'string' &&
      u.id.trim().length > 0 &&
      u.id !== 'USLACKBOT' &&
      u.deleted !== true &&
      u.is_bot !== true;

    const emailArg = typeof args?.email === 'string' ? args.email.trim() : '';
    if (emailArg) {
      try {
        const data = await this.request<any>(
          `/users.lookupByEmail?email=${encodeURIComponent(emailArg)}`,
          { signal: options?.signal }
        );
        return isActiveHuman(data?.user) ? [normalizeUser(data.user)] : [];
      } catch (err: any) {
        if (err instanceof StepError && err.category === 'NOT_FOUND' && err.details?.slackError === 'users_not_found') {
          return [];
        }
        throw err;
      }
    }

    const members: any[] = [];
    let cursor = '';
    for (let page = 0; page < SLACK_USERS_MAX_PAGES; page++) {
      const data = await this.request<any>(
        `/users.list?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { signal: options?.signal }
      );
      if (Array.isArray(data?.members)) members.push(...data.members);
      cursor = typeof data?.response_metadata?.next_cursor === 'string' ? data.response_metadata.next_cursor : '';
      if (!cursor) break;
    }

    const limit = Math.min(Math.max(Number.isInteger(args?.limit) ? Number(args.limit) : 50, 1), 200);
    const queryLower = typeof args?.query === 'string' ? args.query.trim().toLowerCase() : '';
    const activeHumans = members.filter(isActiveHuman).map(normalizeUser);
    const filtered = queryLower
      ? activeHumans.filter(
          (u) =>
            u.id.toLowerCase() === queryLower ||
            u.name.toLowerCase().includes(queryLower) ||
            (u.realName?.toLowerCase().includes(queryLower) ?? false) ||
            (u.displayName?.toLowerCase().includes(queryLower) ?? false) ||
            (u.email?.toLowerCase().includes(queryLower) ?? false)
        )
      : activeHumans;

    return filtered.slice(0, limit);
  }

  override async execute(
    toolName: string,
    args: Record<string, any>,
    context?: { signal?: AbortSignal; stepId?: string; includePermalink?: boolean; beforeDispatch?: () => Promise<void> }
  ): Promise<any> {
    const opts = context?.signal ? { signal: context.signal } : undefined;
    switch (toolName) {
      case 'slack.search_channels':
        return this.searchChannels(args as any, opts);
      case 'slack.search_users':
        return this.searchUsers(args as any, opts);
      case 'slack.send_message':
        return this.sendMessage(args as any, {
          ...(opts ?? {}),
          ...(context?.stepId || context?.includePermalink ? { includePermalink: true } : {}),
          beforeDispatch: context?.beforeDispatch,
        });
      case 'slack.read_messages':
        return this.readMessages(args as any, opts);
      case 'slack.read_thread':
        return this.readThread(args as any, opts);
      default:
        throw new StepError({
          message: `Tool '${toolName}' is not supported by SlackAdapter`,
          category: 'VALIDATION',
          retryable: false,
        });
    }
  }
}
