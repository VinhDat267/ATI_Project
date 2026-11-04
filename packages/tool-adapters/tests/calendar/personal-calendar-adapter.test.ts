import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PersonalCalendarAdapter,
  createPersonalCalendarAdapter,
  type PersonalCalendarAdapterConfig,
} from '../../src/calendar/personal-calendar-adapter.js';
import { StepError, GlobalRateLimiter } from '../../src/index.js';
import type { GmailAccessTokenProvider } from '../../src/gmail/token-provider.js';

const userId = 'usr_fixture_personal';
const calendarId = 'primary@example.com';
const start = '2026-10-27T10:00:00+07:00';
const end = '2026-10-27T11:00:00+07:00';
const createArgs = { calendarId, summary: 'Review Meeting', start, end };
const fixtureEvent = {
  id: 'evt_fixture_personal_1',
  summary: 'Review Meeting',
  htmlLink: 'https://www.google.com/calendar/event?eid=personal_1',
  start: { dateTime: start },
  end: { dateTime: end },
};

const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

function setup(options?: {
  handler?: (url: URL, init: RequestInit) => Response | Promise<Response>;
  allowedScope?: any;
  token?: string;
  tokenError?: Error;
  onTokenCall?: (opts?: { signal?: AbortSignal; forceRefresh?: boolean }) => void;
  apiBaseUrl?: string;
}) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const tokenCalls: Array<{ signal?: AbortSignal; forceRefresh?: boolean }> = [];

  const fetchFn = vi.fn(async (input: any, init: any) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (options?.handler) return options.handler(url, init);
    return json(fixtureEvent);
  }) as unknown as typeof fetch;

  const tokens: GmailAccessTokenProvider = {
    getAccessToken: vi.fn(async (opts) => {
      tokenCalls.push(opts ?? {});
      options?.onTokenCall?.(opts);
      if (options?.tokenError) throw options.tokenError;
      return options?.token ?? 'mock-user-token';
    }),
  };

  const adapter = createPersonalCalendarAdapter({
    userId,
    tokens,
    allowedScope: options?.allowedScope ?? { calendars: [calendarId] },
    fetchFn,
    apiBaseUrl: options?.apiBaseUrl,
    rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 60_000 }),
  });

  return { adapter, tokens, fetchFn, calls, tokenCalls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PersonalCalendarAdapter', () => {
  it('has service name mycalendar and passes checkConnection', async () => {
    const { adapter, calls } = setup({
      handler: () => json({ id: calendarId, summary: 'Personal Calendar', timeZone: 'Asia/Ho_Chi_Minh' }),
    });
    expect(adapter.service).toBe('mycalendar');
    expect(await adapter.checkConnection()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer mock-user-token' });
  });

  it('mycalendar.list_calendars returns only allowlisted calendars matching query with id, title, timeZone', async () => {
    const secondCal = 'secondary@example.com';
    const { adapter, calls } = setup({
      allowedScope: { calendars: [calendarId, secondCal] },
      handler: (url) => {
        if (url.pathname.includes(encodeURIComponent(calendarId))) {
          return json({ id: calendarId, summary: 'Main Schedule', timeZone: 'Asia/Ho_Chi_Minh' });
        }
        return json({ id: secondCal, summary: 'Side Projects', timeZone: 'UTC' });
      },
    });

    const all = await adapter.execute('mycalendar.list_calendars', { query: '', limit: 10 });
    expect(all).toEqual([
      { id: calendarId, title: 'Main Schedule', timeZone: 'Asia/Ho_Chi_Minh' },
      { id: secondCal, title: 'Side Projects', timeZone: 'UTC' },
    ]);
    expect(calls).toHaveLength(2);

    const filtered = await adapter.execute('mycalendar.list_calendars', { query: 'side', limit: 10 });
    expect(filtered).toEqual([
      { id: secondCal, title: 'Side Projects', timeZone: 'UTC' },
    ]);
  });

  it('rejects calendarId not in allowedScope.calendars (AUTH_ERROR, 403, details.requestSent === false on write)', async () => {
    const { adapter, fetchFn } = setup({ allowedScope: { calendars: [calendarId] } });
    const outsideId = 'outside@example.com';

    // Read rejection: AUTH_ERROR 403
    await expect(
      adapter.execute('mycalendar.list_events', {
        calendarId: outsideId,
        timeMin: start,
        timeMax: end,
      })
    ).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });
    expect(fetchFn).not.toHaveBeenCalled();

    // Write rejection: AUTH_ERROR 403 with details.requestSent === false
    try {
      await adapter.execute('mycalendar.create_event', { ...createArgs, calendarId: outsideId });
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('AUTH_ERROR');
      expect(err.statusCode).toBe(403);
      expect(err.details).toEqual({ requestSent: false });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([{}, { calendars: [] }, { calendars: ['not-an-email/invalid'] }])(
    'rejects empty or invalid scope on write with details.requestSent === false: %j',
    async (scope) => {
      const { adapter, fetchFn } = setup({ allowedScope: scope });
      try {
        await adapter.execute('mycalendar.create_event', createArgs);
        expect.fail('must reject');
      } catch (err: any) {
        expect(err).toBeInstanceOf(StepError);
        expect(err.category).toBe('AUTH_ERROR');
        expect(err.statusCode).toBe(403);
        expect(err.details).toEqual({ requestSent: false });
      }
      expect(fetchFn).not.toHaveBeenCalled();
    }
  );

  it('mycalendar.create_event sends POST .../calendars/<id>/events?sendUpdates=none without attendees and escapes HTML in description', async () => {
    const { adapter, calls } = setup();
    const result = await adapter.execute('mycalendar.create_event', {
      ...createArgs,
      description: 'Discuss <b>Q4 Goals</b> & plans',
      location: 'Meeting Room 2',
    });

    expect(result).toEqual({
      id: fixtureEvent.id,
      title: 'Review Meeting',
      start,
      end,
      url: fixtureEvent.htmlLink,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url.pathname).toContain(`/calendars/${encodeURIComponent(calendarId)}/events`);
    expect(calls[0]!.url.searchParams.get('sendUpdates')).toBe('none');

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.summary).toBe('Review Meeting');
    expect(body.description).toBe('Discuss &lt;b&gt;Q4 Goals&lt;/b&gt; &amp; plans');
    expect(body.location).toBe('Meeting Room 2');
    expect(body.attendees).toBeUndefined();
  });

  it('rejects attendees in create_event input before dispatch with details.requestSent === false', async () => {
    const { adapter, fetchFn } = setup();
    try {
      await adapter.execute('mycalendar.create_event', {
        ...createArgs,
        attendees: [{ email: 'partner@example.com' }],
      });
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('VALIDATION');
      expect(err.details).toEqual({ requestSent: false });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('on HTTP 401, calls tokens.getAccessToken({ signal, forceRefresh: true }) once and retries', async () => {
    let attempt = 0;
    const { adapter, calls, tokenCalls } = setup({
      handler: () => {
        if (attempt++ === 0) return new Response('Unauthorized', { status: 401 });
        return json(fixtureEvent);
      },
    });

    const result = await adapter.execute('mycalendar.create_event', createArgs);
    expect(result.id).toBe(fixtureEvent.id);
    expect(calls).toHaveLength(2);
    expect(tokenCalls).toHaveLength(2);
    expect(tokenCalls[0]).toEqual({ signal: undefined });
    expect(tokenCalls[1]).toMatchObject({ forceRefresh: true });
  });

  it('when second 401 occurs after retry, throws AUTH_ERROR 401 with details.requestSent === false', async () => {
    const { adapter, calls, tokenCalls } = setup({
      handler: () => new Response('Unauthorized', { status: 401 }),
    });

    try {
      await adapter.execute('mycalendar.create_event', createArgs);
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('AUTH_ERROR');
      expect(err.statusCode).toBe(401);
      expect(err.details).toEqual({ requestSent: false });
    }
    expect(calls).toHaveLength(2);
    expect(tokenCalls).toHaveLength(2);
    expect(tokenCalls[1]).toMatchObject({ forceRefresh: true });
  });

  it('when tokens.getAccessToken fails before create_event dispatches HTTP, throws StepError with details.requestSent === false', async () => {
    const tokenError = new StepError({
      message: 'Token expired and refresh token revoked',
      category: 'AUTH_ERROR',
      statusCode: 401,
    });
    const { adapter, fetchFn } = setup({ tokenError });

    try {
      await adapter.execute('mycalendar.create_event', createArgs);
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('AUTH_ERROR');
      expect(err.statusCode).toBe(401);
      expect(err.details).toEqual({ requestSent: false });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('when tokens.getAccessToken fails during 401 refresh on create_event, throws StepError with details.requestSent === false', async () => {
    let tokenAttempt = 0;
    const { adapter, calls } = setup({
      handler: () => new Response('Unauthorized', { status: 401 }),
      onTokenCall: () => {
        if (tokenAttempt++ === 1) {
          throw new StepError({
            message: 'Refresh failed on network',
            category: 'NETWORK',
          });
        }
      },
    });

    try {
      await adapter.execute('mycalendar.create_event', createArgs);
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('NETWORK');
      expect(err.details).toEqual({ requestSent: false });
    }
    expect(calls).toHaveLength(1); // 1st HTTP call returned 401, refresh failed before 2nd call
  });

  it('when fetchFn rejects after create_event is sent, throws StepError with category UNKNOWN and never retries', async () => {
    const { adapter, calls } = setup({
      handler: () => {
        throw new Error('Connection reset by peer');
      },
    });

    try {
      await adapter.execute('mycalendar.create_event', createArgs);
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('UNKNOWN');
      expect(err.retryable).toBe(false);
      expect(err.details?.requestSent).toBeUndefined();
    }
    expect(calls).toHaveLength(1);
  });

  it('when fetchFn returns 503 after create_event is sent, throws StepError with category UNKNOWN and never retries', async () => {
    const { adapter, calls } = setup({
      handler: () => new Response('Backend unavailable', { status: 503 }),
    });

    try {
      await adapter.execute('mycalendar.create_event', createArgs);
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('UNKNOWN');
      expect(err.statusCode).toBe(503);
      expect(err.retryable).toBe(false);
      expect(err.details?.requestSent).toBeUndefined();
    }
    expect(calls).toHaveLength(1);
  });

  it('real AbortSignal cancellation before dispatch throws StepError with details.requestSent === false', async () => {
    const controller = new AbortController();
    controller.abort();
    const { adapter, fetchFn } = setup();

    try {
      await adapter.execute('mycalendar.create_event', createArgs, { signal: controller.signal });
      expect.fail('must reject');
    } catch (err: any) {
      expect(err).toBeInstanceOf(StepError);
      expect(err.category).toBe('NETWORK');
      expect(err.details).toEqual({ requestSent: false });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('real AbortSignal cancellation during fetch on create_event throws UNKNOWN and never retries', async () => {
    const controller = new AbortController();
    let dispatched!: () => void;
    const reached = new Promise<void>((resolve) => {
      dispatched = resolve;
    });

    const { adapter, calls } = setup({
      handler: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('AbortError: request was aborted')), {
            once: true,
          });
          dispatched();
        }),
    });

    const promise = adapter.execute('mycalendar.create_event', createArgs, { signal: controller.signal });
    const assertion = expect(promise).rejects.toMatchObject({ category: 'UNKNOWN', retryable: false });
    await reached;
    controller.abort();
    await assertion;
    expect(calls).toHaveLength(1);
  });

  it('mycalendar.list_events lists bounded events and follows pagination', async () => {
    const event2 = { ...fixtureEvent, id: 'evt_2', summary: 'Second Event' };
    const { adapter, calls } = setup({
      handler: (url) => {
        if (url.searchParams.get('pageToken') === 'next_page_1') {
          return json({ items: [event2] });
        }
        return json({ items: [fixtureEvent], nextPageToken: 'next_page_1' });
      },
    });

    const result = await adapter.execute('mycalendar.list_events', {
      calendarId,
      timeMin: start,
      timeMax: end,
      limit: 10,
    });

    expect(result.events).toHaveLength(2);
    expect(result.events[0].id).toBe(fixtureEvent.id);
    expect(result.events[1].id).toBe('evt_2');
    expect(calls).toHaveLength(2);
  });

  it('mycalendar.list_events strips natural filter tokens (today, upcoming, open, busy, *) from Google API q parameter', async () => {
    for (const naturalQuery of ['today', 'hôm nay', 'upcoming', 'sắp tới', 'open', 'busy', 'bận', '*', 'all']) {
      const { adapter, calls } = setup({
        handler: () => json({ items: [fixtureEvent] }),
      });
      const result = await adapter.execute('mycalendar.list_events', {
        calendarId,
        timeMin: start,
        timeMax: end,
        query: naturalQuery,
      });
      expect(result.events).toHaveLength(1);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url.searchParams.has('q')).toBe(false);
    }
  });

  it('mycalendar.list_events detects overlapping events and filters only conflicting events when query asks for conflict/trùng lịch', async () => {
    const evtMorningA = {
      id: 'evt_a',
      summary: 'Sprint Planning',
      htmlLink: 'https://calendar.google.com/event?eid=a',
      start: { dateTime: '2026-10-09T09:00:00+07:00' },
      end: { dateTime: '2026-10-09T10:00:00+07:00' },
    };
    const evtMorningB = {
      id: 'evt_b',
      summary: 'Client Sync',
      htmlLink: 'https://calendar.google.com/event?eid=b',
      start: { dateTime: '2026-10-09T09:30:00+07:00' },
      end: { dateTime: '2026-10-09T10:30:00+07:00' },
    };
    const evtAfternoon = {
      id: 'evt_c',
      summary: '1:1 Check-in',
      htmlLink: 'https://calendar.google.com/event?eid=c',
      start: { dateTime: '2026-10-09T14:00:00+07:00' },
      end: { dateTime: '2026-10-09T15:00:00+07:00' },
    };

    const { adapter, calls } = setup({
      handler: () => json({ items: [evtMorningA, evtMorningB, evtAfternoon] }),
    });

    const conflictOnly = await adapter.execute('mycalendar.list_events', {
      calendarId,
      timeMin: '2026-10-09T00:00:00+07:00',
      timeMax: '2026-10-09T23:59:59+07:00',
      query: 'trùng lịch',
    });

    expect(calls[0]!.url.searchParams.has('q')).toBe(false);
    expect(conflictOnly.events).toEqual([
      {
        id: 'evt_a',
        title: 'Sprint Planning',
        start: '2026-10-09T09:00:00+07:00',
        end: '2026-10-09T10:00:00+07:00',
        url: 'https://calendar.google.com/event?eid=a',
        conflict: true,
        conflictsWith: ['Client Sync'],
      },
      {
        id: 'evt_b',
        title: 'Client Sync',
        start: '2026-10-09T09:30:00+07:00',
        end: '2026-10-09T10:30:00+07:00',
        url: 'https://calendar.google.com/event?eid=b',
        conflict: true,
        conflictsWith: ['Sprint Planning'],
      },
    ]);
  });

  it('findConflicts returns overlapping events for a candidate [start, end] slot and ignores touching boundary events', async () => {
    const evtBefore = {
      id: 'evt_before',
      summary: 'Standup',
      htmlLink: 'https://calendar.google.com/event?eid=before',
      start: { dateTime: '2026-10-09T08:30:00+07:00' },
      end: { dateTime: '2026-10-09T09:00:00+07:00' },
    };
    const evtOverlap = {
      id: 'evt_overlap',
      summary: 'Architecture Review',
      htmlLink: 'https://calendar.google.com/event?eid=overlap',
      start: { dateTime: '2026-10-09T09:30:00+07:00' },
      end: { dateTime: '2026-10-09T10:30:00+07:00' },
    };

    const { adapter } = setup({
      handler: () => json({ items: [evtBefore, evtOverlap] }),
    });

    const conflicts = await adapter.findConflicts({
      calendarId,
      start: '2026-10-09T09:00:00+07:00',
      end: '2026-10-09T10:00:00+07:00',
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      id: 'evt_overlap',
      title: 'Architecture Review',
      start: '2026-10-09T09:30:00+07:00',
      end: '2026-10-09T10:30:00+07:00',
    });
  });

  it('enriches normalized events with meetLink (hangoutLink or conferenceData), location, and attendeesCount', async () => {
    const richEvent = {
      id: 'evt_rich_1',
      summary: 'Q4 Executive Sync',
      htmlLink: 'https://www.google.com/calendar/event?eid=rich_1',
      start: { dateTime: start },
      end: { dateTime: end },
      location: 'Phòng họp Tầng 5',
      hangoutLink: 'https://meet.google.com/xyz-abcd-efg',
      attendees: [{ email: 'ceo@example.com' }, { email: 'pm@example.com' }, { email: 'lead@example.com' }],
    };

    const { adapter } = setup({
      handler: () => json({ items: [richEvent] }),
    });

    const listed = await adapter.execute('mycalendar.list_events', {
      calendarId,
      timeMin: start,
      timeMax: end,
    });

    expect(listed.events).toEqual([
      {
        id: 'evt_rich_1',
        title: 'Q4 Executive Sync',
        start,
        end,
        url: 'https://www.google.com/calendar/event?eid=rich_1',
        location: 'Phòng họp Tầng 5',
        meetLink: 'https://meet.google.com/xyz-abcd-efg',
        attendeesCount: 3,
        attendees: ['ceo@example.com', 'pm@example.com', 'lead@example.com'],
      },
    ]);
  });

  it('allows mycalendar.list_events with only natural language query (without explicit timeMin/timeMax)', async () => {
    const { adapter, calls } = setup({
      handler: () => json({ items: [fixtureEvent] }),
    });

    const listed = await adapter.execute('mycalendar.list_events', {
      calendarId,
      query: 'hôm nay',
    });

    expect(listed.events).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get('timeMin')).toMatch(/T00:00:00/);
    expect(calls[0]!.url.searchParams.get('timeMax')).toMatch(/T23:59:59/);
  });

  it('supports createMeetLink: true in mycalendar.create_event (conferenceDataVersion=1) and returns meetLink', async () => {
    const { adapter, calls } = setup({
      handler: () =>
        json({
          ...fixtureEvent,
          conferenceData: {
            entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/new-meet-room' }],
          },
        }),
    });

    const created = await adapter.execute('mycalendar.create_event', {
      ...createArgs,
      createMeetLink: true,
    });

    expect(created).toEqual({
      id: fixtureEvent.id,
      title: 'Review Meeting',
      start,
      end,
      url: fixtureEvent.htmlLink,
      meetLink: 'https://meet.google.com/new-meet-room',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get('sendUpdates')).toBe('none');
    expect(calls[0]!.url.searchParams.get('conferenceDataVersion')).toBe('1');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.conferenceData?.createRequest?.conferenceSolutionKey?.type).toBe('hangoutsMeet');
  });

  it('supports mycalendar.update_event to reschedule or update details and mycalendar.delete_event to cancel an event', async () => {
    const newStart = '2026-10-28T14:00:00+07:00';
    const newEnd = '2026-10-28T15:00:00+07:00';
    const { adapter, calls } = setup({
      handler: (_url, init) => {
        if (init.method === 'PATCH') {
          return json({
            ...fixtureEvent,
            summary: 'Rescheduled Review',
            start: { dateTime: newStart },
            end: { dateTime: newEnd },
          });
        }
        if (init.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return json(fixtureEvent);
      },
    });

    const updated = await adapter.execute('mycalendar.update_event', {
      calendarId,
      eventId: 'evt_fixture_personal_1',
      summary: 'Rescheduled Review',
      start: newStart,
      end: newEnd,
    });

    expect(updated).toEqual({
      id: 'evt_fixture_personal_1',
      title: 'Rescheduled Review',
      start: newStart,
      end: newEnd,
      url: fixtureEvent.htmlLink,
    });
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(calls[0]!.url.pathname).toContain(`/calendars/${encodeURIComponent(calendarId)}/events/evt_fixture_personal_1`);
    expect(calls[0]!.url.searchParams.get('sendUpdates')).toBe('none');

    const deleted = await adapter.execute('mycalendar.delete_event', {
      calendarId,
      eventId: 'evt_fixture_personal_1',
    });
    expect(deleted).toEqual({ id: 'evt_fixture_personal_1', deleted: true });
    expect(calls[1]!.init.method).toBe('DELETE');
    expect(calls[1]!.url.pathname).toContain(`/calendars/${encodeURIComponent(calendarId)}/events/evt_fixture_personal_1`);
    expect(calls[1]!.url.searchParams.get('sendUpdates')).toBe('none');
  });

  it('supports recurrence (WEEKDAYS, DAILY, WEEKLY, MONTHLY, or RRULE:...) in create_event and update_event and rejects invalid recurrence', async () => {
    const { adapter, calls } = setup({
      handler: (_url, init) => {
        const parsed = JSON.parse(String(init.body));
        return json({
          ...fixtureEvent,
          recurrence: parsed.recurrence,
        });
      },
    });

    const created = await adapter.execute('mycalendar.create_event', {
      ...createArgs,
      recurrence: 'WEEKDAYS',
    });

    expect(created.recurrence).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    const createBody = JSON.parse(String(calls[0]!.init.body));
    expect(createBody.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR']);

    const updated = await adapter.execute('mycalendar.update_event', {
      calendarId,
      eventId: 'evt_fixture_personal_1',
      recurrence: 'RRULE:FREQ=WEEKLY;COUNT=8',
    });
    expect(updated.recurrence).toBe('RRULE:FREQ=WEEKLY;COUNT=8');

    await expect(
      adapter.execute('mycalendar.create_event', {
        ...createArgs,
        recurrence: 'EVERY_BLUE_MOON;DROP TABLE',
      }),
    ).rejects.toMatchObject({ category: 'VALIDATION' });
  });

  it('supports mycalendar.get_event to fetch full event details including description (agenda), meetLink, location, and recurrence', async () => {
    const { adapter, calls } = setup({
      handler: () =>
        json({
          ...fixtureEvent,
          summary: 'Sprint Retrospective',
          description: 'Agenda:\n1. What went well\n2. Action items for Q4',
          location: 'Phòng họp VIP 1',
          hangoutLink: 'https://meet.google.com/ret-ro-123',
          attendees: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
          recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=2'],
        }),
    });

    const detail = await adapter.execute('mycalendar.get_event', {
      calendarId,
      eventId: 'evt_fixture_personal_1',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.url.pathname).toContain(`/calendars/${encodeURIComponent(calendarId)}/events/evt_fixture_personal_1`);
    expect(detail).toEqual({
      id: 'evt_fixture_personal_1',
      title: 'Sprint Retrospective',
      description: 'Agenda:\n1. What went well\n2. Action items for Q4',
      start,
      end,
      url: fixtureEvent.htmlLink,
      location: 'Phòng họp VIP 1',
      meetLink: 'https://meet.google.com/ret-ro-123',
      attendeesCount: 2,
      attendees: ['a@example.com', 'b@example.com'],
      recurrence: 'RRULE:FREQ=WEEKLY;INTERVAL=2',
    });
  });

  it('supports mycalendar.schedule_meet with conferenceDataVersion=1, attendees array, and sendInvites=true', async () => {
    const { adapter, calls } = setup({
      handler: (_url, init) => {
        const parsed = JSON.parse(String(init.body));
        return json({
          ...fixtureEvent,
          summary: parsed.summary,
          description: parsed.description,
          attendees: parsed.attendees,
          conferenceData: {
            entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/pro-meet-789' }],
          },
        });
      },
    });

    const meet = await adapter.execute('mycalendar.schedule_meet', {
      calendarId,
      summary: 'Q4 Kickoff Google Meet',
      start,
      end,
      description: 'Agenda: Q4 OKRs & Roadmap',
      attendees: ['alice@example.com', 'bob@example.com'],
      sendInvites: true,
    });

    expect(meet).toEqual({
      id: fixtureEvent.id,
      title: 'Q4 Kickoff Google Meet',
      start,
      end,
      url: fixtureEvent.htmlLink,
      meetLink: 'https://meet.google.com/pro-meet-789',
      attendeesCount: 2,
      attendees: ['alice@example.com', 'bob@example.com'],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get('conferenceDataVersion')).toBe('1');
    expect(calls[0]!.url.searchParams.get('sendUpdates')).toBe('all');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.attendees).toEqual([{ email: 'alice@example.com' }, { email: 'bob@example.com' }]);
    expect(body.conferenceData?.createRequest?.conferenceSolutionKey?.type).toBe('hangoutsMeet');
  });

  it('supports mycalendar.find_free_slots to proactively compute available slots within workday hours', async () => {
    const busy1 = {
      id: 'busy_1',
      summary: 'Morning Standup',
      htmlLink: 'https://calendar.google.com/event?eid=b1',
      start: { dateTime: '2026-10-09T08:00:00+07:00' },
      end: { dateTime: '2026-10-09T09:30:00+07:00' },
    };
    const busy2 = {
      id: 'busy_2',
      summary: 'Client Demo',
      htmlLink: 'https://calendar.google.com/event?eid=b2',
      start: { dateTime: '2026-10-09T10:30:00+07:00' },
      end: { dateTime: '2026-10-09T12:00:00+07:00' },
    };

    const { adapter } = setup({
      handler: () => json({ items: [busy1, busy2] }),
    });

    const result = await adapter.execute('mycalendar.find_free_slots', {
      calendarId,
      timeMin: '2026-10-09T08:00:00+07:00',
      timeMax: '2026-10-09T18:00:00+07:00',
      durationMinutes: 60,
      workdayStartHour: 8,
      workdayEndHour: 18,
      limit: 3,
    });

    expect(result.calendarId).toBe(calendarId);
    expect(result.busyCount).toBe(2);
    expect(result.freeSlots).toHaveLength(3);
    expect(result.freeSlots[0]).toMatchObject({
      start: '2026-10-09T09:30:00+07:00',
      end: '2026-10-09T10:30:00+07:00',
      durationMinutes: 60,
      label: '09:30–10:30',
    });
    expect(result.freeSlots[1]).toMatchObject({
      start: '2026-10-09T12:00:00+07:00',
      end: '2026-10-09T13:00:00+07:00',
      durationMinutes: 60,
      label: '12:00–13:00',
    });
  });
});
