import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CalendarAdapter,
  createPersonalCalendarAdapter,
} from '../../src/index.js';
import { MYCALENDAR_TOOLS } from '@wap/tool-schemas';
import { startFakeGoogleGmail } from '../../../../scripts/fake-google-gmail.mjs';

const CAL_ID = 'primary@example.com';
const NY_CAL_ID = 'ny@example.com';
const HTML_LINK = 'https://www.google.com/calendar/event?eid=fixture';
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makePersonalAdapter(options: {
  fetchFn?: typeof fetch;
  apiBaseUrl?: string;
  now?: () => Date;
  calendars?: string[];
}) {
  return createPersonalCalendarAdapter({
    userId: 'usr_cal_rem_b',
    tokens: { getAccessToken: async () => 'tok-test' },
    allowedScope: { calendars: options.calendars ?? [CAL_ID, NY_CAL_ID, 'gmail-owner@example.test'] },
    fetchFn: options.fetchFn,
    apiBaseUrl: options.apiBaseUrl,
    now: options.now,
  });
}

describe('Worker B Calendar Remediation (CALENDAR-AUDIT-01, 03, 04, 06, 08)', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  describe('CALENDAR-AUDIT-01: additive coverage metadata and bounded internal availability scan', () => {
    it('returns coverage.complete=true with exact totalAvailable when <20 events and no nextPageToken', async () => {
      const adapter = makePersonalAdapter({
        fetchFn: async () =>
          jsonResponse({
            items: [
              {
                id: 'ev-1',
                summary: 'Standup',
                htmlLink: HTML_LINK,
                start: { dateTime: '2026-11-16T09:00:00+07:00' },
                end: { dateTime: '2026-11-16T09:30:00+07:00' },
              },
              {
                id: 'ev-2',
                summary: 'Review',
                htmlLink: HTML_LINK,
                start: { dateTime: '2026-11-16T10:00:00+07:00' },
                end: { dateTime: '2026-11-16T10:30:00+07:00' },
              },
            ],
          }),
      });

      const out = (await adapter.execute('mycalendar.list_events', {
        calendarId: CAL_ID,
        timeMin: '2026-11-16T00:00:00+07:00',
        timeMax: '2026-11-16T23:59:59+07:00',
      })) as {
        events: unknown[];
        coverage?: { complete: boolean; returned: number; totalAvailable: number | null; reason?: string };
      };

      expect(out.events).toHaveLength(2);
      expect(out.coverage).toEqual({
        complete: true,
        returned: 2,
        totalAvailable: 2,
      });
      const listSchema = MYCALENDAR_TOOLS.find((t) => t.name === 'mycalendar.list_events');
      expect(listSchema?.outputSchema.properties).toHaveProperty('coverage');
    });

    it('returns coverage.complete=true when exactly 20 events are returned and nextPageToken is absent', async () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: `ev-${i + 1}`,
        summary: `Event ${i + 1}`,
        htmlLink: HTML_LINK,
        start: { dateTime: `2026-11-16T${String(Math.floor(i / 2) + 8).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}:00+07:00` },
        end: { dateTime: `2026-11-16T${String(Math.floor(i / 2) + 8).padStart(2, '0')}:${i % 2 === 0 ? '25' : '55'}:00+07:00` },
      }));

      const adapter = makePersonalAdapter({
        fetchFn: async () => jsonResponse({ items }),
      });

      const out = (await adapter.execute('mycalendar.list_events', {
        calendarId: CAL_ID,
        timeMin: '2026-11-16T00:00:00+07:00',
        timeMax: '2026-11-16T23:59:59+07:00',
      })) as {
        events: unknown[];
        coverage?: { complete: boolean; returned: number; totalAvailable: number | null; reason?: string };
      };

      expect(out.events).toHaveLength(20);
      expect(out.coverage).toEqual({
        complete: true,
        returned: 20,
        totalAvailable: 20,
      });
    });

    it('returns coverage.complete=false and totalAvailable=null when 20 events are returned with nextPageToken', async () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: `ev-${i + 1}`,
        summary: `Event ${i + 1}`,
        htmlLink: HTML_LINK,
        start: { dateTime: '2026-11-16T08:00:00+07:00' },
        end: { dateTime: '2026-11-16T08:15:00+07:00' },
      }));

      const adapter = makePersonalAdapter({
        fetchFn: async () => jsonResponse({ items, nextPageToken: 'page-2-token' }),
      });

      const out = (await adapter.execute('mycalendar.list_events', {
        calendarId: CAL_ID,
        timeMin: '2026-11-16T00:00:00+07:00',
        timeMax: '2026-11-16T23:59:59+07:00',
      })) as {
        events: unknown[];
        coverage?: { complete: boolean; returned: number; totalAvailable: number | null; reason?: string };
      };

      expect(out.events).toHaveLength(20);
      expect(out.coverage).toMatchObject({
        complete: false,
        returned: 20,
        totalAvailable: null,
        reason: 'next_page_available',
      });
    });

    it('returns coverage.complete=false when limit is reached while unread items remain on the same page, or when post-filtering reduces returned count on an incomplete page', async () => {
      const items = Array.from({ length: 25 }, (_, i) => ({
        id: `ev-${i + 1}`,
        summary: i < 2 ? 'Overlap' : `Distinct ${i + 1}`,
        htmlLink: HTML_LINK,
        start: {
          dateTime:
            i < 2
              ? '2026-11-16T09:00:00+07:00'
              : `2026-11-${String(17 + Math.floor(i / 8)).padStart(2, '0')}T${String((i % 8) + 8).padStart(2, '0')}:00:00+07:00`,
        },
        end: {
          dateTime:
            i < 2
              ? '2026-11-16T09:30:00+07:00'
              : `2026-11-${String(17 + Math.floor(i / 8)).padStart(2, '0')}T${String((i % 8) + 8).padStart(2, '0')}:20:00+07:00`,
        },
      }));

      const adapter = makePersonalAdapter({
        fetchFn: async () => jsonResponse({ items }),
      });

      const cappedOut = (await adapter.execute('mycalendar.list_events', {
        calendarId: CAL_ID,
        timeMin: '2026-11-16T00:00:00+07:00',
        timeMax: '2026-11-18T00:00:00+07:00',
        limit: 20,
      })) as {
        events: unknown[];
        coverage?: { complete: boolean; returned: number; totalAvailable: number | null; reason?: string };
      };

      expect(cappedOut.events).toHaveLength(20);
      expect(cappedOut.coverage).toMatchObject({
        complete: false,
        returned: 20,
        totalAvailable: null,
        reason: 'limit_reached',
      });

      const conflictFilteredOut = (await adapter.execute('mycalendar.list_events', {
        calendarId: CAL_ID,
        timeMin: '2026-11-16T00:00:00+07:00',
        timeMax: '2026-11-18T00:00:00+07:00',
        onlyConflicts: true,
      })) as {
        events: unknown[];
        coverage?: { complete: boolean; returned: number; totalAvailable: number | null; reason?: string };
      };

      expect(conflictFilteredOut.events).toHaveLength(2);
      expect(conflictFilteredOut.coverage).toMatchObject({
        complete: false,
        returned: 2,
        totalAvailable: null,
      });
    });

    it('scans beyond 20 events across pages in find_free_slots so event #21 is not falsely reported free, and returns no freeSlots when pagination remains incomplete', async () => {
      // 20 events occupying 08:00..13:00 in 15-min slices on page 1, plus event #21 occupying 14:00..15:00 on page 2
      const page1Items = Array.from({ length: 20 }, (_, i) => {
        const startMin = 8 * 60 + i * 15;
        const endMin = startMin + 15;
        const sh = String(Math.floor(startMin / 60)).padStart(2, '0');
        const sm = String(startMin % 60).padStart(2, '0');
        const eh = String(Math.floor(endMin / 60)).padStart(2, '0');
        const em = String(endMin % 60).padStart(2, '0');
        return {
          id: `p1-${i + 1}`,
          summary: `Morning ${i + 1}`,
          htmlLink: HTML_LINK,
          start: { dateTime: `2026-11-16T${sh}:${sm}:00+07:00` },
          end: { dateTime: `2026-11-16T${eh}:${em}:00+07:00` },
        };
      });
      const page2Items = [
        {
          id: 'p2-21',
          summary: 'Busy 14:00-15:00',
          htmlLink: HTML_LINK,
          start: { dateTime: '2026-11-16T14:00:00+07:00' },
          end: { dateTime: '2026-11-16T15:00:00+07:00' },
        },
      ];

      const adapter = makePersonalAdapter({
        fetchFn: async (input) => {
          const url = new URL(typeof input === 'string' ? input : input.toString());
          if (!url.pathname.endsWith('/events')) {
            return jsonResponse({ id: CAL_ID, summary: 'Primary', timeZone: 'Asia/Ho_Chi_Minh' });
          }
          const pageToken = url.searchParams.get('pageToken');
          if (!pageToken) {
            return jsonResponse({ items: page1Items, nextPageToken: 'page-2' });
          }
          if (pageToken === 'page-2') {
            return jsonResponse({ items: page2Items });
          }
          return jsonResponse({ items: [] });
        },
      });

      const out = (await adapter.execute('mycalendar.find_free_slots', {
        calendarId: CAL_ID,
        timeMin: '2026-11-16T08:00:00+07:00',
        timeMax: '2026-11-16T16:00:00+07:00',
        durationMinutes: 60,
        workdayStartHour: 8,
        workdayEndHour: 16,
      })) as {
        freeSlots: Array<{ start: string; end: string; durationMinutes: number; label: string }>;
        coverage?: { complete: boolean; returned: number; totalAvailable: number | null };
      };

      expect(out.coverage).toMatchObject({
        complete: true,
        returned: 21,
        totalAvailable: 21,
      });
      // 14:00-15:00 is occupied by event #21, so free slots are 13:00-14:00 and 15:00-16:00 (NOT 14:00-15:00!)
      expect(out.freeSlots.map((s) => ({ start: s.start, end: s.end }))).toEqual([
        { start: '2026-11-16T13:00:00+07:00', end: '2026-11-16T14:00:00+07:00' },
        { start: '2026-11-16T15:00:00+07:00', end: '2026-11-16T16:00:00+07:00' },
      ]);

      // When provider keeps returning nextPageToken beyond the internal scan budget, never claim free slots
      const endlessAdapter = makePersonalAdapter({
        fetchFn: async (input) => {
          const url = new URL(typeof input === 'string' ? input : input.toString());
          if (!url.pathname.endsWith('/events')) {
            return jsonResponse({ id: CAL_ID, summary: 'Primary', timeZone: 'Asia/Ho_Chi_Minh' });
          }
          return jsonResponse({
            items: page1Items,
            nextPageToken: 'endless-token',
          });
        },
      });

      const incompleteOut = (await endlessAdapter.execute('mycalendar.find_free_slots', {
        calendarId: CAL_ID,
        timeMin: '2026-11-16T08:00:00+07:00',
        timeMax: '2026-11-16T18:00:00+07:00',
        durationMinutes: 60,
      })) as {
        freeSlots: Array<{ start: string; end: string }>;
        coverage?: { complete: boolean; totalAvailable: number | null };
      };

      expect(incompleteOut.freeSlots).toEqual([]);
      expect(incompleteOut.coverage?.complete).toBe(false);
      expect(incompleteOut.coverage?.totalAvailable).toBeNull();
    });
  });

  describe('CALENDAR-AUDIT-03: multi-day find_free_slots across local calendar days', () => {
    it('iterates all local calendar days in [timeMin, timeMax] when Day 1 is full and Day 2 is free', async () => {
      const adapter = makePersonalAdapter({
        fetchFn: async (input) => {
          const url = new URL(typeof input === 'string' ? input : input.toString());
          if (!url.pathname.endsWith('/events')) {
            return jsonResponse({ id: CAL_ID, summary: 'Primary', timeZone: 'Asia/Ho_Chi_Minh' });
          }
          return jsonResponse({
            items: [
              {
                id: 'busy-day1',
                summary: 'Day 1 Workshop',
                htmlLink: HTML_LINK,
                start: { dateTime: '2026-11-16T08:00:00+07:00' },
                end: { dateTime: '2026-11-16T18:00:00+07:00' },
              },
            ],
          });
        },
      });

      const out = (await adapter.execute('mycalendar.find_free_slots', {
        calendarId: CAL_ID,
        timeMin: '2026-11-16T08:00:00+07:00',
        timeMax: '2026-11-18T18:00:00+07:00',
        durationMinutes: 120,
        workdayStartHour: 9,
        workdayEndHour: 11,
      })) as { freeSlots: Array<{ start: string; end: string }> };

      expect(out.freeSlots.map((s) => ({ start: s.start, end: s.end }))).toEqual([
        { start: '2026-11-17T09:00:00+07:00', end: '2026-11-17T11:00:00+07:00' },
        { start: '2026-11-18T09:00:00+07:00', end: '2026-11-18T11:00:00+07:00' },
      ]);
    });

    it('handles cross-midnight busy events, partial start/end windows, and DST boundary transitions in the calendar IANA timezone', async () => {
      // Cross-midnight event from 2026-11-16 22:00+07:00 to 2026-11-17 09:30+07:00
      const adapter = makePersonalAdapter({
        fetchFn: async (input) => {
          const url = new URL(typeof input === 'string' ? input : input.toString());
          if (!url.pathname.endsWith('/events')) {
            return jsonResponse({ id: CAL_ID, summary: 'Primary', timeZone: 'Asia/Ho_Chi_Minh' });
          }
          return jsonResponse({
            items: [
              {
                id: 'overnight',
                summary: 'Overnight Maintenance',
                htmlLink: HTML_LINK,
                start: { dateTime: '2026-11-16T22:00:00+07:00' },
                end: { dateTime: '2026-11-17T09:30:00+07:00' },
              },
            ],
          });
        },
      });

      const out = (await adapter.execute('mycalendar.find_free_slots', {
        calendarId: CAL_ID,
        timeMin: '2026-11-16T17:00:00+07:00',
        timeMax: '2026-11-17T10:30:00+07:00',
        durationMinutes: 60,
        workdayStartHour: 8,
        workdayEndHour: 18,
      })) as { freeSlots: Array<{ start: string; end: string }> };

      expect(out.freeSlots.map((s) => ({ start: s.start, end: s.end }))).toEqual([
        { start: '2026-11-16T17:00:00+07:00', end: '2026-11-16T18:00:00+07:00' },
        { start: '2026-11-17T09:30:00+07:00', end: '2026-11-17T10:30:00+07:00' },
      ]);

      // America/New_York fall-back DST transition on 2026-11-01 (-04:00 -> -05:00)
      const nyAdapter = makePersonalAdapter({
        fetchFn: async (input) => {
          const url = new URL(typeof input === 'string' ? input : input.toString());
          if (!url.pathname.endsWith('/events')) {
            return jsonResponse({ id: NY_CAL_ID, summary: 'NY', timeZone: 'America/New_York' });
          }
          return jsonResponse({ items: [] });
        },
      });

      const nyOut = (await nyAdapter.execute('mycalendar.find_free_slots', {
        calendarId: NY_CAL_ID,
        timeMin: '2026-10-31T09:00:00-04:00',
        timeMax: '2026-11-01T11:00:00-05:00',
        durationMinutes: 120,
        workdayStartHour: 9,
        workdayEndHour: 11,
      })) as { freeSlots: Array<{ start: string; end: string }> };

      expect(nyOut.freeSlots.map((s) => ({ start: s.start, end: s.end }))).toEqual([
        { start: '2026-10-31T09:00:00-04:00', end: '2026-10-31T11:00:00-04:00' },
        { start: '2026-11-01T09:00:00-05:00', end: '2026-11-01T11:00:00-05:00' },
      ]);
    });
  });

  describe('CALENDAR-AUDIT-04: recurring event writes require matching IANA timeZone on start and end', () => {
    it('accepts optional timeZone in mycalendar write schemas and populates start.timeZone and end.timeZone for recurring create_event, update_event, and schedule_meet', async () => {
      expect(
        MYCALENDAR_TOOLS.find((t) => t.name === 'mycalendar.create_event')?.inputSchema.properties,
      ).toHaveProperty('timeZone');
      expect(
        MYCALENDAR_TOOLS.find((t) => t.name === 'mycalendar.update_event')?.inputSchema.properties,
      ).toHaveProperty('timeZone');
      expect(
        MYCALENDAR_TOOLS.find((t) => t.name === 'mycalendar.schedule_meet')?.inputSchema.properties,
      ).toHaveProperty('timeZone');

      const capturedBodies: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
      const adapter = makePersonalAdapter({
        fetchFn: async (input, init) => {
          const url = typeof input === 'string' ? input : input.toString();
          const method = init?.method ?? 'GET';
          if (method === 'GET' && !url.includes('/events')) {
            return jsonResponse({ id: CAL_ID, summary: 'Primary', timeZone: 'Asia/Ho_Chi_Minh' });
          }
          const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
          capturedBodies.push({ method, url, body });
          return jsonResponse({
            id: `ev-${capturedBodies.length}`,
            summary: (body.summary as string) ?? 'Recurring',
            htmlLink: HTML_LINK,
            start: body.start ?? { dateTime: '2026-11-16T09:00:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
            end: body.end ?? { dateTime: '2026-11-16T09:30:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
            recurrence: body.recurrence,
            hangoutLink: 'https://meet.google.com/rec-meet-xyz',
          });
        },
      });

      // 1. create_event resolving timeZone from authorized calendar metadata when args.timeZone is omitted
      await adapter.execute('mycalendar.create_event', {
        calendarId: CAL_ID,
        summary: 'Weekly Sync',
        start: '2026-11-16T09:00:00+07:00',
        end: '2026-11-16T09:30:00+07:00',
        recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
      });
      expect(capturedBodies[0]?.body.start).toEqual({
        dateTime: '2026-11-16T09:00:00+07:00',
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      expect(capturedBodies[0]?.body.end).toEqual({
        dateTime: '2026-11-16T09:30:00+07:00',
        timeZone: 'Asia/Ho_Chi_Minh',
      });

      // 2. update_event with explicit args.timeZone and recurrence
      await adapter.execute('mycalendar.update_event', {
        calendarId: CAL_ID,
        eventId: 'ev-1',
        start: '2026-11-16T10:00:00+07:00',
        end: '2026-11-16T10:30:00+07:00',
        timeZone: 'Asia/Ho_Chi_Minh',
        recurrence: 'RRULE:FREQ=DAILY;COUNT=5',
      });
      expect(capturedBodies[1]?.body.start).toEqual({
        dateTime: '2026-11-16T10:00:00+07:00',
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      expect(capturedBodies[1]?.body.end).toEqual({
        dateTime: '2026-11-16T10:30:00+07:00',
        timeZone: 'Asia/Ho_Chi_Minh',
      });

      // 3. schedule_meet with recurrence
      await adapter.execute('mycalendar.schedule_meet', {
        calendarId: CAL_ID,
        summary: 'Recurring Meet',
        start: '2026-11-16T14:00:00+07:00',
        end: '2026-11-16T14:30:00+07:00',
        timeZone: 'Asia/Ho_Chi_Minh',
        recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
      });
      expect(capturedBodies[2]?.body.start).toEqual({
        dateTime: '2026-11-16T14:00:00+07:00',
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      expect(capturedBodies[2]?.body.end).toEqual({
        dateTime: '2026-11-16T14:30:00+07:00',
        timeZone: 'Asia/Ho_Chi_Minh',
      });
    });

    it('rejects recurring writes before dispatch when timeZone is invalid, offset mismatches the IANA zone, or calendar metadata has no valid timeZone', async () => {
      let postDispatched = false;
      const adapter = makePersonalAdapter({
        fetchFn: async (input, init) => {
          const url = typeof input === 'string' ? input : input.toString();
          if ((init?.method ?? 'GET') === 'GET' && !url.includes('/events')) {
            return jsonResponse({ id: CAL_ID, summary: 'Primary' });
          }
          postDispatched = true;
          return jsonResponse({
            id: 'should-not-dispatch',
            summary: 'Weekly Sync',
            htmlLink: HTML_LINK,
            start: { dateTime: '2026-11-16T09:00:00+07:00' },
            end: { dateTime: '2026-11-16T09:30:00+07:00' },
          });
        },
      });

      // Missing timeZone when calendar metadata lacks timeZone
      await expect(
        adapter.execute('mycalendar.create_event', {
          calendarId: CAL_ID,
          summary: 'Weekly Sync',
          start: '2026-11-16T09:00:00+07:00',
          end: '2026-11-16T09:30:00+07:00',
          recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
        }),
      ).rejects.toMatchObject({
        category: 'VALIDATION',
        details: { requestSent: false },
      });

      // Invalid IANA timeZone string
      await expect(
        adapter.execute('mycalendar.create_event', {
          calendarId: CAL_ID,
          summary: 'Weekly Sync',
          start: '2026-11-16T09:00:00+07:00',
          end: '2026-11-16T09:30:00+07:00',
          timeZone: 'Mars/Phobos',
          recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
        }),
      ).rejects.toMatchObject({
        category: 'VALIDATION',
        details: { requestSent: false },
      });

      // Offset mismatch (+07:00 timestamp paired with America/New_York)
      await expect(
        adapter.execute('mycalendar.create_event', {
          calendarId: CAL_ID,
          summary: 'Weekly Sync',
          start: '2026-11-16T09:00:00+07:00',
          end: '2026-11-16T09:30:00+07:00',
          timeZone: 'America/New_York',
          recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
        }),
      ).rejects.toMatchObject({
        category: 'VALIDATION',
        details: { requestSent: false },
      });

      expect(postDispatched).toBe(false);
    });

    it('enforces start.timeZone and end.timeZone in fake-google-gmail.mjs when recurrence is present', async () => {
      const provider = await startFakeGoogleGmail({ port: 0 });
      cleanups.push(async () => {
        await provider.close();
      });

      const refreshToken = provider.mintRefreshToken();
      const tokenRes = await fetch(provider.endpoints.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: 'gmail-test.apps.googleusercontent.com',
          client_secret: 'fake-gmail-secret',
        }),
      });
      const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

      // Direct POST with recurrence but missing start.timeZone / end.timeZone must be rejected with HTTP 400
      const rawBadRes = await fetch(
        `${provider.origin}/calendar/v3/calendars/${encodeURIComponent(provider.settings.email)}/events`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            summary: 'Missing TimeZone Recurring',
            start: { dateTime: '2026-11-16T09:00:00+07:00' },
            end: { dateTime: '2026-11-16T09:30:00+07:00' },
            recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
          }),
        },
      );
      expect(rawBadRes.status).toBe(400);

      // PersonalCalendarAdapter against fake-google-gmail succeeds because it attaches start.timeZone & end.timeZone
      const adapter = createPersonalCalendarAdapter({
        userId: 'usr_fake_google',
        tokens: { getAccessToken: async () => accessToken },
        allowedScope: { calendars: [provider.settings.email] },
        apiBaseUrl: provider.origin,
      });
      const created = (await adapter.execute('mycalendar.create_event', {
        calendarId: provider.settings.email,
        summary: 'Valid Recurring via Adapter',
        start: '2026-11-16T09:00:00+07:00',
        end: '2026-11-16T09:30:00+07:00',
        recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
      })) as { id: string; recurrence?: string };
      expect(created.id).toBeTruthy();
      expect(created.recurrence).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO');
    });
  });

  describe('CALENDAR-AUDIT-06: busy semantics for transparent, cancelled, and all-day events', () => {
    it('ignores transparent and cancelled events in eventsOverlap, detectCalendarConflicts, and find_free_slots', async () => {
      const adapter = makePersonalAdapter({
        fetchFn: async (input) => {
          const url = new URL(typeof input === 'string' ? input : input.toString());
          if (!url.pathname.endsWith('/events')) {
            return jsonResponse({ id: CAL_ID, summary: 'Primary', timeZone: 'Asia/Ho_Chi_Minh' });
          }
          return jsonResponse({
            items: [
              {
                id: 'ev-transparent',
                summary: 'FYI Out of Office Banner',
                htmlLink: HTML_LINK,
                transparency: 'transparent',
                status: 'confirmed',
                start: { dateTime: '2026-11-16T08:00:00+07:00' },
                end: { dateTime: '2026-11-16T12:00:00+07:00' },
              },
              {
                id: 'ev-cancelled',
                summary: 'Cancelled Meeting',
                htmlLink: HTML_LINK,
                status: 'cancelled',
                start: { dateTime: '2026-11-16T12:00:00+07:00' },
                end: { dateTime: '2026-11-16T15:00:00+07:00' },
              },
              {
                id: 'ev-opaque',
                summary: 'Real Busy Meeting',
                htmlLink: HTML_LINK,
                transparency: 'opaque',
                status: 'confirmed',
                start: { dateTime: '2026-11-16T15:00:00+07:00' },
                end: { dateTime: '2026-11-16T16:00:00+07:00' },
              },
            ],
          });
        },
      });

      const freeOut = (await adapter.execute('mycalendar.find_free_slots', {
        calendarId: CAL_ID,
        timeMin: '2026-11-16T08:00:00+07:00',
        timeMax: '2026-11-16T18:00:00+07:00',
        durationMinutes: 180,
        workdayStartHour: 8,
        workdayEndHour: 18,
      })) as { freeSlots: Array<{ start: string; end: string }> };

      expect(freeOut.freeSlots.map((s) => ({ start: s.start, end: s.end }))).toEqual([
        { start: '2026-11-16T08:00:00+07:00', end: '2026-11-16T11:00:00+07:00' },
        { start: '2026-11-16T11:00:00+07:00', end: '2026-11-16T14:00:00+07:00' },
      ]);

      const listed = (await adapter.execute('mycalendar.list_events', {
        calendarId: CAL_ID,
        timeMin: '2026-11-16T08:00:00+07:00',
        timeMax: '2026-11-16T18:00:00+07:00',
        onlyConflicts: true,
      })) as { events: unknown[] };

      expect(listed.events).toEqual([]);
    });

    it('interprets opaque all-day events as half-open [startDate, endDate) in the calendar local timezone rather than UTC', async () => {
      // All-day event on 2026-11-16..2026-11-17 in Asia/Ho_Chi_Minh (+07:00):
      // Local 2026-11-16 00:00:00+07:00 to 2026-11-17 00:00:00+07:00.
      // Under UTC parsing bug, '2026-11-16' is 2026-11-16T00:00:00Z = 07:00+07:00, leaving 00:00..07:00+07:00 falsely free on 2026-11-16 and blocking 00:00..07:00+07:00 on 2026-11-17!
      const adapter = makePersonalAdapter({
        fetchFn: async (input) => {
          const url = new URL(typeof input === 'string' ? input : input.toString());
          if (!url.pathname.endsWith('/events')) {
            return jsonResponse({ id: CAL_ID, summary: 'Primary', timeZone: 'Asia/Ho_Chi_Minh' });
          }
          return jsonResponse({
            items: [
              {
                id: 'all-day-opaque',
                summary: 'Company Retreat Day',
                htmlLink: HTML_LINK,
                start: { date: '2026-11-16' },
                end: { date: '2026-11-17' },
              },
            ],
          });
        },
      });

      const freeOnNov16Early = (await adapter.execute('mycalendar.find_free_slots', {
        calendarId: CAL_ID,
        timeMin: '2026-11-16T00:00:00+07:00',
        timeMax: '2026-11-16T08:00:00+07:00',
        durationMinutes: 60,
        workdayStartHour: 0,
        workdayEndHour: 8,
      })) as { freeSlots: Array<{ start: string; end: string }> };

      expect(freeOnNov16Early.freeSlots).toEqual([]);

      // And on 2026-11-17 (exclusive endDate), 00:00..02:00+07:00 must be completely free!
      const freeOnNov17Early = (await adapter.execute('mycalendar.find_free_slots', {
        calendarId: CAL_ID,
        timeMin: '2026-11-17T00:00:00+07:00',
        timeMax: '2026-11-17T02:00:00+07:00',
        durationMinutes: 120,
        workdayStartHour: 0,
        workdayEndHour: 2,
      })) as { freeSlots: Array<{ start: string; end: string }> };

      expect(freeOnNov17Early.freeSlots.map((s) => ({ start: s.start, end: s.end }))).toEqual([
        { start: '2026-11-17T00:00:00+07:00', end: '2026-11-17T02:00:00+07:00' },
      ]);
    });
  });

  describe('CALENDAR-AUDIT-08: natural temporal query resolution and separation from content query q', () => {
    it('resolves "next week" / "tuần tới" to the next ISO Monday-to-Monday local week and strips temporal tokens from Google q', async () => {
      // Fixed clock: Wednesday 2026-11-11T03:00:00Z = 2026-11-11T10:00:00+07:00
      // Next ISO week in Asia/Ho_Chi_Minh is Monday 2026-11-16T00:00:00+07:00 .. Monday 2026-11-23T00:00:00+07:00
      const capturedUrls: URL[] = [];
      const adapter = makePersonalAdapter({
        now: () => new Date('2026-11-11T03:00:00.000Z'),
        fetchFn: async (input) => {
          const url = new URL(typeof input === 'string' ? input : input.toString());
          if (!url.pathname.endsWith('/events')) {
            return jsonResponse({ id: CAL_ID, summary: 'Primary', timeZone: 'Asia/Ho_Chi_Minh' });
          }
          capturedUrls.push(url);
          return jsonResponse({
            items: [
              {
                id: 'ev-sprint',
                summary: 'Sprint Planning',
                htmlLink: HTML_LINK,
                start: { dateTime: '2026-11-16T09:00:00+07:00' },
                end: { dateTime: '2026-11-16T10:00:00+07:00' },
              },
            ],
          });
        },
      });

      // Pure temporal query "next week": q must NOT be sent as "next week"
      await adapter.execute('mycalendar.list_events', {
        calendarId: CAL_ID,
        query: 'next week',
      });

      expect(capturedUrls[0]?.searchParams.get('timeMin')).toBe('2026-11-16T00:00:00+07:00');
      expect(capturedUrls[0]?.searchParams.get('timeMax')).toBe('2026-11-23T00:00:00+07:00');
      expect(capturedUrls[0]?.searchParams.get('q')).toBeNull();

      // Combined content + temporal query "sprint next week": q="sprint", window = next ISO week
      await adapter.execute('mycalendar.list_events', {
        calendarId: CAL_ID,
        query: 'sprint next week',
      });

      expect(capturedUrls[1]?.searchParams.get('timeMin')).toBe('2026-11-16T00:00:00+07:00');
      expect(capturedUrls[1]?.searchParams.get('timeMax')).toBe('2026-11-23T00:00:00+07:00');
      expect(capturedUrls[1]?.searchParams.get('q')).toBe('sprint');
    });

    it('resolves weekday ("Friday"), "month-end" / "cuối tháng", and uses the calendar IANA timezone instead of hardcoded +07:00', async () => {
      // Fixed clock: Wednesday 2026-11-11T03:00:00Z
      // In Asia/Ho_Chi_Minh: Friday is 2026-11-13, month-end is 2026-11-30
      const capturedUrls: URL[] = [];
      const adapter = makePersonalAdapter({
        now: () => new Date('2026-11-11T03:00:00.000Z'),
        fetchFn: async (input) => {
          const url = new URL(typeof input === 'string' ? input : input.toString());
          if (!url.pathname.endsWith('/events')) {
            if (decodeURIComponent(url.pathname).endsWith(NY_CAL_ID)) {
              return jsonResponse({ id: NY_CAL_ID, summary: 'NY', timeZone: 'America/New_York' });
            }
            return jsonResponse({ id: CAL_ID, summary: 'Primary', timeZone: 'Asia/Ho_Chi_Minh' });
          }
          capturedUrls.push(url);
          return jsonResponse({ items: [] });
        },
      });

      await adapter.execute('mycalendar.list_events', {
        calendarId: CAL_ID,
        query: 'Friday',
      });
      expect(capturedUrls[0]?.searchParams.get('timeMin')).toBe('2026-11-13T00:00:00+07:00');
      expect(capturedUrls[0]?.searchParams.get('timeMax')).toBe('2026-11-14T00:00:00+07:00');
      expect(capturedUrls[0]?.searchParams.get('q')).toBeNull();

      await adapter.execute('mycalendar.list_events', {
        calendarId: CAL_ID,
        query: 'month-end',
      });
      expect(capturedUrls[1]?.searchParams.get('timeMin')).toBe('2026-11-30T00:00:00+07:00');
      expect(capturedUrls[1]?.searchParams.get('timeMax')).toBe('2026-12-01T00:00:00+07:00');
      expect(capturedUrls[1]?.searchParams.get('q')).toBeNull();

      // At 2026-11-11T03:00:00Z, America/New_York (-05:00) is still Tuesday 2026-11-10T22:00:00-05:00!
      // So "today" in America/New_York is 2026-11-10, whereas in Asia/Ho_Chi_Minh it is 2026-11-11.
      await adapter.execute('mycalendar.list_events', {
        calendarId: NY_CAL_ID,
        query: 'today',
      });
      expect(capturedUrls[2]?.searchParams.get('timeMin')).toBe('2026-11-10T00:00:00-05:00');
      expect(capturedUrls[2]?.searchParams.get('timeMax')).toBe('2026-11-11T00:00:00-05:00');
      expect(capturedUrls[2]?.searchParams.get('q')).toBeNull();
    });

    it('fails safe with VALIDATION when query contains an ambiguous or unsupported temporal expression and timeMin/timeMax are omitted', async () => {
      const adapter = makePersonalAdapter({
        now: () => new Date('2026-11-11T03:00:00.000Z'),
        fetchFn: async () => jsonResponse({ items: [] }),
      });

      await expect(
        adapter.execute('mycalendar.list_events', {
          calendarId: CAL_ID,
          query: 'sometime soonish maybe',
        }),
      ).rejects.toMatchObject({
        category: 'VALIDATION',
      });

      const sharedAdapter = new CalendarAdapter({
        credentials: { clientEmail: 'calendar@unit.iam.gserviceaccount.com', privateKey },
        allowedScope: { calendars: [CAL_ID] },
        fetchFn: async (url) => {
          if (String(url) === 'https://oauth2.googleapis.com/token') {
            return jsonResponse({ access_token: 'fixture-secret-token', token_type: 'Bearer', expires_in: 3600 });
          }
          return jsonResponse({ items: [] });
        },
      });

      await expect(
        sharedAdapter.execute('calendar.list_events', {
          calendarId: CAL_ID,
          query: 'unrecognized date phrase',
        }),
      ).rejects.toMatchObject({
        category: 'VALIDATION',
      });
    });
  });
});
