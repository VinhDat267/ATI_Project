import { CALENDAR_ID_PATTERN, GMAIL_ADDRESS_PATTERN, GMAIL_MAX_RECIPIENTS } from '@wap/tool-schemas';
import { BaseAdapter, StepError, type BaseAdapterConfig } from '../base-adapter.js';
import type { GmailAccessTokenProvider } from '../gmail/token-provider.js';
import {
  assertValidIanaTimeZone,
  badResponse,
  CALENDAR_API_BASE,
  type CalendarCoverageMetadata,
  type CalendarEventWithConflict,
  detectCalendarConflicts,
  enumerateLocalDates,
  eventBusyIntervalMs,
  eventsOverlap,
  formatInstantInTimeZone,
  invalid,
  isValidIanaTimeZone,
  limit,
  MAX_RETRY_AFTER_WAIT_MS,
  normalizedEvent,
  only,
  parseCalendarEventQuery,
  plainDescription,
  resolveNaturalTemporalQuery,
  retryAfterDelayMs,
  sharedLimiter,
  text,
  throwValidation,
  validateDateTimeMatchesTimeZone,
  windowSize,
  zonedWallTimeToInstant,
} from './calendar-adapter.js';

const INTERNAL_AVAILABILITY_MAX_PAGES = 10;
const INTERNAL_AVAILABILITY_MAX_EVENTS = 250;
const INTERNAL_AVAILABILITY_PAGE_SIZE = 100;

const RECURRENCE_PRESETS: Record<string, string> = {
  DAILY: 'RRULE:FREQ=DAILY',
  WEEKDAYS: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  WEEKLY: 'RRULE:FREQ=WEEKLY',
  BIWEEKLY: 'RRULE:FREQ=WEEKLY;INTERVAL=2',
  MONTHLY: 'RRULE:FREQ=MONTHLY',
};

const VALID_RRULE_RE = /^RRULE:FREQ=(?:DAILY|WEEKLY|MONTHLY|YEARLY)(?:;[A-Z]+=[A-Za-z0-9,+-]+)*$/;

function normalizeRecurrenceRule(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  const candidate =
    Array.isArray(raw) && raw.length === 1 && typeof raw[0] === 'string' ? raw[0] : raw;
  const checked = text(candidate, 500, true).trim().toUpperCase();
  if (RECURRENCE_PRESETS[checked]) {
    return [RECURRENCE_PRESETS[checked]!];
  }
  const normalized = checked.startsWith('RRULE:') ? checked : `RRULE:${checked}`;
  if (!VALID_RRULE_RE.test(normalized)) {
    invalid('recurrence must be DAILY, WEEKDAYS, WEEKLY, BIWEEKLY, MONTHLY, or a valid RFC 5545 RRULE');
  }
  return [normalized];
}

function normalizeAttendees(raw: unknown): Array<{ email: string }> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > GMAIL_MAX_RECIPIENTS) {
    invalid('attendees must be a non-empty array of at most 20 email addresses');
  }
  const seen = new Set<string>();
  const out: Array<{ email: string }> = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !GMAIL_ADDRESS_PATTERN.test(item)) {
      invalid('attendees must contain valid bare email addresses');
    }
    const clean = item.trim().toLowerCase();
    if (!seen.has(clean)) {
      seen.add(clean);
      out.push({ email: clean });
    }
  }
  return out;
}

