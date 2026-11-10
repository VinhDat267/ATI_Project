import { CALENDAR_ID_PATTERN, CALENDAR_TIME_PATTERN } from '@wap/tool-schemas';
import { BaseAdapter, StepError, type BaseAdapterConfig } from '../base-adapter.js';
import { GlobalRateLimiter } from '../rate-limiter.js';
import { GoogleServiceAccount, type GoogleServiceAccountCredentials } from '../google/service-account.js';
import { CALENDAR_MAX_TITLE_CHARS, clipText } from '../bounds.js';
import {
  assertValidIanaTimeZone,
  type CalendarCoverageMetadata,
  DEFAULT_CALENDAR_TIMEZONE,
  eventBusyIntervalMs,
  isValidIanaTimeZone,
  parseStrictCalendarDate,
  resolveNaturalTemporalQuery,
} from './time-utils.js';

export * from './time-utils.js';

export interface CalendarAdapterConfig extends BaseAdapterConfig {
  credentials: GoogleServiceAccountCredentials;
  fetchFn?: typeof fetch;
  now?: () => Date;
}
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
export const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3/calendars/';
const apiBase = CALENDAR_API_BASE;
export const sharedLimiter = new GlobalRateLimiter({ maxRequests: 60, windowMs: 60_000 });
export const MAX_RETRY_AFTER_WAIT_MS = 30_000;
export const timePattern = new RegExp(CALENDAR_TIME_PATTERN);
export function invalid(message: string): never { throw new StepError({ message: 'Calendar ' + message, category: 'VALIDATION' }); }
export function badResponse(writing = false): never { throw new StepError({ message: 'Calendar returned an invalid response', category: writing ? 'UNKNOWN' : 'SERVER_ERROR' }); }
export function retryAfterDelayMs(header: string | null): number {
  if (header == null) return 1000;
  const trimmed = header.trim();
  const seconds = /^\d+(?:\.\d+)?$/u.test(trimmed) ? Number(trimmed) * 1000 : Number.NaN;
  const delay = Number.isFinite(seconds) ? seconds : Date.parse(trimmed) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : 1000;
}
export function text(value: unknown, max: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) invalid('text is outside its allowed size');
  return value;
}
export function limit(value: unknown, maximum: number): number {
  if (value === undefined) return maximum;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) invalid('limit is outside its allowed range');
  return value;
}
export function instant(value: unknown): number {
  if (typeof value !== 'string' || !timePattern.test(value)) invalid('time requires an explicit ISO timezone');
  // Date.parse alone normalizes impossible dates (e.g. February 30) and 24:00.
  const local = new Date(value.slice(0, 19) + 'Z');
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp) || !Number.isFinite(local.getTime()) || local.toISOString().slice(0, 19) !== value.slice(0, 19) || value.startsWith('0000-')) invalid('time is not a valid calendar instant');
  return stamp;
}
export function windowSize(start: unknown, end: unknown, days: number): void {
  const duration = instant(end) - instant(start);
  if (duration <= 0 || duration > days * 86_400_000) invalid('end must follow start within the allowed duration');
}
export function only(args: Record<string, any>, keys: string[]): void {
  if (Object.keys(args).some(key => !keys.includes(key))) invalid('unexpected argument');
}
export function plainDescription(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
export function normalizedEvent(value: any, writing = false) {
  const start = value?.start?.dateTime ?? value?.start?.date;
  const end = value?.end?.dateTime ?? value?.end?.date;
  if (
    typeof value?.id !== 'string' ||
    !value.id.trim() ||
    typeof value.htmlLink !== 'string' ||
    !value.htmlLink.trim() ||
    typeof start !== 'string' ||
    typeof end !== 'string'
  ) {
    badResponse(writing);
  }
  const isStartDateOnly = !start.includes('T');
  const isEndDateOnly = !end.includes('T');
  if (isStartDateOnly !== isEndDateOnly) {
    badResponse(writing);
  }
  if (isStartDateOnly) {
    if (!parseStrictCalendarDate(start) || !parseStrictCalendarDate(end) || end <= start) {
      badResponse(writing);
    }
  } else {
    const sMs = Date.parse(start);
    const eMs = Date.parse(end);
    if (!Number.isFinite(sMs) || !Number.isFinite(eMs) || eMs <= sMs) {
      badResponse(writing);
    }
  }
  const title = clipText(typeof value.summary === 'string' ? value.summary : '(Không có tiêu đề)', CALENDAR_MAX_TITLE_CHARS);
  const location =
    typeof value?.location === 'string' && value.location.trim().length > 0
      ? clipText(value.location.trim(), 200).text
      : undefined;
  const meetLink =
    typeof value?.hangoutLink === 'string' && value.hangoutLink.startsWith('https://')
      ? value.hangoutLink
      : Array.isArray(value?.conferenceData?.entryPoints)
        ? value.conferenceData.entryPoints.find(
            (ep: any) => ep?.entryPointType === 'video' && typeof ep?.uri === 'string' && ep.uri.startsWith('https://'),
          )?.uri
        : undefined;
  const attendeesList = Array.isArray(value?.attendees)
    ? value.attendees
        .map((a: any) => (typeof a?.email === 'string' ? a.email.trim() : ''))
        .filter((email: string) => email.length > 0)
    : [];
  const attendeesCount =
    Array.isArray(value?.attendees) && value.attendees.length > 0 ? value.attendees.length : undefined;
  const recurrence =
    Array.isArray(value?.recurrence) && typeof value.recurrence[0] === 'string' && value.recurrence[0].trim()
      ? value.recurrence[0].trim()
      : typeof value?.recurrence === 'string' && value.recurrence.trim()
        ? value.recurrence.trim()
        : undefined;
  const transparency = value?.transparency === 'transparent' ? ('transparent' as const) : undefined;
  const status = value?.status === 'cancelled' ? ('cancelled' as const) : undefined;
  return {
    id: value.id,
    title: title.text,
    start,
    end,
    url: value.htmlLink,
    ...(location ? { location } : {}),
    ...(meetLink ? { meetLink } : {}),
    ...(attendeesList.length > 0 ? { attendees: attendeesList } : {}),
    ...(attendeesCount !== undefined ? { attendeesCount } : {}),
    ...(recurrence ? { recurrence } : {}),
    ...(transparency ? { transparency } : {}),
    ...(status ? { status } : {}),
    ...(title.clipped ? { clipped: true } : {}),
  };
}

export interface CalendarEventWithConflict {
  id: string;
  title: string;
  start: string;
  end: string;
  url: string;
  location?: string;
  meetLink?: string;
  attendeesCount?: number;
  recurrence?: string;
  transparency?: string;
  status?: string;
  timeZone?: string;
  conflict?: boolean;
  conflictsWith?: string[];
}

export interface ParsedCalendarEventQuery {
  textQuery?: string;
  onlyConflicts: boolean;
  keywordFilter?: string;
}

const NATURAL_CALENDAR_QUERY_RE = /^(?:\*|all|tất\s+cả|tat\s+ca|today|hôm\s+nay|hom\s+nay|upcoming|sắp\s+tới|sap\s+toi|open|busy|bận|ban|free|trống|trong)$/iu;
const CONFLICT_CALENDAR_QUERY_RE = /^(?:conflicts?|overlapping|overlap|trùng\s+lịch|trung\s+lich|xung\s+đột|xung\s+dot|trùng\s+giờ|trung\s+gio)(?:\s+(.+))?$/iu;

export function parseCalendarEventQuery(
  rawQuery?: unknown,
  options?: { now?: Date; timeZone?: string },
): ParsedCalendarEventQuery {
  if (rawQuery === undefined) return { onlyConflicts: false };
  const checked = text(rawQuery, 4000);
  const trimmed = checked.trim();
  if (!trimmed || NATURAL_CALENDAR_QUERY_RE.test(trimmed)) {
    return { onlyConflicts: false };
  }
  const conflictMatch = CONFLICT_CALENDAR_QUERY_RE.exec(trimmed);
  if (conflictMatch) {
    const keyword = conflictMatch[1]?.trim();
    const cleanedKeyword = keyword
      ? resolveNaturalTemporalQuery(keyword, {
          now: options?.now,
          timeZone: options?.timeZone,
          requireTemporalWindow: false,
        }).cleanedQuery
      : undefined;
    return {
      onlyConflicts: true,
      ...(cleanedKeyword ? { keywordFilter: cleanedKeyword } : {}),
    };
  }
  const temporalResolved = resolveNaturalTemporalQuery(trimmed, {
    now: options?.now,
    timeZone: options?.timeZone,
    requireTemporalWindow: false,
  });
  if (temporalResolved.matchedTemporal) {
    return {
      ...(temporalResolved.cleanedQuery ? { textQuery: temporalResolved.cleanedQuery } : {}),
      onlyConflicts: false,
    };
  }
  return { textQuery: checked, onlyConflicts: false };
}

export function eventsOverlap(
  a: Pick<CalendarEventWithConflict, 'start' | 'end' | 'transparency' | 'status' | 'timeZone'>,
  b: Pick<CalendarEventWithConflict, 'start' | 'end' | 'transparency' | 'status' | 'timeZone'>,
  defaultTimeZone = DEFAULT_CALENDAR_TIMEZONE,
): boolean {
  const ivA = eventBusyIntervalMs(a, defaultTimeZone);
  const ivB = eventBusyIntervalMs(b, defaultTimeZone);
  if (!ivA || !ivB) return false;
  return ivA.startMs < ivB.endMs && ivB.startMs < ivA.endMs;
}

export function detectCalendarConflicts<T extends CalendarEventWithConflict>(
  events: T[],
  options?: {
    onlyConflicts?: boolean;
    keywordFilter?: string;
    annotateConflicts?: boolean;
    timeZone?: string;
  },
): Array<T & { conflict?: boolean; conflictsWith?: string[] }> {
  const annotate = options?.annotateConflicts ?? true;
  const tz =
    options?.timeZone && isValidIanaTimeZone(options.timeZone)
      ? options.timeZone
      : DEFAULT_CALENDAR_TIMEZONE;
  const annotated = events.map((ev, idx) => {
    if (ev.status === 'cancelled' || ev.transparency === 'transparent') {
      return { ...ev };
    }
    const overlappingTitles: string[] = [];
    for (let j = 0; j < events.length; j++) {
      if (idx === j) continue;
      const other = events[j]!;
      if (eventsOverlap(ev, other, tz)) {
        overlappingTitles.push(other.title);
      }
    }
    if (overlappingTitles.length > 0 && annotate) {
      return { ...ev, conflict: true, conflictsWith: overlappingTitles };
    }
    return { ...ev };
  });

  let filtered = options?.onlyConflicts ? annotated.filter((ev) => ev.conflict === true) : annotated;
  if (options?.keywordFilter) {
    const needle = options.keywordFilter.toLowerCase();
    filtered = filtered.filter((ev) => ev.title.toLowerCase().includes(needle));
  }
  return filtered;
}

/** Calendar v3, explicit resource scope; indeterminate writes are never replayed. */
export class CalendarAdapter extends BaseAdapter {
  readonly service = 'calendar';
  private readonly fetchFn: typeof fetch;
  private readonly auth: GoogleServiceAccount;
  private readonly account: string;
  private readonly nowFn: () => Date;
  constructor(config: CalendarAdapterConfig) {
    super(config);
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
    this.account = config.credentials.clientEmail;
    this.nowFn = config.now ?? (() => new Date());
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
      only(args, ['calendarId', 'timeMin', 'timeMax', 'timeZone', 'query', 'limit', 'onlyConflicts']);
      const id = this.checkedId(args.calendarId);
      const explicitTz = args.timeZone !== undefined ? assertValidIanaTimeZone(args.timeZone) : undefined;
      let timeMin = args.timeMin;
      let timeMax = args.timeMax;
      if (timeMin === undefined && timeMax === undefined) {
        const resolved = resolveNaturalTemporalQuery(args.query, {
          now: this.nowFn(),
          timeZone: explicitTz ?? DEFAULT_CALENDAR_TIMEZONE,
          requireTemporalWindow: true,
        });
        timeMin = resolved.timeMin!;
        timeMax = resolved.timeMax!;
      } else {
        windowSize(timeMin, timeMax, 31);
      }
      const maximum = limit(args.limit, 20);
      const parsedQuery = parseCalendarEventQuery(args.query, {
        now: this.nowFn(),
        timeZone: explicitTz ?? DEFAULT_CALENDAR_TIMEZONE,
      });
      const wantOnlyConflicts = parsedQuery.onlyConflicts || args.onlyConflicts === true;
      const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: String(maximum) });
      if (parsedQuery.textQuery !== undefined) params.set('q', parsedQuery.textQuery);
      const events: Array<ReturnType<typeof normalizedEvent>> = [];
      const seenPages = new Set<string>();
      let incompleteReason: string | undefined;
      const done = () => {
        const truncated = events.some(event => event.clipped);
        const baseEvents = events.map(({ clipped: _clipped, ...event }) => event);
        const processed = wantOnlyConflicts
          ? detectCalendarConflicts(baseEvents, {
              onlyConflicts: true,
              keywordFilter: parsedQuery.keywordFilter,
              annotateConflicts: true,
              timeZone: explicitTz ?? DEFAULT_CALENDAR_TIMEZONE,
            })
          : baseEvents;
        const complete = incompleteReason === undefined;
        const coverage: CalendarCoverageMetadata = {
          complete,
          returned: processed.length,
          totalAvailable: complete ? processed.length : null,
          ...(incompleteReason ? { reason: incompleteReason } : {}),
        };
        return { events: processed, ...(truncated ? { truncated: true } : {}), coverage };
      };
      // Calendar can return an empty page with nextPageToken; empty is not necessarily complete.
      for (let page = 0; page < 20; page++) {
        const value = await this.request(encodeURIComponent(id) + '/events?' + params, signal);
        if (!value || typeof value !== 'object' || (value.items !== undefined && !Array.isArray(value.items))) badResponse();
        const items = value.items ?? [];
        let hitMaxWithUnreadItems = false;
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx];
          if (item?.status === 'cancelled') continue;
          if (events.length >= maximum) {
            hitMaxWithUnreadItems = true;
            break;
          }
          events.push(normalizedEvent(item));
        }
        const hasNextPage = typeof value.nextPageToken === 'string' && value.nextPageToken !== '';
        if (events.length >= maximum) {
          if (hitMaxWithUnreadItems) {
            incompleteReason = 'limit_reached';
          } else if (hasNextPage) {
            incompleteReason = 'next_page_available';
          }
          return done();
        }
        if (value.nextPageToken === undefined || value.nextPageToken === '') return done();
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
