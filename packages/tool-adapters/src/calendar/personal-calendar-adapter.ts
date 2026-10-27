import { CALENDAR_ID_PATTERN } from '@wap/tool-schemas';
import { BaseAdapter, StepError, type BaseAdapterConfig } from '../base-adapter.js';
import type { GmailAccessTokenProvider } from '../gmail/token-provider.js';
import {
  badResponse,
  CALENDAR_API_BASE,
  invalid,
  limit,
  MAX_RETRY_AFTER_WAIT_MS,
  normalizedEvent,
  only,
  plainDescription,
  retryAfterDelayMs,
  sharedLimiter,
  text,
  windowSize,
} from './calendar-adapter.js';

export interface PersonalCalendarAdapterConfig extends BaseAdapterConfig {
  userId: string;
  tokens: GmailAccessTokenProvider;
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
}

/** Personal Calendar v3 (OAuth 2.0 user credentials); explicit resource scope; indeterminate writes are never replayed. */
export class PersonalCalendarAdapter extends BaseAdapter {
  readonly service = 'mycalendar';
  private readonly userId: string;
  private readonly tokens: GmailAccessTokenProvider;
  private readonly apiBase: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: PersonalCalendarAdapterConfig) {
    super(config);
    if (!config.userId || typeof config.userId !== 'string') {
      throw new StepError({ message: 'PersonalCalendarAdapter requires a userId', category: 'VALIDATION' });
    }
    if (!config.tokens || typeof config.tokens.getAccessToken !== 'function') {
      throw new StepError({ message: 'PersonalCalendarAdapter requires a tokens provider', category: 'VALIDATION' });
    }
    this.userId = config.userId;
    this.tokens = config.tokens;
    this.apiBase = (config.apiBaseUrl ?? CALENDAR_API_BASE).replace(/\/+$/, '') + '/';
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  private calendars(): string[] {
    const ids = this.allowedScope?.calendars;
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !CALENDAR_ID_PATTERN.test(id))) {
      throw new StepError({ message: 'Calendar requires an explicit calendar allowlist', category: 'AUTH_ERROR', statusCode: 403 });
    }
    return [...new Set(ids)];
  }

  private checkedId(value: unknown): string {
    if (typeof value !== 'string' || !CALENDAR_ID_PATTERN.test(value)) invalid('calendarId is invalid');
    this.calendars();
    this.assertAllowedScope('calendars', value);
    return value;
  }

  private async request(
    path: string,
    signal?: AbortSignal,
    body?: object,
    onDispatch?: (dispatched: boolean) => void
  ): Promise<any> {
    if (signal?.aborted) throw new StepError({ message: 'Calendar request cancelled before dispatch', category: 'NETWORK' });
    const writing = body !== undefined;
    let networkRetries = 0;
    let serverRetries = 0;
    let rateRetries = 0;
    let refreshed = false;
    let forceRefresh = false;

    for (;;) {
      if (signal?.aborted) throw new StepError({ message: 'Calendar request cancelled before dispatch', category: 'NETWORK' });
      try {
        await this.waitForTransportSlot(this.rateLimiter ?? sharedLimiter, 'mycalendar:' + this.userId, signal);
      } catch (error) {
        throw new StepError({
          message: 'Calendar request stopped before dispatch',
          category: error instanceof StepError ? error.category : 'NETWORK',
        });
      }
      if (signal?.aborted) throw new StepError({ message: 'Calendar request cancelled before dispatch', category: 'NETWORK' });

      const token = await this.tokens.getAccessToken({ signal, ...(forceRefresh ? { forceRefresh: true } : {}) });
      forceRefresh = false;

      if (signal?.aborted) throw new StepError({ message: 'Calendar request cancelled before dispatch', category: 'NETWORK' });

      let response: Response;
      try {
        if (writing) onDispatch?.(true);
        response = await this.fetchFn(this.apiBase + path, {
          method: writing ? 'POST' : 'GET',
          signal,
          redirect: 'error',
          headers: {
            Authorization: 'Bearer ' + token,
            ...(writing ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(writing ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        if (!writing && !signal?.aborted && networkRetries++ < 2) continue;
        throw new StepError({
          message: 'Calendar transport failed',
          category: writing ? 'UNKNOWN' : 'NETWORK',
          retryable: !writing,
        });
      }

      // 401 proves Google rejected bearer token before executing read or write
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        forceRefresh = true;
        if (writing) onDispatch?.(false);
        continue;
      }

      // Calendar documents these two 403 reasons as rate limits, not permission errors.
      let rateLimited = response.status === 429;
      if (response.status === 403) {
        try {
          const failure = await response.json();
          rateLimited = Array.isArray(failure?.error?.errors) && failure.error.errors.some(
            (e: any) => e.reason === 'rateLimitExceeded' || e.reason === 'userRateLimitExceeded'
          );
        } catch { /* Permission failures stay sanitized AUTH_ERROR. */ }
      }

      if (rateLimited && rateRetries++ === 0) {
        const retryAfter = retryAfterDelayMs(response.headers.get('Retry-After'));
        if (retryAfter > MAX_RETRY_AFTER_WAIT_MS) {
          throw new StepError({
            message: 'Calendar rate limit requires a longer wait than this request budget',
            category: 'RATE_LIMIT',
            statusCode: response.status,
            retryable: false,
          });
        }
        try {
          await this.waitForRetryAfter(response.headers.get('Retry-After'), signal);
        } catch {
          throw new StepError({
            message: 'Calendar rate-limit retry cancelled',
            category: 'RATE_LIMIT',
            statusCode: response.status,
          });
        }
        if (writing) onDispatch?.(false);
        continue;
      }

      if (!writing && response.status >= 500 && serverRetries++ === 0) continue;

      if (!response.ok) {
        const status = response.status;
        const category = rateLimited
          ? 'RATE_LIMIT'
          : status === 401 || status === 403
          ? 'AUTH_ERROR'
          : status === 404
          ? 'NOT_FOUND'
          : status >= 400 && status < 500
          ? 'VALIDATION'
          : writing
          ? 'UNKNOWN'
          : 'SERVER_ERROR';

        throw new StepError({
          message: 'Calendar request failed with HTTP ' + status,
          category,
          statusCode: status,
          retryable: !writing && (rateLimited || status >= 500),
          ...(writing && status === 401 ? { details: { requestSent: false } } : {}),
        });
      }

      try {
        return await response.json();
      } catch {
        return badResponse(writing);
      }
    }
  }

  async checkConnection(signal?: AbortSignal): Promise<boolean> {
    const id = this.calendars()[0]!;
    this.assertAllowedScope('calendars', id);
    const value = await this.request(encodeURIComponent(id), signal);
    return typeof value?.summary === 'string' && typeof value?.timeZone === 'string';
  }

  async execute(toolName: string, args: Record<string, any>, context?: { signal?: AbortSignal }): Promise<any> {
    const signal = context?.signal;
    const isWrite = toolName === 'mycalendar.create_event';
    let writeDispatched = false;

    try {
      if (toolName === 'mycalendar.list_calendars') {
        only(args, ['query', 'limit']);
        const query = text(args.query, 4000).trim().toLowerCase();
        const maximum = limit(args.limit, 10);
        const result = [];
        for (const id of this.calendars()) {
          this.assertAllowedScope('calendars', id);
          const value = await this.request(encodeURIComponent(id), signal);
          if (typeof value?.summary !== 'string' || typeof value?.timeZone !== 'string') badResponse();
          if (value.summary.toLowerCase().includes(query)) result.push({ id, title: value.summary, timeZone: value.timeZone });
          if (result.length >= maximum) break;
        }
        return result;
      }

      if (toolName === 'mycalendar.list_events') {
        only(args, ['calendarId', 'timeMin', 'timeMax', 'query', 'limit']);
        const id = this.checkedId(args.calendarId);
        windowSize(args.timeMin, args.timeMax, 31);
        const maximum = limit(args.limit, 20);
        const params = new URLSearchParams({
          timeMin: args.timeMin,
          timeMax: args.timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: String(maximum),
        });
        if (args.query !== undefined) params.set('q', text(args.query, 4000));
        const events: Array<ReturnType<typeof normalizedEvent>> = [];
        const seenPages = new Set<string>();
        const done = () => {
          const truncated = events.some((event) => event.clipped);
          return { events: events.map(({ clipped: _clipped, ...event }) => event), ...(truncated ? { truncated: true } : {}) };
        };
        for (let page = 0; page < 20; page++) {
          const value = await this.request(encodeURIComponent(id) + '/events?' + params, signal);
          if (!value || typeof value !== 'object' || (value.items !== undefined && !Array.isArray(value.items))) badResponse();
          for (const item of value.items ?? []) {
            if (item?.status === 'cancelled') continue;
            events.push(normalizedEvent(item));
            if (events.length >= maximum) break;
          }
          if (events.length >= maximum || value.nextPageToken === undefined || value.nextPageToken === '') return done();
          if (typeof value.nextPageToken !== 'string' || seenPages.has(value.nextPageToken)) badResponse();
          seenPages.add(value.nextPageToken);
          params.set('pageToken', value.nextPageToken);
          params.set('maxResults', String(maximum - events.length));
        }
        throw new StepError({ message: 'Calendar event pagination exceeded its read budget; narrow the time interval', category: 'SERVER_ERROR' });
      }

      if (toolName === 'mycalendar.create_event') {
        only(args, ['calendarId', 'summary', 'description', 'start', 'end', 'location']);
        const id = this.checkedId(args.calendarId);
        windowSize(args.start, args.end, 1);
        const body = {
          summary: text(args.summary, 200, true),
          start: { dateTime: args.start },
          end: { dateTime: args.end },
          ...(args.description !== undefined ? { description: plainDescription(text(args.description, 4000)) } : {}),
          ...(args.location !== undefined ? { location: text(args.location, 1000) } : {}),
        };
        const { clipped: _clipped, ...created } = normalizedEvent(
          await this.request(
            encodeURIComponent(id) + '/events?sendUpdates=none',
            signal,
            body,
            (dispatched) => { writeDispatched = dispatched; }
          ),
          true
        );
        return created;
      }

      return invalid('tool is unsupported');
    } catch (error) {
      const e = error instanceof StepError
        ? error
        : new StepError({
            message: error instanceof Error ? error.message : 'MyCalendar transport failed',
            category: isWrite && writeDispatched ? 'UNKNOWN' : 'NETWORK',
            retryable: false,
          });

      if (!isWrite) throw e;
      if (writeDispatched) {
        if (e.statusCode === 401) {
          throw new StepError({
            category: 'AUTH_ERROR',
            statusCode: 401,
            retryable: false,
            message: e.message,
            details: { requestSent: false },
          });
        }
        throw e;
      }
      throw new StepError({
        category: e.category,
        statusCode: e.statusCode,
        retryable: e.retryable,
        message: e.message,
        details: { requestSent: false },
      });
    }
  }
}

export function createPersonalCalendarAdapter(config: PersonalCalendarAdapterConfig): PersonalCalendarAdapter {
  return new PersonalCalendarAdapter(config);
}
