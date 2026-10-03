import { CALENDAR_ID_PATTERN, CALENDAR_TIME_PATTERN } from '@wap/tool-schemas';
import { BaseAdapter, StepError, type BaseAdapterConfig } from '../base-adapter.js';
import { GlobalRateLimiter } from '../rate-limiter.js';
import { GoogleServiceAccount, type GoogleServiceAccountCredentials } from '../google/service-account.js';
import { CALENDAR_MAX_TITLE_CHARS, clipText } from '../bounds.js';

export interface CalendarAdapterConfig extends BaseAdapterConfig { credentials: GoogleServiceAccountCredentials; fetchFn?: typeof fetch }
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
const apiBase = 'https://www.googleapis.com/calendar/v3/calendars/';
const sharedLimiter = new GlobalRateLimiter({ maxRequests: 60, windowMs: 60_000 });
const MAX_RETRY_AFTER_WAIT_MS = 30_000;
const timePattern = new RegExp(CALENDAR_TIME_PATTERN);
function invalid(message: string): never { throw new StepError({ message: 'Calendar ' + message, category: 'VALIDATION' }); }
function badResponse(writing = false): never { throw new StepError({ message: 'Calendar returned an invalid response', category: writing ? 'UNKNOWN' : 'SERVER_ERROR' }); }
function retryAfterDelayMs(header: string | null): number {
  if (header == null) return 1000;
  const trimmed = header.trim();
  const seconds = /^\d+(?:\.\d+)?$/u.test(trimmed) ? Number(trimmed) * 1000 : Number.NaN;
  const delay = Number.isFinite(seconds) ? seconds : Date.parse(trimmed) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : 1000;
}
function text(value: unknown, max: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) invalid('text is outside its allowed size');
  return value;
}
function limit(value: unknown, maximum: number): number {
  if (value === undefined) return maximum;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) invalid('limit is outside its allowed range');
  return value;
}
function instant(value: unknown): number {
  if (typeof value !== 'string' || !timePattern.test(value)) invalid('time requires an explicit ISO timezone');
  // Date.parse alone normalizes impossible dates (e.g. February 30) and 24:00.
  const local = new Date(value.slice(0, 19) + 'Z');
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp) || !Number.isFinite(local.getTime()) || local.toISOString().slice(0, 19) !== value.slice(0, 19) || value.startsWith('0000-')) invalid('time is not a valid calendar instant');
  return stamp;
}
function windowSize(start: unknown, end: unknown, days: number): void {
  const duration = instant(end) - instant(start);
  if (duration <= 0 || duration > days * 86_400_000) invalid('end must follow start within the allowed duration');
}
function only(args: Record<string, any>, keys: string[]): void {
  if (Object.keys(args).some(key => !keys.includes(key))) invalid('unexpected argument');
}
function plainDescription(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function normalizedEvent(value: any, writing = false) {
  const start = value?.start?.dateTime ?? value?.start?.date;
  const end = value?.end?.dateTime ?? value?.end?.date;
  if (typeof value?.id !== 'string' || !value.id || typeof value.htmlLink !== 'string' || !value.htmlLink || typeof start !== 'string' || typeof end !== 'string') badResponse(writing);
  const title = clipText(typeof value.summary === 'string' ? value.summary : '(Không có tiêu đề)', CALENDAR_MAX_TITLE_CHARS);
  return { id: value.id, title: title.text, start, end, url: value.htmlLink, ...(title.clipped ? { clipped: true } : {}) };
}

/** Calendar v3, explicit resource scope; indeterminate writes are never replayed. */
export class CalendarAdapter extends BaseAdapter {
  readonly service = 'calendar';
  private readonly fetchFn: typeof fetch;
  private readonly auth: GoogleServiceAccount;
  private readonly account: string;
  constructor(config: CalendarAdapterConfig) {
    super(config); this.fetchFn = config.fetchFn ?? globalThis.fetch; this.account = config.credentials.clientEmail;
    this.auth = new GoogleServiceAccount({ credentials: config.credentials, fetchFn: this.fetchFn });
  }
  private calendars(): string[] {
    const ids = this.allowedScope?.calendars;
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !CALENDAR_ID_PATTERN.test(id))) throw new StepError({ message: 'Calendar requires an explicit calendar allowlist', category: 'AUTH_ERROR', statusCode: 403 });
    return [...new Set(ids)];
  }
  private checkedId(value: unknown): string {
    if (typeof value !== 'string' || !CALENDAR_ID_PATTERN.test(value)) invalid('calendarId is invalid');
    this.calendars(); this.assertAllowedScope('calendars', value); return value;
  }
  private async request(path: string, signal?: AbortSignal, body?: object): Promise<any> {
    if (signal?.aborted) throw new StepError({ message: 'Calendar request cancelled before dispatch', category: 'NETWORK' });
    const writing = body !== undefined;
    const token = await this.auth.getAccessToken(CALENDAR_SCOPE, signal);
    let networkRetries = 0; let serverRetries = 0; let rateRetries = 0;
    for (;;) {
      try { await this.waitForTransportSlot(this.rateLimiter ?? sharedLimiter, 'calendar:' + this.account, signal); }
      catch (error) { throw new StepError({ message: 'Calendar request stopped before dispatch', category: error instanceof StepError ? error.category : 'NETWORK' }); }
      if (signal?.aborted) throw new StepError({ message: 'Calendar request cancelled before dispatch', category: 'NETWORK' });
      let response: Response;
      try { response = await this.fetchFn(apiBase + path, {
        method: writing ? 'POST' : 'GET', signal, redirect: 'error',
        headers: { Authorization: 'Bearer ' + token, ...(writing ? { 'Content-Type': 'application/json' } : {}) },
        ...(writing ? { body: JSON.stringify(body) } : {}),
      }); }
      catch {
        if (!writing && !signal?.aborted && networkRetries++ < 2) continue;
        throw new StepError({ message: 'Calendar transport failed', category: writing ? 'UNKNOWN' : 'NETWORK', retryable: !writing });
      }
      // Calendar documents these two 403 reasons as rate limits, not permission errors.
      let rateLimited = response.status === 429;
      if (response.status === 403) {
        try { const failure = await response.json(); rateLimited = Array.isArray(failure?.error?.errors) && failure.error.errors.some((e: any) => e.reason === 'rateLimitExceeded' || e.reason === 'userRateLimitExceeded'); }
        catch { /* Permission failures stay sanitized AUTH_ERROR. */ }
      }
      if (rateLimited && rateRetries++ === 0) {
        const retryAfter = retryAfterDelayMs(response.headers.get('Retry-After'));
        if (retryAfter > MAX_RETRY_AFTER_WAIT_MS) {
          throw new StepError({ message: 'Calendar rate limit requires a longer wait than this request budget', category: 'RATE_LIMIT', statusCode: response.status, retryable: false });
        }
        try { await this.waitForRetryAfter(response.headers.get('Retry-After'), signal); }
        catch { throw new StepError({ message: 'Calendar rate-limit retry cancelled', category: 'RATE_LIMIT', statusCode: response.status }); }
        continue;
      }
      if (!writing && response.status >= 500 && serverRetries++ === 0) continue;
      if (!response.ok) {
        const status = response.status;
        const category = rateLimited ? 'RATE_LIMIT' : status === 401 || status === 403 ? 'AUTH_ERROR' : status === 404 ? 'NOT_FOUND'
          : status >= 400 && status < 500 ? 'VALIDATION' : writing ? 'UNKNOWN' : 'SERVER_ERROR';
        throw new StepError({ message: 'Calendar request failed with HTTP ' + status, category, statusCode: status, retryable: !writing && (rateLimited || status >= 500) });
      }
      try { return await response.json(); } catch { return badResponse(writing); }
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
    if (toolName === 'calendar.list_calendars') {
      only(args, ['query', 'limit']); const query = text(args.query, 4000).trim().toLowerCase(); const maximum = limit(args.limit, 10);
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
    if (toolName === 'calendar.list_events') {
      only(args, ['calendarId', 'timeMin', 'timeMax', 'query', 'limit']); const id = this.checkedId(args.calendarId);
      windowSize(args.timeMin, args.timeMax, 31); const maximum = limit(args.limit, 20);
      const params = new URLSearchParams({ timeMin: args.timeMin, timeMax: args.timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: String(maximum) });
      if (args.query !== undefined) params.set('q', text(args.query, 4000));
      const events: Array<ReturnType<typeof normalizedEvent>> = []; const seenPages = new Set<string>();
      const done = () => {
        const truncated = events.some(event => event.clipped);
        return { events: events.map(({ clipped: _clipped, ...event }) => event), ...(truncated ? { truncated: true } : {}) };
      };
      // Calendar can return an empty page with nextPageToken; empty is not necessarily complete.
      for (let page = 0; page < 20; page++) {
        const value = await this.request(encodeURIComponent(id) + '/events?' + params, signal);
        if (!value || typeof value !== 'object' || (value.items !== undefined && !Array.isArray(value.items))) badResponse();
        for (const item of value.items ?? []) {
          if (item?.status === 'cancelled') continue;
          events.push(normalizedEvent(item)); if (events.length >= maximum) break;
        }
        if (events.length >= maximum || value.nextPageToken === undefined || value.nextPageToken === '') return done();
        if (typeof value.nextPageToken !== 'string' || seenPages.has(value.nextPageToken)) badResponse();
        seenPages.add(value.nextPageToken); params.set('pageToken', value.nextPageToken); params.set('maxResults', String(maximum - events.length));
      }
      throw new StepError({ message: 'Calendar event pagination exceeded its read budget; narrow the time interval', category: 'SERVER_ERROR' });
    }
    if (toolName === 'calendar.create_event') {
      only(args, ['calendarId', 'summary', 'description', 'start', 'end', 'location']); const id = this.checkedId(args.calendarId);
      windowSize(args.start, args.end, 1);
      const body = { summary: text(args.summary, 200, true), start: { dateTime: args.start }, end: { dateTime: args.end },
        ...(args.description !== undefined ? { description: plainDescription(text(args.description, 4000)) } : {}),
        ...(args.location !== undefined ? { location: text(args.location, 1000) } : {}),
      };
      const { clipped: _clipped, ...created } = normalizedEvent(await this.request(encodeURIComponent(id) + '/events?sendUpdates=none', signal, body), true);
      return created;
    }
    return invalid('tool is unsupported');
  }
}
