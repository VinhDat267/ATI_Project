import { describe, expect, it } from 'vitest';
import type { ScheduleRecurrence } from '@wap/tool-schemas';
import { nextOccurrence, nextRuns } from '../../../src/services/schedules/next-occurrence.js';

const VN = 'Asia/Ho_Chi_Minh';
const at = (iso: string) => new Date(iso);
const next = (r: ScheduleRecurrence, after: string, zone = VN) => nextOccurrence(r, at(after), zone)?.toISOString() ?? null;

describe('nextOccurrence in Asia/Ho_Chi_Minh (UTC+7)', () => {
  it('returns the same day when the time is still ahead', () => {
    expect(next({ type: 'daily', time: '08:00' }, '2026-10-25T00:59:00.000Z')).toBe('2026-10-25T01:00:00.000Z');
  });

  it('returns the next time strictly after a run that is due exactly now', () => {
    expect(next({ type: 'daily', time: '08:00' }, '2026-10-25T01:00:00.000Z')).toBe('2026-10-26T01:00:00.000Z');
  });

  it('crosses midnight from 23:59 local time to the next day', () => {
    expect(next({ type: 'daily', time: '00:30' }, '2026-10-25T16:59:00.000Z')).toBe('2026-10-25T17:30:00.000Z');
  });

  it('moves from Sunday to Monday for a Monday-only schedule', () => {
    // 25/10/2026 is a Sunday; 10:00 local.
    expect(next({ type: 'weekly', time: '08:00', days: [1] }, '2026-10-25T03:00:00.000Z')).toBe('2026-10-26T01:00:00.000Z');
  });

  it('skips the weekend for a Monday-to-Friday schedule', () => {
    // Friday 30/10/2026 at 09:00 local, after the 08:30 run.
    expect(next({ type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] }, '2026-10-30T02:00:00.000Z')).toBe('2026-11-02T01:30:00.000Z');
  });

  it('runs on Sunday when day 7 is chosen', () => {
    expect(next({ type: 'weekly', time: '20:00', days: [6, 7] }, '2026-10-24T14:00:00.000Z')).toBe('2026-10-25T13:00:00.000Z');
  });

  it('crosses the end of the month and of the year', () => {
    expect(next({ type: 'daily', time: '08:00' }, '2026-10-31T02:00:00.000Z')).toBe('2026-11-01T01:00:00.000Z');
    expect(next({ type: 'daily', time: '08:00' }, '2026-12-31T02:00:00.000Z')).toBe('2027-01-01T01:00:00.000Z');
  });

  it('returns a one-off time only while it is still ahead', () => {
    const once: ScheduleRecurrence = { type: 'once', date: '2026-10-25', time: '08:00' };
    expect(next(once, '2026-10-25T00:59:00.000Z')).toBe('2026-10-25T01:00:00.000Z');
    expect(next(once, '2026-10-25T01:00:00.000Z')).toBeNull();
    expect(next(once, '2026-10-26T00:00:00.000Z')).toBeNull();
  });
});

describe('nextOccurrence in a time zone with daylight saving', () => {
  it('uses the next valid minute when the local time does not exist', () => {
    // Europe/Berlin jumps from 02:00 to 03:00 on Sunday 29/03/2026.
    expect(next({ type: 'daily', time: '02:30' }, '2026-03-28T23:00:00.000Z', 'Europe/Berlin')).toBe('2026-03-29T01:00:00.000Z');
  });

  it('uses the first of two instants when the local time happens twice', () => {
    // Europe/Berlin goes back from 03:00 to 02:00 on Sunday 25/10/2026; 02:30 is first at 00:30Z.
    expect(next({ type: 'daily', time: '02:30' }, '2026-10-24T22:00:00.000Z', 'Europe/Berlin')).toBe('2026-10-25T00:30:00.000Z');
  });
});

describe('nextRuns', () => {
  it('lists the next three times in order', () => {
    expect(nextRuns({ type: 'daily', time: '08:00' }, at('2026-10-25T02:00:00.000Z'), VN).map((d) => d.toISOString()))
      .toEqual(['2026-10-26T01:00:00.000Z', '2026-10-27T01:00:00.000Z', '2026-10-28T01:00:00.000Z']);
  });

  it('stops after the single time of a one-off schedule', () => {
    expect(nextRuns({ type: 'once', date: '2026-10-26', time: '09:00' }, at('2026-10-25T02:00:00.000Z'), VN).map((d) => d.toISOString()))
      .toEqual(['2026-10-26T02:00:00.000Z']);
  });
});