export interface PersonalCalendarAdapterConfig extends BaseAdapterConfig {
  userId: string;
  tokens: GmailAccessTokenProvider;
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

/** Personal Calendar v3 (OAuth 2.0 user credentials); explicit resource scope; indeterminate writes are never replayed. */
export class PersonalCalendarAdapter extends BaseAdapter {
  readonly service = 'mycalendar';
  private readonly userId: string;
  private readonly tokens: GmailAccessTokenProvider;
  private readonly apiBase: string;
  private readonly fetchFn: typeof fetch;
  private readonly nowFn: () => Date;
  private readonly calendarTimeZoneCache = new Map<string, string>();

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
    const rawBase = config.apiBaseUrl ?? CALENDAR_API_BASE;
    this.apiBase = rawBase.includes('/calendar/v3/calendars')
      ? rawBase.replace(/\/+$/, '') + '/'
      : `${rawBase.replace(/\/+$/, '')}/calendar/v3/calendars/`;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
    this.nowFn = config.now ?? (() => new Date());
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
    onDispatch?: (dispatched: boolean) => void,
    methodOverride?: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  ): Promise<any> {
    if (signal?.aborted) throw new StepError({ message: 'Calendar request cancelled before dispatch', category: 'NETWORK' });
    const method = methodOverride ?? (body !== undefined ? 'POST' : 'GET');
    const writing = method !== 'GET';
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
          method,
          signal,
          redirect: 'error',
          headers: {
            Authorization: 'Bearer ' + token,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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

      if (response.status === 204 || method === 'DELETE') {
        return null;
      }

      try {
        return await response.json();
      } catch {
        return badResponse(writing);
      }
    }
  }

  private async resolveCalendarTimeZone(
    calendarId: string,
    signal?: AbortSignal,
    options?: { strictForRecurringWrite?: boolean },
  ): Promise<string> {
    const cached = this.calendarTimeZoneCache.get(calendarId);
    if (cached && isValidIanaTimeZone(cached)) {
      return cached;
    }
    const meta = await this.request(encodeURIComponent(calendarId), signal);
    if (typeof meta?.timeZone === 'string' && isValidIanaTimeZone(meta.timeZone)) {
      const cleanTz = meta.timeZone.trim();
      this.calendarTimeZoneCache.set(calendarId, cleanTz);
      return cleanTz;
    }
    if (options?.strictForRecurringWrite) {
      throwValidation(
        'Recurring event requires a valid IANA timeZone in args or authorized calendar metadata',
        false,
      );
    }
    badResponse(false);
  }

  async checkConnection(signal?: AbortSignal): Promise<boolean> {
    const id = this.calendars()[0]!;
    this.assertAllowedScope('calendars', id);
    const value = await this.request(encodeURIComponent(id), signal);
    if (typeof value?.timeZone === 'string' && isValidIanaTimeZone(value.timeZone)) {
      this.calendarTimeZoneCache.set(id, value.timeZone.trim());
    }
    return typeof value?.summary === 'string' && typeof value?.timeZone === 'string';
  }

  async findConflicts(
    slot: { calendarId: string; start: string; end: string },
    signal?: AbortSignal,
  ): Promise<CalendarEventWithConflict[]> {
    const listed = await this.execute(
      'mycalendar.list_events',
      {
        calendarId: slot.calendarId,
        timeMin: slot.start,
        timeMax: slot.end,
        limit: 20,
      },
      { signal },
    );
    const items: CalendarEventWithConflict[] = Array.isArray(listed?.events) ? listed.events : [];
    const fallbackTz = this.calendarTimeZoneCache.get(slot.calendarId);
    return items.filter((ev) => eventsOverlap(ev, { start: slot.start, end: slot.end }, fallbackTz));
  }

