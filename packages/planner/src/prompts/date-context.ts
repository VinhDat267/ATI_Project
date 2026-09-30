export interface DateContext {
  now: Date;
  /** IANA time zone the users plan in, e.g. Asia/Ho_Chi_Minh. */
  timeZone: string;
}

const WEEKDAYS = [
  ['chủ nhật', 'Sunday'], ['thứ 2', 'Monday'], ['thứ 3', 'Tuesday'], ['thứ 4', 'Wednesday'],
  ['thứ 5', 'Thursday'], ['thứ 6', 'Friday'], ['thứ 7', 'Saturday'],
] as const;

function localParts(now: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'longOffset',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  // longOffset renders "GMT+07:00", or bare "GMT" for UTC itself.
  const offset = parts.timeZoneName!.replace('GMT', '') || '+00:00';
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), offset };
}

/** A calendar day `days` after the local date, as ISO date and weekday index. */
function dayAfter(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { iso: date.toISOString().slice(0, 10), weekday: date.getUTCDay() };
}

const label = (weekday: number) => `${WEEKDAYS[weekday]![0]} / ${WEEKDAYS[weekday]![1]}`;

/**
 * Today's date and the next seven days, computed here so the model looks up
 * "thứ 6" or "Friday" instead of doing calendar arithmetic itself.
 */
export function buildDateContext({ now, timeZone }: DateContext): string {
  const { year, month, day, offset } = localParts(now, timeZone);
  const today = dayAfter(year, month, day, 0);
  const upcoming = Array.from({ length: 7 }, (_, index) => dayAfter(year, month, day, index + 1));
  return `### Current date
Today is ${today.iso}, ${label(today.weekday)}, time zone ${timeZone} (UTC${offset}).
Resolve relative dates with this table; a weekday name means its next occurrence after today:
- ngày mai / tomorrow: ${upcoming[0]!.iso}
${upcoming.map((date) => `- ${label(date.weekday)}: ${date.iso}`).join('\n')}
Put deadlines in the tool's \`due\` argument as ISO-8601 with this offset, e.g. ${upcoming[0]!.iso}T17:00:00${offset}; use 17:00 when the user gives no time. Leave \`due\` out when the user states no deadline.`;
}
