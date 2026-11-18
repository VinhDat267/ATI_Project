import { expect, it } from 'vitest';
import { ALL_TOOLS, GMAIL_TOOLS, MYCALENDAR_SERVICE, MYCALENDAR_TOOLS, MYJIRA_TOOLS, MYSHEETS_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import { classifyIntent, routeIntent } from '../src/router.js';
import { recordObserved, type WorkingMemory } from '../src/search.js';
import { extractWorkspaceRecipients } from '../src/recipients.js';
import { buildSystemPrompt } from '../src/prompts/system-prompt.js';
import { validatePlan } from '../src/validator.js';

it.each([
  ['Đặt lịch họp review lúc 15h thứ Sáu và báo kênh ati-test', ['slack', 'calendar']],
  ['Schedule a Google Calendar meeting with the frontend team tomorrow at 3pm', ['calendar']],
  ['Xem lịch sử commit của repo ati-test', ['github']],
  ['Mời @alice review PR #17 rồi báo Slack', ['slack', 'github']],
  ['Ghi doanh thu của branch Hà Nội vào Google Sheets', ['sheets']],
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
  expect(prompt).toContain('mycalendar.list_event_instances');
  expect(prompt).toContain('mycalendar.rsvp_event');
  expect(prompt).toContain('use `sendInvites: true` only when the user agrees to notify all guests');
  expect(prompt).toContain('If the user asks to notify only the organizer, ask whether to update without notifications or notify all guests');
  expect(prompt).toContain('post-meeting');
  expect(prompt).toContain('pre-meeting');
  expect(prompt).toContain('meetLink');
  expect(prompt).toContain('preserve existing');
  const withSchedules = buildSystemPrompt(MYCALENDAR_TOOLS, undefined, { search: true, schedules: true });
  expect(withSchedules).toContain('mycalendar.create_event');
});

it.each([
  ['slack.send_message', { channel: 'C123' }, { $template: 'Tóm tắt: ${read.output.title}' }],
  ['telegram.send_message', { chatId: '-12345' }, { $ref: 'read.output.title' }],
] as const)('requires a concrete personal Calendar recap before approving %s', (tool, destination, rawText) => {
  const catalog = [...ALL_TOOLS, ...MYCALENDAR_TOOLS];
  const read = {
    id: 'read', tool: 'mycalendar.get_event', description: 'Đọc sự kiện', dependsOn: [],
    args: { calendarId: 'owner@example.test', eventId: 'event_123' },
  };
  const send = {
    id: 'send', tool, description: 'Gửi tóm tắt', dependsOn: ['read'],
    args: { ...destination, text: rawText },
  };
  const plan = { kind: 'plan', thinking: 'Đọc và gửi tóm tắt', summary: 'Tóm tắt lịch', warnings: [] };
  expect(validatePlan(JSON.stringify({ ...plan, steps: [read, send] }), catalog)).toMatchObject({
    valid: false, layer: 'semantic', error: expect.stringContaining('Calendar recap'),
  });
  expect(validatePlan(JSON.stringify({
    ...plan, steps: [{ ...send, dependsOn: [], args: { ...destination, text: 'Họp nhóm lúc 09:00.' } }],
  }), catalog).valid).toBe(true);
  const create = {
    ...read, tool: 'mycalendar.create_event',
    args: { calendarId: 'owner@example.test', summary: 'Họp nhóm', start: '2026-11-19T09:00:00+07:00', end: '2026-11-19T10:00:00+07:00' },
  };
  expect(validatePlan(JSON.stringify({
    ...plan, steps: [create, { ...send, args: { ...destination, text: { $template: 'Sự kiện mới: ${read.output.url}' } } }],
  }), catalog).valid).toBe(true);
});

it('grounds post-meeting follow-up email recipients from observed mycalendar.get_event attendees and blocks ungrounded addresses', () => {
  const eventDetail = {
    id: 'evt_design_review',
    title: 'Design Review Q4',
    start: '2026-11-18T15:00:00+07:00',
    end: '2026-11-18T16:00:00+07:00',
    url: 'https://calendar.google.com/event?eid=designq4',
    attendees: ['alice@acme.test', 'bob@acme.test'],
    calendarId: 'owner@acme.test',
  };
  let memory: WorkingMemory = {};
  memory = recordObserved(memory, 'mycalendar', [{ id: 'owner@acme.test', title: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh' }], ['id', 'title', 'timeZone']);
  memory = recordObserved(memory, 'myevent', [eventDetail], ['id', 'title', 'start', 'end', 'url', 'attendees', 'calendarId']);
  memory = recordObserved(
    memory,
    'jira_site',
    [{ id: 'site-1', siteId: 'site-1', cloudId: 'cloud-1', workspaceId: 'ws-1', name: 'ATI Cloud' }],
    ['id', 'siteId', 'cloudId', 'workspaceId', 'name'],
  );
  memory = recordObserved(
    memory,
    'jira_project',
    [{ id: '10001', key: 'ATI', name: 'ATI Platform', siteId: 'site-1', cloudId: 'cloud-1', workspaceId: 'ws-1' }],
    ['id', 'key', 'name', 'siteId', 'cloudId', 'workspaceId'],
  );
  const recipients = extractWorkspaceRecipients('mycalendar', eventDetail);
  memory = {
    ...memory,
    __observed: {
      ...(memory.__observed ?? {}),
      recipient: recipients,
    },
  };

  const tools = [...ALL_TOOLS, ...MYCALENDAR_TOOLS, ...MYSHEETS_TOOLS, ...MYJIRA_TOOLS, ...GMAIL_TOOLS];
  const validClosedLoopPlan = JSON.stringify({
    kind: 'plan',
    thinking: 'Tạo biên bản họp trên Docs, tạo ticket Jira và gửi email cho người tham dự',
    summary: 'Follow-up sau cuộc họp Design Review Q4',
    steps: [
      {
        id: 's_doc',
        tool: 'mysheets.create_doc',
        description: 'Tạo tài liệu biên bản cuộc họp Design Review Q4',
        dependsOn: [],
        args: { title: 'Biên bản Design Review Q4', content: 'Quyết định & hành động tiếp theo.' },
      },
      {
        id: 's_jira',
        tool: 'myjira.create_issue',
        description: 'Tạo ticket theo dõi trên Jira ATI',
        dependsOn: ['s_doc'],
        args: {
          siteId: 'site-1',
          projectKey: 'ATI',
          summary: 'Hoàn thiện test webhook Calendar',
          description: { $template: 'Xem biên bản cuộc họp: ${s_doc.output.url}' },
        },
      },
      {
        id: 's_mail',
        tool: 'gmail.send_message',
        description: 'Gửi email biên bản & ticket tới người tham dự',
        dependsOn: ['s_doc', 's_jira'],
        args: {
          to: ['alice@acme.test'],
          subject: 'Biên bản & ticket Design Review Q4',
          body: { $template: 'Biên bản: ${s_doc.output.url}\nTicket Jira: ${s_jira.output.url}' },
        },
      },
    ],
  });

  const ok = validatePlan(validClosedLoopPlan, tools, {
    grounding: {
      memory,
      userTexts: ['Sau cuộc họp Design Review Q4, tạo biên bản Docs, tạo ticket trên dự án Jira ATI và gửi email cho người tham dự'],
    },
  });
  expect(ok).toEqual({ valid: true, parsed: expect.any(Object) });

  const badPlan = JSON.stringify({
    ...JSON.parse(validClosedLoopPlan),
    steps: JSON.parse(validClosedLoopPlan).steps.map((s: any) =>
      s.id === 's_mail' ? { ...s, args: { ...s.args, to: ['stranger@evil.test'] } } : s,
    ),
  });
  const rejected = validatePlan(badPlan, tools, {
    grounding: {
      memory,
      userTexts: ['Sau cuộc họp Design Review Q4, tạo biên bản Docs, tạo ticket trên dự án Jira ATI và gửi email cho người tham dự'],
    },
  });
  expect(rejected.valid).toBe(false);
});
