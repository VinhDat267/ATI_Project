import { IANA_TIMEZONE_PATTERN } from '@wap/tool-schemas';
import { StepError } from '../base-adapter.js';

export const DEFAULT_CALENDAR_TIMEZONE = 'Asia/Ho_Chi_Minh';

export interface CalendarCoverageMetadata {
  complete: boolean;
  returned: number;
  totalAvailable: number | null;
  reason?: string;
}

export function throwValidation(message: string, requestSent = false): never {
  throw new StepError({
    message,
    category: 'VALIDATION',
    details: { requestSent },
  });
}

export function isValidIanaTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string') return false;
  const trimmed = tz.trim();
  if (!trimmed || trimmed.length > 100 || !IANA_TIMEZONE_PATTERN.test(trimmed)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export function assertValidIanaTimeZone(tz: unknown, requestSent = false): string {
  if (!isValidIanaTimeZone(tz)) {
    throwValidation('Calendar timeZone must be a valid IANA timeZone identifier', requestSent);
  }
  return tz.trim();
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

export interface FormattedZonedInstant {
  iso: string;
  hm: string;
  date: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  offset: string;
  offsetMinutes: number;
}

export function formatInstantInTimeZone(ms: number, timeZone: string): FormattedZonedInstant {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );

  const rawYear = Number(parts.year);
  const rawMonth = Number(parts.month);
  const rawDay = Number(parts.day);
  const rawHour = Number(parts.hour === '24' ? '0' : parts.hour);
  const rawMinute = Number(parts.minute);
  const rawSecond = Number(parts.second);

  const localAsUtcMs = Date.UTC(rawYear, rawMonth - 1, rawDay, rawHour, rawMinute, rawSecond);
  const truncatedInstantMs = Math.floor(ms / 1000) * 1000;
  const offsetMinutes = Math.round((localAsUtcMs - truncatedInstantMs) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absMin = Math.abs(offsetMinutes);
  const offH = pad2(Math.floor(absMin / 60));
  const offM = pad2(absMin % 60);
  const offset = `${sign}${offH}:${offM}`;

  const date = `${parts.year}-${ pad2(rawMonth) }-${ pad2(rawDay) }`;
  const hh = pad2(rawHour);
  const mm = pad2(rawMinute);
  const ss = pad2(rawSecond);

  return {
    iso: `${date}T${hh}:${mm}:${ss}${offset}`,
    hm: `${hh}:${mm}`,
    date,
    year: rawYear,
    month: rawMonth,
    day: rawDay,
    hour: rawHour,
    minute: rawMinute,
    second: rawSecond,
    offset,
    offsetMinutes,
  };
}

export function parseStrictCalendarDate(dateStr: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() + 1 !== month ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function addCalendarDays(dateStr: string, days: number): string {
  const parsed = parseStrictCalendarDate(dateStr);
  if (!parsed) {
    throwValidation(`Calendar date "${dateStr}" is not a valid YYYY-MM-DD calendar date`);
  }
  const dt = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function zonedWallTimeToInstant(
  dateStr: string,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): { ms: number; iso: string; hm: string; nonexistentWallTime: boolean } {
  let effectiveDate = dateStr;
  let effectiveHour = hour;
  if (hour === 24 && minute === 0 && second === 0) {
    effectiveDate = addCalendarDays(dateStr, 1);
    effectiveHour = 0;
  }
  const parsed = parseStrictCalendarDate(effectiveDate);
  if (!parsed) {
    throwValidation(`Calendar date "${effectiveDate}" is invalid`);
  }
  const targetWallUtcMs = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    effectiveHour,
    minute,
    second,
  );

  const fmt0 = formatInstantInTimeZone(targetWallUtcMs, timeZone);
  const guess1 = targetWallUtcMs - fmt0.offsetMinutes * 60_000;
  const fmt1 = formatInstantInTimeZone(guess1, timeZone);
  const guess2 = targetWallUtcMs - fmt1.offsetMinutes * 60_000;
  const fmt2 = formatInstantInTimeZone(guess2, timeZone);

  const matchesWallTime =
    fmt2.year === parsed.year &&
    fmt2.month === parsed.month &&
    fmt2.day === parsed.day &&
    fmt2.hour === effectiveHour &&
    fmt2.minute === minute &&
    fmt2.second === second;

  return {
    ms: guess2,
    iso: fmt2.iso,
    hm: fmt2.hm,
    nonexistentWallTime: !matchesWallTime,
  };
}

export function validateDateTimeMatchesTimeZone(
  isoDateTime: string,
  timeZone: string,
  requestSent = false,
): void {
  const validZone = assertValidIanaTimeZone(timeZone, requestSent);
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      isoDateTime,
    );
  if (!match) {
    throwValidation('Calendar start/end must be a valid ISO-8601 timestamp with timezone offset', requestSent);
  }
  const [, datePart, hhStr, mmStr, ssStr, rawOffset] = match;
  if (!parseStrictCalendarDate(datePart!)) {
    throwValidation('Calendar start/end date is invalid', requestSent);
  }
  const ms = Date.parse(isoDateTime);
  if (!Number.isFinite(ms)) {
    throwValidation('Calendar start/end timestamp is invalid', requestSent);
  }
  const normalizedInputOffset = rawOffset === 'Z' ? '+00:00' : rawOffset!;
  const zoned = formatInstantInTimeZone(ms, validZone);
  const expectedWall = `${datePart}T${hhStr}:${mmStr}:${ssStr}`;
  const actualWall = `${zoned.date}T${pad2(zoned.hour)}:${pad2(zoned.minute)}:${pad2(zoned.second)}`;

  if (zoned.offset !== normalizedInputOffset || actualWall !== expectedWall) {
    throwValidation(
      `Calendar timestamp "${isoDateTime}" offset does not match IANA timeZone "${validZone}" (expected ${zoned.offset})`,
      requestSent,
    );
  }
}

export function enumerateLocalDates(
  timeMinIso: string,
  timeMaxIso: string,
  timeZone: string,
): string[] {
  const startMs = Date.parse(timeMinIso);
  const endMs = Date.parse(timeMaxIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }
  const startDate = formatInstantInTimeZone(startMs, timeZone).date;
  const lastInclusiveMs = Math.max(startMs, endMs - 1);
  const endDate = formatInstantInTimeZone(lastInclusiveMs, timeZone).date;

  const dates: string[] = [];
  let current = startDate;
  for (let guard = 0; guard < 64; guard++) {
    dates.push(current);
    if (current >= endDate) break;
    current = addCalendarDays(current, 1);
  }
  return dates;
}

export interface BusyAwareEventLike {
  start: string;
  end: string;
  transparency?: string;
  status?: string;
  timeZone?: string;
}

export function eventBusyIntervalMs(
  event: BusyAwareEventLike,
  defaultTimeZone = DEFAULT_CALENDAR_TIMEZONE,
): { startMs: number; endMs: number } | null {
  if (event.status === 'cancelled' || event.transparency === 'transparent') {
    return null;
  }
  const tz =
    event.timeZone && isValidIanaTimeZone(event.timeZone) ? event.timeZone : defaultTimeZone;

  const isStartDateOnly = !event.start.includes('T');
  const isEndDateOnly = !event.end.includes('T');
  if (isStartDateOnly || isEndDateOnly) {
    if (!isStartDateOnly || !isEndDateOnly) return null;
    if (!parseStrictCalendarDate(event.start) || !parseStrictCalendarDate(event.end)) {
      return null;
    }
    const startZoned = zonedWallTimeToInstant(event.start, 0, 0, 0, tz);
    const endZoned = zonedWallTimeToInstant(event.end, 0, 0, 0, tz);
    if (endZoned.ms <= startZoned.ms) return null;
    return { startMs: startZoned.ms, endMs: endZoned.ms };
  }

  const startMs = Date.parse(event.start);
  const endMs = Date.parse(event.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  return { startMs, endMs };
}

const WEEKDAY_TOKENS: Array<{ pattern: RegExp; isoDow: number }> = [
  { pattern: /\b(?:next\s+)?(?:monday|thứ\s+hai|thu\s+hai|thứ\s+2|thu\s+2)\b/iu, isoDow: 1 },
  { pattern: /\b(?:next\s+)?(?:tuesday|thứ\s+ba|thu\s+ba|thứ\s+3|thu\s+3)\b/iu, isoDow: 2 },
  { pattern: /\b(?:next\s+)?(?:wednesday|thứ\s+tư|thu\s+tu|thứ\s+4|thu\s+4)\b/iu, isoDow: 3 },
  { pattern: /\b(?:next\s+)?(?:thursday|thứ\s+năm|thu\s+nam|thứ\s+5|thu\s+5)\b/iu, isoDow: 4 },
  { pattern: /\b(?:next\s+)?(?:friday|thứ\s+sáu|thu\s+sau|thứ\s+6|thu\s+6)\b/iu, isoDow: 5 },
  { pattern: /\b(?:next\s+)?(?:saturday|thứ\s+bảy|thu\s+bay|thứ\s+7|thu\s+7)\b/iu, isoDow: 6 },
  { pattern: /\b(?:next\s+)?(?:sunday|chủ\s+nhật|chu\s+nhat)\b/iu, isoDow: 7 },
];

const NEXT_WEEK_RE = /\b(?:next\s+week|tuần\s+tới|tuan\s+toi|tuần\s+sau|tuan\s+sau)\b/iu;
const THIS_WEEK_RE = /\b(?:this\s+week|tuần\s+này|tuan\s+nay|upcoming|sắp\s+tới|sap\s+toi)\b/iu;
const MONTH_END_RE = /\b(?:month-end|month\s+end|end\s+of\s+(?:the\s+)?month|cuối\s+tháng|cuoi\s+thang)\b/iu;
const TOMORROW_RE = /\b(?:ngày\s+mai|ngay\s+mai|sáng\s+mai|sang\s+mai|chiều\s+mai|chieu\s+mai|tối\s+mai|toi\s+mai|mai|tomorrow)\b/iu;
const TODAY_RE = /\b(?:today|hôm\s+nay|hom\s+nay|sáng\s+nay|sang\s+nay|chiều\s+nay|chieu\s+nay|tối\s+nay|toi\s+nay)\b/iu;
const GENERIC_STATUS_ONLY_RE = /^(?:\*|all|tất\s+cả|tat\s+ca|open|busy|bận|ban|free|trống|trong)$/iu;
const EXPLICIT_DATE_TOKEN_RE = /\b(\d{4}-\d{2}-\d{2})\b/u;

function isoDayOfWeek(dateStr: string): number {
  const parsed = parseStrictCalendarDate(dateStr)!;
  const utcDay = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

function lastDayOfMonth(year: number, month: number): string {
  const dt = new Date(Date.UTC(year, month, 0));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export interface NaturalQueryResolution {
  matchedTemporal: boolean;
  timeMin?: string;
  timeMax?: string;
  cleanedQuery: string;
}

export function resolveNaturalTemporalQuery(
  rawQuery: unknown,
  options?: {
    now?: Date;
    timeZone?: string;
    requireTemporalWindow?: boolean;
  },
): NaturalQueryResolution {
  const requireWindow = options?.requireTemporalWindow ?? false;
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    if (requireWindow) {
      throwValidation('time requires an explicit ISO timezone');
    }
    return { matchedTemporal: false, cleanedQuery: '' };
  }

  let working = rawQuery.trim();
  let matchedKind:
    | { kind: 'explicit_date'; date: string }
    | { kind: 'next_week' }
    | { kind: 'month_end' }
    | { kind: 'this_week' }
    | { kind: 'tomorrow' }
    | { kind: 'today' }
    | { kind: 'generic_status' }
    | { kind: 'weekday'; isoDow: number; forceNext: boolean }
    | null = null;

  const stripPattern = (re: RegExp) => {
    working = working
      .replace(re, ' ')
      .replace(/\b(?:on|in|for|vào\s+ngày|vao\s+ngay|vào|vao|ngày|ngay|trong)\s*$/iu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // 1. Explicit YYYY-MM-DD date token
  const explicitDateMatch = EXPLICIT_DATE_TOKEN_RE.exec(working);
  if (explicitDateMatch?.[1]) {
    const candidateDate = explicitDateMatch[1];
    if (!parseStrictCalendarDate(candidateDate)) {
      throwValidation(`Calendar query contains an invalid date "${candidateDate}"`);
    }
    matchedKind = { kind: 'explicit_date', date: candidateDate };
    stripPattern(EXPLICIT_DATE_TOKEN_RE);
  } else if (NEXT_WEEK_RE.test(working)) {
    // 2. Next ISO week: next Monday 00:00 through following Monday 00:00
    matchedKind = { kind: 'next_week' };
    stripPattern(NEXT_WEEK_RE);
  } else if (MONTH_END_RE.test(working)) {
    // 3. Month-end: last calendar day of the current month in timeZone
    matchedKind = { kind: 'month_end' };
    stripPattern(MONTH_END_RE);
  } else if (THIS_WEEK_RE.test(working)) {
    // 4. This week / upcoming: 7 local days starting today
    matchedKind = { kind: 'this_week' };
    stripPattern(THIS_WEEK_RE);
  } else if (TOMORROW_RE.test(working)) {
    // 5. Tomorrow
    matchedKind = { kind: 'tomorrow' };
    stripPattern(TOMORROW_RE);
  } else if (TODAY_RE.test(working)) {
    // 6. Today
    matchedKind = { kind: 'today' };
    stripPattern(TODAY_RE);
  } else if (GENERIC_STATUS_ONLY_RE.test(working)) {
    // 7. Generic status token ('open', 'busy', 'bận', 'free', 'trống', '*', 'all')
    matchedKind = { kind: 'generic_status' };
    working = '';
  } else {
    // 8. Weekday names
    for (const wd of WEEKDAY_TOKENS) {
      const m = wd.pattern.exec(working);
      if (m) {
        matchedKind = {
          kind: 'weekday',
          isoDow: wd.isoDow,
          forceNext: /^next\s+/iu.test(m[0]),
        };
        stripPattern(wd.pattern);
        break;
      }
    }
  }

  if (!matchedKind) {
    if (requireWindow) {
      throwValidation(
        'Calendar query date/time expression is ambiguous or unsupported; please provide explicit timeMin/timeMax or a supported date phrase',
      );
    }
    return {
      matchedTemporal: false,
      cleanedQuery: working,
    };
  }

  if (!requireWindow && !isValidIanaTimeZone(options?.timeZone)) {
    return {
      matchedTemporal: true,
      cleanedQuery: working,
    };
  }

  const timeZone = assertValidIanaTimeZone(options?.timeZone);
  const now = options?.now ?? new Date();
  const todayFmt = formatInstantInTimeZone(now.getTime(), timeZone);
  const todayDate = todayFmt.date;
  const todayIsoDow = isoDayOfWeek(todayDate);

  let startDate: string;
  let endDate: string;

  switch (matchedKind.kind) {
    case 'explicit_date':
      startDate = matchedKind.date;
      endDate = addCalendarDays(matchedKind.date, 1);
      break;
    case 'next_week': {
      const daysToNextMonday = 8 - todayIsoDow;
      startDate = addCalendarDays(todayDate, daysToNextMonday);
      endDate = addCalendarDays(startDate, 7);
      break;
    }
    case 'month_end':
      startDate = lastDayOfMonth(todayFmt.year, todayFmt.month);
      endDate = addCalendarDays(startDate, 1);
      break;
    case 'this_week':
      startDate = todayDate;
      endDate = addCalendarDays(todayDate, 7);
      break;
    case 'tomorrow':
      startDate = addCalendarDays(todayDate, 1);
      endDate = addCalendarDays(startDate, 1);
      break;
    case 'today':
    case 'generic_status':
      startDate = todayDate;
      endDate = addCalendarDays(todayDate, 1);
      break;
    case 'weekday': {
      let delta = (matchedKind.isoDow - todayIsoDow + 7) % 7;
      if (delta === 0 && matchedKind.forceNext) {
        delta = 7;
      }
      startDate = addCalendarDays(todayDate, delta);
      endDate = addCalendarDays(startDate, 1);
      break;
    }
  }

  const startZoned = zonedWallTimeToInstant(startDate, 0, 0, 0, timeZone);
  const endZoned = zonedWallTimeToInstant(endDate, 0, 0, 0, timeZone);
  return {
    matchedTemporal: true,
    timeMin: startZoned.iso,
    timeMax: endZoned.iso,
    cleanedQuery: working,
  };
}
