import type { FakeService } from './types.js';

export const MYCALENDAR_FAKE: FakeService = {
  id: 'mycalendar',
  tools: {
    'mycalendar.list_calendars': () => [
      { id: 'primary', title: 'Lịch cá nhân', timeZone: 'Asia/Ho_Chi_Minh' },
    ],
    'mycalendar.list_events': () => ({
      events: [
        {
          id: 'event_mycal_fixture',
          title: 'Họp cá nhân',
          start: '2026-10-27T15:00:00+07:00',
          end: '2026-10-27T16:00:00+07:00',
          url: 'https://www.google.com/calendar/event?eid=mycal_fixture',
        },
      ],
    }),
    'mycalendar.create_event': (args) => ({
      id: 'event_mycal_sandbox',
      title: args.summary,
      start: args.start,
      end: args.end,
      url: 'https://www.google.com/calendar/event?eid=mycal_sandbox',
    }),
  },
};
