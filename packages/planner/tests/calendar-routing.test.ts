import { expect, it } from 'vitest';
import { ALL_TOOLS, MYCALENDAR_SERVICE, MYCALENDAR_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import { classifyIntent, routeIntent } from '../src/router.js';
import { recordObserved } from '../src/search.js';
import { buildSystemPrompt } from '../src/prompts/system-prompt.js';

it.each([
  ['Đặt lịch họp review lúc 15h thứ Sáu và báo kênh ati-test', ['slack', 'calendar']],
  ['Schedule a Google Calendar meeting with the frontend team tomorrow at 3pm', ['calendar']],
  ['Xem lịch sử commit của repo ati-test', ['github']],
  ['Tạo event trong calendar', ['calendar']],
])('routes %s with every registered service', (prompt, services) => expect(classifyIntent(prompt, ALL_TOOLS)).toEqual(services));
it('preserves Slack meeting content when Calendar is not configured and refuses explicit unavailable Calendar', () => {
  const without = ALL_TOOLS.filter(t => t.service !== 'calendar');
  expect(classifyIntent('Báo lên Slack là cuộc họp dời sang 3 giờ', without)).toEqual(['slack']);
  expect(classifyIntent('Schedule a Google Calendar meeting with the frontend team tomorrow at 3pm', without)).toEqual([]);
});
it('routes natural calendar and meeting prompts to mycalendar when personal OAuth is connected and shared Service Account is not configured', () => {
  const personalCatalog = [...ALL_TOOLS.filter(t => t.service !== 'calendar'), ...MYCALENDAR_TOOLS];
  const registryWithMyCal = [...SERVICE_REGISTRY, MYCALENDAR_SERVICE];

  expect(classifyIntent('Đặt lịch họp review lúc 15h thứ Sáu và báo kênh ati-test', personalCatalog, registryWithMyCal)).toEqual(['slack', 'mycalendar']);
  expect(classifyIntent('Tạo cuộc họp với khách hàng lúc 14h ngày mai', personalCatalog, registryWithMyCal)).toEqual(['mycalendar']);
  expect(classifyIntent('Schedule a Google Calendar meeting tomorrow at 3pm', personalCatalog, registryWithMyCal)).toEqual(['mycalendar']);

  const explicitShared = routeIntent('Tạo sự kiện trên lịch chung của nhóm lúc 10h mai', personalCatalog, registryWithMyCal);
  expect(explicitShared.services).toEqual([]);
  expect(explicitShared.unavailable).toEqual([{ id: 'calendar', name: 'Google Calendar' }]);
});

it('preserves start, end, meetLink, location, recurrence, calendarId, and description in WorkingMemory __observed.myevent across search rounds', () => {
  const listEventsTool = MYCALENDAR_TOOLS.find(t => t.name === 'mycalendar.list_events')!;
  const firstObserved = recordObserved(
    undefined,
    'myevent',
    [
      {
        id: 'evt_sprint_1',
        title: 'Sprint Planning',
        start: '2026-11-03T09:00:00+07:00',
        end: '2026-11-03T10:00:00+07:00',
        url: 'https://calendar.google.com/event?eid=sp1',
        meetLink: 'https://meet.google.com/spr-int-111',
        location: 'Phòng 401',
        recurrence: 'RRULE:FREQ=WEEKLY',
        calendarId: 'user@gmail.com',
      },
    ],
    listEventsTool.observedFields,
  );

  // Second round merges without dropping fields of previously observed events
  const secondObserved = recordObserved(
    firstObserved,
    'myevent',
    [
      {
        id: 'evt_retro_2',
        title: 'Sprint Retro',
        start: '2026-11-03T15:00:00+07:00',
        end: '2026-11-03T16:00:00+07:00',
        url: 'https://calendar.google.com/event?eid=rt2',
        calendarId: 'user@gmail.com',
      },
    ],
    listEventsTool.observedFields,
  );

  expect(secondObserved.myevent).toHaveLength(2);
  expect(secondObserved.myevent![0]).toMatchObject({
    id: 'evt_sprint_1',
    title: 'Sprint Planning',
    start: '2026-11-03T09:00:00+07:00',
    end: '2026-11-03T10:00:00+07:00',
    meetLink: 'https://meet.google.com/spr-int-111',
    location: 'Phòng 401',
    recurrence: 'RRULE:FREQ=WEEKLY',
    calendarId: 'user@gmail.com',
  });
});

it('includes Personal Google Calendar (mycalendar) Rules in buildSystemPrompt when mycalendar tools are active', () => {
  const prompt = buildSystemPrompt(MYCALENDAR_TOOLS, undefined, { search: true });
  expect(prompt).toContain('### Personal Google Calendar (mycalendar) Rules:');
  expect(prompt).toContain('createMeetLink: true');
  expect(prompt).toContain('recurrence');
  expect(prompt).toContain('mycalendar.find_free_slots');
  expect(prompt).toContain('meetLink');
});