  async execute(toolName: string, args: Record<string, any>, context?: { signal?: AbortSignal }): Promise<any> {
    const signal = context?.signal;
    const isWrite =
      toolName === 'mycalendar.create_event' ||
      toolName === 'mycalendar.update_event' ||
      toolName === 'mycalendar.delete_event' ||
      toolName === 'mycalendar.schedule_meet';
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
          if (isValidIanaTimeZone(value.timeZone)) {
            this.calendarTimeZoneCache.set(id, value.timeZone.trim());
          }
          if (value.summary.toLowerCase().includes(query)) result.push({ id, title: value.summary, timeZone: value.timeZone });
          if (result.length >= maximum) break;
        }
        return result;
      }

      if (toolName === 'mycalendar.list_events') {
        only(args, ['calendarId', 'timeMin', 'timeMax', 'timeZone', 'query', 'limit', 'onlyConflicts']);
        const id = this.checkedId(args.calendarId);
        const explicitTz = args.timeZone !== undefined ? assertValidIanaTimeZone(args.timeZone) : undefined;
        let timeMin = args.timeMin;
        let timeMax = args.timeMax;
        let calendarTz = explicitTz;
        if (timeMin === undefined && timeMax === undefined) {
          if (typeof args.query !== 'string' || !args.query.trim()) {
            invalid('time requires an explicit ISO timezone');
          }
          // Validate natural query syntax before making any metadata request
          const preCheck = resolveNaturalTemporalQuery(args.query, {
            requireTemporalWindow: false,
          });
          if (!preCheck.matchedTemporal) {
            throwValidation(
              'Calendar query date/time expression is ambiguous or unsupported; please provide explicit timeMin/timeMax or a supported date phrase',
              false,
            );
          }
          if (!calendarTz) {
            calendarTz = await this.resolveCalendarTimeZone(id, signal);
          }
          const resolved = resolveNaturalTemporalQuery(args.query, {
            now: this.nowFn(),
            timeZone: calendarTz,
            requireTemporalWindow: true,
          });
          timeMin = resolved.timeMin!;
          timeMax = resolved.timeMax!;
        } else {
          windowSize(timeMin, timeMax, 31);
          if (!calendarTz) {
            calendarTz = this.calendarTimeZoneCache.get(id);
          }
        }
        const maximum = limit(args.limit, 20);
        const parsedQuery = parseCalendarEventQuery(args.query, {
          now: this.nowFn(),
          timeZone: calendarTz,
        });
        const wantOnlyConflicts = parsedQuery.onlyConflicts || args.onlyConflicts === true;
        const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: String(maximum),
        });
        if (parsedQuery.textQuery !== undefined) params.set('q', parsedQuery.textQuery);
        const events: Array<ReturnType<typeof normalizedEvent>> = [];
        const seenPages = new Set<string>();
        let incompleteReason: string | undefined;
        const done = () => {
          const truncated = events.some((event) => event.clipped);
          const baseEvents = events.map(({ clipped: _clipped, ...event }) => event);
          const processed = wantOnlyConflicts
            ? detectCalendarConflicts(baseEvents, {
                onlyConflicts: true,
                keywordFilter: parsedQuery.keywordFilter,
                annotateConflicts: true,
                timeZone: calendarTz,
              })
            : baseEvents;
          const complete = incompleteReason === undefined;
          const coverage: CalendarCoverageMetadata = {
            complete,
            returned: processed.length,
            totalAvailable: complete ? processed.length : null,
            ...(incompleteReason ? { reason: incompleteReason } : {}),
          };
          return {
            events: processed,
            ...(truncated ? { truncated: true } : {}),
            coverage,
          };
        };
        for (let page = 0; page < 20; page++) {
          const value = await this.request(encodeURIComponent(id) + '/events?' + params, signal);
          if (!value || typeof value !== 'object' || (value.items !== undefined && !Array.isArray(value.items))) badResponse();
          if (
            value.nextPageToken !== undefined &&
            (typeof value.nextPageToken !== 'string' ||
              (value.nextPageToken !== '' && seenPages.has(value.nextPageToken)))
          ) {
            badResponse();
          }
          if (typeof value.timeZone === 'string' && isValidIanaTimeZone(value.timeZone)) {
            const cleanValTz = value.timeZone.trim();
            this.calendarTimeZoneCache.set(id, cleanValTz);
            calendarTz ??= cleanValTz;
          }
          const items = value.items ?? [];
          let hitMaxWithUnreadItems = false;
          for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            if (item?.status === 'cancelled') continue;
            if (events.length >= maximum) {
              hitMaxWithUnreadItems = true;
              break;
            }
            const rawStart = item?.start?.dateTime ?? item?.start?.date;
            const isAllDayItem = typeof rawStart === 'string' && !rawStart.includes('T');
            const hasItemTz =
              (typeof item?.start?.timeZone === 'string' && isValidIanaTimeZone(item.start.timeZone)) ||
              (typeof item?.end?.timeZone === 'string' && isValidIanaTimeZone(item.end.timeZone));
            if (isAllDayItem && !hasItemTz && !calendarTz) {
              calendarTz = await this.resolveCalendarTimeZone(id, signal);
            }
            events.push(normalizedEvent(item, false, isAllDayItem ? calendarTz : explicitTz));
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
          seenPages.add(value.nextPageToken);
          params.set('pageToken', value.nextPageToken);
          params.set('maxResults', String(maximum - events.length));
        }
        throw new StepError({ message: 'Calendar event pagination exceeded its read budget; narrow the time interval', category: 'SERVER_ERROR' });
      }

      if (toolName === 'mycalendar.get_event') {
        only(args, ['calendarId', 'eventId']);
        const id = this.checkedId(args.calendarId);
        const eventId = text(args.eventId, 256, true).trim();
        if (eventId === '.' || eventId === '..' || eventId.includes('/')) {
          invalid('eventId is invalid');
        }
        const raw = await this.request(
          `${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}`,
          signal,
        );
        const rawStart = raw?.start?.dateTime ?? raw?.start?.date;
        const isAllDayItem = typeof rawStart === 'string' && !rawStart.includes('T');
        const hasItemTz =
          (typeof raw?.start?.timeZone === 'string' && isValidIanaTimeZone(raw.start.timeZone)) ||
          (typeof raw?.end?.timeZone === 'string' && isValidIanaTimeZone(raw.end.timeZone));
        const fallbackTz =
          isAllDayItem && !hasItemTz ? await this.resolveCalendarTimeZone(id, signal) : undefined;
        const { clipped: _clipped, ...base } = normalizedEvent(raw, false, fallbackTz);
        const description =
          typeof raw?.description === 'string' && raw.description.trim().length > 0
            ? raw.description.trim().slice(0, 4000)
            : undefined;
        return {
          ...base,
          ...(description ? { description } : {}),
        };
      }

      if (toolName === 'mycalendar.find_free_slots') {
        only(args, [
          'calendarId',
          'timeMin',
          'timeMax',
          'timeZone',
          'query',
          'durationMinutes',
          'workdayStartHour',
          'workdayEndHour',
          'limit',
        ]);
        const id = this.checkedId(args.calendarId);
        const explicitTz = args.timeZone !== undefined ? assertValidIanaTimeZone(args.timeZone) : undefined;
        let timeMin = args.timeMin;
        let timeMax = args.timeMax;
        if (timeMin === undefined && timeMax === undefined) {
          if (typeof args.query !== 'string' || !args.query.trim()) {
            invalid('time requires an explicit ISO timezone');
          }
          const preCheck = resolveNaturalTemporalQuery(args.query, {
            requireTemporalWindow: false,
          });
          if (!preCheck.matchedTemporal) {
            throwValidation(
              'Calendar query date/time expression is ambiguous or unsupported; please provide explicit timeMin/timeMax or a supported date phrase',
              false,
            );
          }
        } else {
          windowSize(timeMin, timeMax, 31);
        }
        const durationMinutes =
          args.durationMinutes === undefined ? 60 : limit(args.durationMinutes, 480);
        if (durationMinutes < 15) invalid('durationMinutes must be at least 15');
        const workdayStartHour =
          args.workdayStartHour === undefined ? 8 : Number(args.workdayStartHour);
        const workdayEndHour =
          args.workdayEndHour === undefined ? 18 : Number(args.workdayEndHour);
        if (
          !Number.isInteger(workdayStartHour) ||
          !Number.isInteger(workdayEndHour) ||
          workdayStartHour < 0 ||
          workdayEndHour > 24 ||
          workdayEndHour <= workdayStartHour
        ) {
          invalid('workday hours are invalid');
        }
        const maxSlots = limit(args.limit, 10);
        const calendarTz = explicitTz ?? (await this.resolveCalendarTimeZone(id, signal));
        if (timeMin === undefined && timeMax === undefined) {
          const resolved = resolveNaturalTemporalQuery(args.query, {
            now: this.nowFn(),
            timeZone: calendarTz,
            requireTemporalWindow: true,
          });
          timeMin = resolved.timeMin!;
          timeMax = resolved.timeMax!;
        }

        // Internal bounded multi-page availability scan (bypasses the 20-event list_events display cap)
        const scanParams = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: String(INTERNAL_AVAILABILITY_PAGE_SIZE),
        });
        const scannedEvents: Array<ReturnType<typeof normalizedEvent>> = [];
        const seenScanPages = new Set<string>();
        let scanIncompleteReason: string | undefined;

        for (let page = 0; page < INTERNAL_AVAILABILITY_MAX_PAGES; page++) {
          const remaining = INTERNAL_AVAILABILITY_MAX_EVENTS - scannedEvents.length;
          scanParams.set('maxResults', String(Math.min(INTERNAL_AVAILABILITY_PAGE_SIZE, remaining)));
          const value = await this.request(encodeURIComponent(id) + '/events?' + scanParams, signal);
          if (!value || typeof value !== 'object' || (value.items !== undefined && !Array.isArray(value.items))) {
            badResponse();
          }
          if (value.nextPageToken !== undefined && typeof value.nextPageToken !== 'string') {
            badResponse();
          }
          if (
            typeof value.nextPageToken === 'string' &&
            value.nextPageToken !== '' &&
            seenScanPages.has(value.nextPageToken)
          ) {
            scanIncompleteReason = 'pagination_incomplete';
            break;
          }
          const items = value.items ?? [];
          let hitMaxWithUnreadItems = false;
          for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            if (item?.status === 'cancelled') continue;
            if (scannedEvents.length >= INTERNAL_AVAILABILITY_MAX_EVENTS) {
              hitMaxWithUnreadItems = true;
              break;
            }
            scannedEvents.push(normalizedEvent(item, false, calendarTz));
          }
          const hasNextPage = typeof value.nextPageToken === 'string' && value.nextPageToken !== '';
          if (scannedEvents.length >= INTERNAL_AVAILABILITY_MAX_EVENTS) {
            if (hitMaxWithUnreadItems) {
              scanIncompleteReason = 'limit_reached';
            } else if (hasNextPage) {
              scanIncompleteReason = 'next_page_available';
            }
            break;
          }
          if (!hasNextPage) {
            break;
          }
          if (page === INTERNAL_AVAILABILITY_MAX_PAGES - 1) {
            scanIncompleteReason = 'page_budget_exceeded';
            break;
          }
          seenScanPages.add(value.nextPageToken);
          scanParams.set('pageToken', value.nextPageToken);
        }

        const busyIntervals = scannedEvents
          .map((ev) => eventBusyIntervalMs(ev, calendarTz))
          .filter((iv): iv is { startMs: number; endMs: number } => iv !== null)
          .sort((a, b) => a.startMs - b.startMs);

        const scanComplete = scanIncompleteReason === undefined;
        const coverage: CalendarCoverageMetadata = {
          complete: scanComplete,
          returned: scannedEvents.length,
          totalAvailable: scanComplete ? scannedEvents.length : null,
          ...(scanIncompleteReason ? { reason: scanIncompleteReason } : {}),
        };

        // Never report free slots when event coverage is incomplete
        if (!scanComplete) {
          return {
            calendarId: id,
            busyCount: busyIntervals.length,
            freeSlots: [],
            coverage,
          };
        }

        const windowStartMs = Date.parse(timeMin);
        const windowEndMs = Date.parse(timeMax);
        const durationMs = durationMinutes * 60_000;
        const stepMs = 30 * 60_000;
        const localDates = enumerateLocalDates(timeMin, timeMax, calendarTz);

        const freeSlots: Array<{
          start: string;
          end: string;
          durationMinutes: number;
          label: string;
        }> = [];

        for (const dateStr of localDates) {
          if (freeSlots.length >= maxSlots) break;
          const workStart = zonedWallTimeToInstant(dateStr, workdayStartHour, 0, 0, calendarTz);
          const workEnd = zonedWallTimeToInstant(dateStr, workdayEndHour, 0, 0, calendarTz);
          const dayStartMs = Math.max(windowStartMs, workStart.ms);
          const dayEndMs = Math.min(windowEndMs, workEnd.ms);
          if (dayEndMs <= dayStartMs) continue;

          let cursor = dayStartMs;
          while (cursor + durationMs <= dayEndMs && freeSlots.length < maxSlots) {
            const candEnd = cursor + durationMs;
            const overlapping = busyIntervals.find(
              (b) => cursor < b.endMs && b.startMs < candEnd,
            );
            if (!overlapping) {
              const startIso = formatInstantInTimeZone(cursor, calendarTz);
              const endIso = formatInstantInTimeZone(candEnd, calendarTz);
              freeSlots.push({
                start: startIso.iso,
                end: endIso.iso,
                durationMinutes,
                label: `${startIso.hm}–${endIso.hm}`,
              });
              cursor = candEnd;
            } else {
              cursor = Math.max(cursor + stepMs, overlapping.endMs);
            }
          }
        }

        return {
          calendarId: id,
          busyCount: busyIntervals.length,
          freeSlots,
          coverage,
        };
      }

      if (toolName === 'mycalendar.create_event' || toolName === 'mycalendar.schedule_meet') {
        const isScheduleMeet = toolName === 'mycalendar.schedule_meet';
        only(
          args,
          isScheduleMeet
            ? ['calendarId', 'summary', 'description', 'start', 'end', 'timeZone', 'attendees', 'sendInvites', 'recurrence']
            : ['calendarId', 'summary', 'description', 'start', 'end', 'timeZone', 'location', 'createMeetLink', 'attendees', 'sendInvites', 'recurrence'],
        );
        const id = this.checkedId(args.calendarId);
        windowSize(args.start, args.end, 1);
        if (!isScheduleMeet && args.createMeetLink !== undefined && typeof args.createMeetLink !== 'boolean') {
          invalid('createMeetLink must be a boolean');
        }
        if (args.sendInvites !== undefined && typeof args.sendInvites !== 'boolean') {
          invalid('sendInvites must be a boolean');
        }
        const recurrence = normalizeRecurrenceRule(args.recurrence);
        const attendees = normalizeAttendees(args.attendees);
        let effectiveTimeZone: string | undefined;
        if (args.timeZone !== undefined) {
          effectiveTimeZone = assertValidIanaTimeZone(args.timeZone, false);
        } else if (recurrence) {
          effectiveTimeZone = await this.resolveCalendarTimeZone(id, signal, {
            strictForRecurringWrite: true,
          });
        }
        if (effectiveTimeZone) {
          validateDateTimeMatchesTimeZone(args.start, effectiveTimeZone, false);
          validateDateTimeMatchesTimeZone(args.end, effectiveTimeZone, false);
        }
        const wantMeet = isScheduleMeet || args.createMeetLink === true;
        const sendUpdates = args.sendInvites === true ? 'all' : 'none';
        const body = {
          summary: text(args.summary, 200, true),
          start: {
            dateTime: args.start,
            ...(effectiveTimeZone ? { timeZone: effectiveTimeZone } : {}),
          },
          end: {
            dateTime: args.end,
            ...(effectiveTimeZone ? { timeZone: effectiveTimeZone } : {}),
          },
          ...(args.description !== undefined ? { description: plainDescription(text(args.description, 4000)) } : {}),
          ...(!isScheduleMeet && args.location !== undefined ? { location: text(args.location, 1000) } : {}),
          ...(attendees ? { attendees } : {}),
          ...(recurrence ? { recurrence } : {}),
          ...(wantMeet
            ? {
                conferenceData: {
                  createRequest: {
                    requestId: `ati-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' },
                  },
                },
              }
            : {}),
        };
        const querySuffix = wantMeet ? `?sendUpdates=${sendUpdates}&conferenceDataVersion=1` : `?sendUpdates=${sendUpdates}`;
        const { clipped: _clipped, ...created } = normalizedEvent(
          await this.request(
            encodeURIComponent(id) + '/events' + querySuffix,
            signal,
            body,
            (dispatched) => { writeDispatched = dispatched; }
          ),
          true
        );
        if (isScheduleMeet && !created.meetLink) {
          throw new StepError({
            message: 'Calendar created the event without a Meet link',
            category: 'UNKNOWN',
          });
        }
        return created;
      }

      if (toolName === 'mycalendar.update_event') {
        only(args, ['calendarId', 'eventId', 'summary', 'description', 'start', 'end', 'timeZone', 'location', 'createMeetLink', 'attendees', 'sendInvites', 'recurrence']);
        const id = this.checkedId(args.calendarId);
        const eventId = text(args.eventId, 256, true).trim();
        if (eventId === '.' || eventId === '..' || eventId.includes('/')) {
          invalid('eventId is invalid');
        }
        if ((args.start !== undefined) !== (args.end !== undefined)) {
          invalid('start and end must both be provided when rescheduling');
        }
        if (args.start !== undefined && args.end !== undefined) {
          windowSize(args.start, args.end, 1);
        }
        if (args.createMeetLink !== undefined && typeof args.createMeetLink !== 'boolean') {
          invalid('createMeetLink must be a boolean');
        }
        if (args.sendInvites !== undefined && typeof args.sendInvites !== 'boolean') {
          invalid('sendInvites must be a boolean');
        }
        const recurrence = normalizeRecurrenceRule(args.recurrence);
        const attendees = normalizeAttendees(args.attendees);
        let effectiveTimeZone: string | undefined;
        if (args.timeZone !== undefined) {
          effectiveTimeZone = assertValidIanaTimeZone(args.timeZone, false);
        } else if (recurrence) {
          effectiveTimeZone = await this.resolveCalendarTimeZone(id, signal, {
            strictForRecurringWrite: true,
          });
        }
        let targetStart: string | undefined = args.start;
        let targetEnd: string | undefined = args.end;
        if (recurrence && (targetStart === undefined || targetEnd === undefined)) {
          const existing = await this.request(
            `${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}`,
            signal,
          );
          if (typeof existing?.start?.dateTime === 'string' && typeof existing?.end?.dateTime === 'string') {
            targetStart = existing.start.dateTime;
            targetEnd = existing.end.dateTime;
          }
        }
        if (effectiveTimeZone && targetStart !== undefined && targetEnd !== undefined) {
          validateDateTimeMatchesTimeZone(targetStart, effectiveTimeZone, false);
          validateDateTimeMatchesTimeZone(targetEnd, effectiveTimeZone, false);
        }
        const wantMeet = args.createMeetLink === true;
        const sendUpdates = args.sendInvites === true ? 'all' : 'none';
        const body: Record<string, any> = {
          ...(args.summary !== undefined ? { summary: text(args.summary, 200, true) } : {}),
          ...(targetStart !== undefined && targetEnd !== undefined
            ? {
                start: {
                  dateTime: targetStart,
                  ...(effectiveTimeZone ? { timeZone: effectiveTimeZone } : {}),
                },
                end: {
                  dateTime: targetEnd,
                  ...(effectiveTimeZone ? { timeZone: effectiveTimeZone } : {}),
                },
              }
            : {}),
          ...(args.description !== undefined ? { description: plainDescription(text(args.description, 4000)) } : {}),
          ...(args.location !== undefined ? { location: text(args.location, 1000) } : {}),
          ...(attendees ? { attendees } : {}),
          ...(recurrence ? { recurrence } : {}),
          ...(wantMeet
            ? {
                conferenceData: {
                  createRequest: {
                    requestId: `ati-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' },
                  },
                },
              }
            : {}),
        };
        if (Object.keys(body).length === 0) {
          invalid('update_event requires at least one field to update');
        }
        const querySuffix = wantMeet ? `?sendUpdates=${sendUpdates}&conferenceDataVersion=1` : `?sendUpdates=${sendUpdates}`;
        const { clipped: _clipped, ...updated } = normalizedEvent(
          await this.request(
            `${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}${querySuffix}`,
            signal,
            body,
            (dispatched) => { writeDispatched = dispatched; },
            'PATCH',
          ),
          true,
        );
        return updated;
      }

      if (toolName === 'mycalendar.delete_event') {
        only(args, ['calendarId', 'eventId']);
        const id = this.checkedId(args.calendarId);
        const eventId = text(args.eventId, 256, true).trim();
        if (eventId === '.' || eventId === '..' || eventId.includes('/')) {
          invalid('eventId is invalid');
        }
        await this.request(
          `${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
          signal,
          undefined,
          (dispatched) => { writeDispatched = dispatched; },
          'DELETE',
        );
        return { id: eventId, deleted: true };
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
