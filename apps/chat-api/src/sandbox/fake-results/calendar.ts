import type { FakeService } from './types.js';

const id = 'ati@group.calendar.google.com';
export const CALENDAR_FAKE: FakeService = {
  id: 'calendar', tools: {
    'calendar.list_calendars': () => [{ id, title: 'ATI Review', timeZone: 'Asia/Ho_Chi_Minh' }],
    'calendar.list_events': () => ({ events: [{ id: 'event_fixture', title: 'ATI Review', start: '2026-10-09T15:00:00+07:00', end: '2026-10-09T16:00:00+07:00', url: 'https://www.google.com/calendar/event?eid=fixture' }] }),
    'calendar.create_event': args => ({ id: 'event_sandbox', title: args.summary, start: args.start, end: args.end, url: 'https://www.google.com/calendar/event?eid=sandbox' }),
  },
};
