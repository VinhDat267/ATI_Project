import type { ScheduleRecurrence } from '@wap/tool-schemas';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number }

const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(instant: number, timeZone: string): LocalParts {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** Wall-clock minutes as if UTC, so two local times compare by subtraction. */
const wall = (p: LocalParts) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);

/**
 * The instant of a local date and time. A local time skipped by a daylight-saving
 * jump moves to the next valid minute; a local time that happens twice takes the first.
 */
function zonedInstant(date: number, minutes: number, timeZone: string): number {
  for (let wanted = date + minutes * MINUTE, tries = 0; tries <= 180; wanted += MINUTE, tries++) {
    // Offsets a day either side cover both sides of any transition near this time.
    const candidates = [wanted - DAY, wanted + DAY]
      .map((probe) => wanted - (wall(localParts(probe, timeZone)) - probe))
      .filter((instant) => wall(localParts(instant, timeZone)) === wanted);
    if (candidates.length) return Math.min(...candidates);
  }
  throw new Error(`No valid local time near ${new Date(date + minutes * MINUTE).toISOString()} in ${timeZone}`);
}

function minutesOf(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour! * 60 + minute!;
}

/** The first scheduled instant strictly after `after`, or null when a one-off time has passed. */
export function nextOccurrence(recurrence: ScheduleRecurrence, after: Date, timeZone: string): Date | null {
  const minutes = minutesOf(recurrence.time);
  if (recurrence.type === 'once') {
    const [year, month, day] = recurrence.date.split('-').map(Number);
    const instant = zonedInstant(Date.UTC(year!, month! - 1, day!), minutes, timeZone);
    return instant > after.getTime() ? new Date(instant) : null;
  }
  const today = localParts(after.getTime(), timeZone);
  const start = Date.UTC(today.year, today.month - 1, today.day);
  for (let offset = 0; offset <= 8; offset++) {
    const date = start + offset * DAY;
    // getUTCDay: 0 = Sunday; ISO weekday 7 = Sunday.
    const weekday = new Date(date).getUTCDay() || 7;
    if (recurrence.type === 'weekly' && !recurrence.days.includes(weekday as never)) continue;
    const instant = zonedInstant(date, minutes, timeZone);
    if (instant > after.getTime()) return new Date(instant);
  }
  return null;
}

/** "dd/MM HH:mm" in the given time zone, for titles and state messages. */
export function localLabel(instant: Date, timeZone: string): string {
  const p = localParts(instant.getTime(), timeZone);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(p.day)}/${two(p.month)} ${two(p.hour)}:${two(p.minute)}`;
}

export function nextRuns(recurrence: ScheduleRecurrence, after: Date, timeZone: string, count = 3): Date[] {
  const runs: Date[] = [];
  for (let from = after; runs.length < count;) {
    const next = nextOccurrence(recurrence, from, timeZone);
    if (!next) break;
    runs.push(next);
    from = next;
  }
  return runs;
}
