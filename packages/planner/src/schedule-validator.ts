import type { ScheduleRecurrence, ScheduleResponse, Weekday } from '@wap/tool-schemas';
import { INJECTION_PATTERNS, type ValidationResult } from './validator.js';

export interface ValidateScheduleOptions {
  /** False when schedules are off, and while planning a scheduled run: every schedule is refused. */
  enabled: boolean;
  now: Date;
  /** IANA time zone the recurrence times are written in. */
  timeZone: string;
  /** The conversation already has a schedule. */
  hasSchedule: boolean;
}

const ACTIONS: ReadonlyArray<ScheduleResponse['action']> = ['create', 'update', 'pause', 'resume', 'cancel'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_LEAD_MS = 60_000;
const MAX_LEAD_MS = 365 * 24 * 3_600_000;

const fail = (layer: 'schema' | 'semantic', error: string): ValidationResult => ({ valid: false, layer, error });

/** Trimmed text of 1–`max` characters (counted like PostgreSQL char_length), or null. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const length = [...trimmed].length;
  return length >= 1 && length <= max ? trimmed : null;
}

/** Milliseconds the zone's wall clock is ahead of UTC at `at`. */
function offsetMs(at: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!) - Math.floor(at / 1000) * 1000;
}

/** The instant of a local date and time; a second pass settles the offset across a daylight-saving change. */
function zonedInstant(date: string, time: string, timeZone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(first, timeZone);
}

function validDate(value: unknown): value is string {
  const match = typeof value === 'string' ? DATE.exec(value) : null;
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function recurrenceOf(value: unknown): ScheduleRecurrence | string {
  if (!value || typeof value !== 'object') return 'recurrence must be an object';
  const r = value as Record<string, unknown>;
  if (typeof r.time !== 'string' || !TIME.test(r.time)) return 'recurrence.time must be HH:mm in 24-hour time, from 00:00 to 23:59';
  switch (r.type) {
    case 'daily': return { type: 'daily', time: r.time };
    case 'once':
      if (!validDate(r.date)) return 'recurrence.date must be a real date written YYYY-MM-DD';
      return { type: 'once', date: r.date, time: r.time };
    case 'weekly': {
      const days = r.days;
      if (!Array.isArray(days) || days.length === 0 || !days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) || new Set(days).size !== days.length) {
        return 'recurrence.days must list distinct weekdays from 1 (Monday) to 7 (Sunday), at least one';
      }
      return { type: 'weekly', time: r.time, days: [...days].sort((a, b) => a - b) as Weekday[] };
    }
    default: return "recurrence.type must be 'once', 'daily' or 'weekly'";
  }
}

/** Validates a `kind: "schedule"` response (design 5.3); success returns it normalized. */
export function validateSchedule(raw: string, options: ValidateScheduleOptions): ValidationResult {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(raw)) return { valid: false, layer: 'security', error: `Security violation: output matched disallowed injection pattern ${pattern}` };
  }
  let parsed: any;
  try { parsed = JSON.parse(raw); }
  catch (err: any) { return { valid: false, layer: 'json', error: `Failed to parse JSON: ${err?.message || err}` }; }
  if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'schedule') return fail('schema', "A schedule response must be a JSON object with kind 'schedule'.");
  if (!options.enabled) return fail('semantic', 'A schedule is not allowed in this turn. Answer with a plan, clarification or refusal for the request.');
  if (!ACTIONS.includes(parsed.action)) return fail('schema', `action must be one of ${ACTIONS.join(', ')}.`);
  const summary = text(parsed.summary, 500);
  if (!summary) return fail('schema', 'summary must be one sentence of 1–500 characters.');

  const action = parsed.action as ScheduleResponse['action'];
  if (action === 'create' && options.hasSchedule) {
    return fail('semantic', 'This conversation already has a schedule. Use action update, pause, resume or cancel for it; a new schedule needs a new conversation.');
  }
  if (action !== 'create' && !options.hasSchedule) return fail('semantic', `This conversation has no schedule to ${action}. Use action create for a new schedule.`);
  if (action === 'pause' || action === 'resume' || action === 'cancel') return { valid: true, parsed: { kind: 'schedule', action, summary } };

  const name = text(parsed.name, 80);
  if (!name) return fail('schema', 'name must be 1–80 characters.');
  const request = text(parsed.request, 1000);
  if (!request) return fail('schema', 'request must be 1–1000 characters: the task as the user would type it to run now.');
  const recurrence = recurrenceOf(parsed.recurrence);
  if (typeof recurrence === 'string') return fail('schema', recurrence);
  if (recurrence.type === 'once') {
    const lead = zonedInstant(recurrence.date, recurrence.time, options.timeZone) - options.now.getTime();
    if (lead < MIN_LEAD_MS) return fail('semantic', 'A one-off time must be at least one minute in the future.');
    if (lead > MAX_LEAD_MS) return fail('semantic', 'A one-off time must be within 365 days.');
  }
  return { valid: true, parsed: { kind: 'schedule', action, name, request, recurrence, summary } };
}
