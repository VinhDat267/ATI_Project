import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, SERVICE_REGISTRY, MYCALENDAR_TOOLS, MYCALENDAR_SERVICE, MYCALENDAR_SCOPE, getToolDefinition } from '../src/index.js';
import { isWriteTool } from '../../executor/src/runner.js';
import { validatePlan } from '../../planner/src/validator.js';

describe('MYCALENDAR_TOOLS and MYCALENDAR_SERVICE', () => {
  it('keeps ALL_TOOLS at 33 and SERVICE_REGISTRY at 8 while exporting MYCALENDAR_* separately', () => {
    expect(ALL_TOOLS).toHaveLength(33);
    expect(SERVICE_REGISTRY).toHaveLength(8);
    expect(MYCALENDAR_SCOPE).toBe('https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly');
    expect(MYCALENDAR_SERVICE.id).toBe('mycalendar');
    expect(MYCALENDAR_SERVICE.connection).toBe('personal');
    expect(MYCALENDAR_TOOLS.map(t => t.name)).toEqual([
      'mycalendar.list_calendars',
      'mycalendar.list_events',
      'mycalendar.get_event',
      'mycalendar.find_free_slots',
      'mycalendar.create_event',
      'mycalendar.update_event',
      'mycalendar.delete_event',
      'mycalendar.schedule_meet',
      'mycalendar.list_event_instances',
      'mycalendar.rsvp_event',
    ]);
    const listEvents = MYCALENDAR_TOOLS.find(t => t.name === 'mycalendar.list_events')!;
    expect(listEvents.discovers).toBe('myevent');
    expect(listEvents.observedFields).toEqual(expect.arrayContaining(['id', 'title', 'start', 'end', 'meetLink', 'attendees', 'location', 'recurrence', 'recurringEventId', 'selfResponseStatus', 'calendarId']));
  });

  it('marks mycalendar.create_event, update_event, delete_event, schedule_meet and rsvp_event as write tools in executor and separates x-resource mycalendar from shared calendar', () => {
    expect(isWriteTool('mycalendar.create_event')).toBe(true);
    expect(isWriteTool('mycalendar.update_event')).toBe(true);
    expect(isWriteTool('mycalendar.delete_event')).toBe(true);
    expect(isWriteTool('mycalendar.schedule_meet')).toBe(true);
    expect(isWriteTool('mycalendar.rsvp_event')).toBe(true);
    expect(isWriteTool('mycalendar.list_events')).toBe(false);
    expect(isWriteTool('mycalendar.get_event')).toBe(false);
    expect(isWriteTool('mycalendar.list_event_instances')).toBe(false);
    expect(isWriteTool('mycalendar.find_free_slots')).toBe(false);
    expect(isWriteTool('mycalendar.list_calendars')).toBe(false);

    // Review Focus #4: shared calendar ID in memory.calendar must not ground mycalendar.create_event
    const planJson = JSON.stringify({
      kind: 'plan',
      thinking: 'Tạo sự kiện trên lịch cá nhân',
      summary: 'Tạo lịch họp',
      steps: [{
        id: 's1',
        tool: 'mycalendar.create_event',
        description: 'Tạo sự kiện',
        dependsOn: [],
        args: {
          calendarId: 'shared_team@group.calendar.google.com',
          summary: 'Họp nhóm',
          start: '2026-10-30T09:00:00+07:00',
          end: '2026-10-30T10:00:00+07:00',
        },
      }],
    });
    const ungrounded = validatePlan(planJson, [...ALL_TOOLS, ...MYCALENDAR_TOOLS], {
      grounding: { memory: { calendar: [{ id: 'shared_team@group.calendar.google.com', title: 'Team' }] }, userTexts: [] },
    });
    expect(ungrounded.valid).toBe(false);
    if (!ungrounded.valid) expect(ungrounded.layer).toBe('grounding');

    const grounded = validatePlan(planJson, [...ALL_TOOLS, ...MYCALENDAR_TOOLS], {
      grounding: { memory: { mycalendar: [{ id: 'shared_team@group.calendar.google.com', title: 'My Cal' }] }, userTexts: [] },
    });
    expect(grounded.valid).toBe(true);

    const meetPlanJson = JSON.stringify({
      kind: 'plan',
      thinking: 'Tạo phòng họp Google Meet có danh sách người tham dự',
      summary: 'Đặt lịch họp Google Meet',
      steps: [{
        id: 's1',
        tool: 'mycalendar.schedule_meet',
        description: 'Tạo phòng họp Google Meet',
        dependsOn: [],
        args: {
          calendarId: 'shared_team@group.calendar.google.com',
          summary: 'Họp Sprint Review trên Google Meet',
          description: 'Review kết quả Sprint 15',
          start: '2026-10-30T15:00:00+07:00',
          end: '2026-10-30T16:00:00+07:00',
          attendees: ['lan@example.com', 'minh@example.com'],
          sendInvites: true,
        },
      }],
    });
    const meetGrounded = validatePlan(meetPlanJson, [...ALL_TOOLS, ...MYCALENDAR_TOOLS], {
      grounding: {
        memory: { mycalendar: [{ id: 'shared_team@group.calendar.google.com', title: 'My Cal' }] },
        userTexts: ['Mời lan@example.com và minh@example.com họp Google Meet'],
      },
    });
    expect(meetGrounded.valid).toBe(true);
  });

  it('supports optional IANA timeZone on mycalendar read/write tools and additive coverage on list_events/find_free_slots', () => {
    const recurringPlanJson = JSON.stringify({
      kind: 'plan',
      thinking: 'Tạo sự kiện lặp lại có múi giờ IANA',
      summary: 'Tạo lịch họp định kỳ',
      steps: [{
        id: 's_rec',
        tool: 'mycalendar.create_event',
        description: 'Tạo sự kiện lặp lại hàng tuần',
        dependsOn: [],
        args: {
          calendarId: 'shared_team@group.calendar.google.com',
          summary: 'Weekly Sync',
          start: '2026-11-16T09:00:00+07:00',
          end: '2026-11-16T09:30:00+07:00',
          timeZone: 'Asia/Ho_Chi_Minh',
          recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO',
        },
      }],
    });
    const validated = validatePlan(recurringPlanJson, [...ALL_TOOLS, ...MYCALENDAR_TOOLS], {
      grounding: {
        memory: { mycalendar: [{ id: 'shared_team@group.calendar.google.com', title: 'My Cal' }] },
        userTexts: ['Tạo lịch Weekly Sync mỗi thứ Hai lúc 9h'],
      },
    });
    expect(validated.valid).toBe(true);

    const listEvents = MYCALENDAR_TOOLS.find(t => t.name === 'mycalendar.list_events')!;
    const findFreeSlots = MYCALENDAR_TOOLS.find(t => t.name === 'mycalendar.find_free_slots')!;
    expect(listEvents.outputSchema).toMatchObject({
      properties: {
        coverage: {
          required: ['complete', 'returned', 'totalAvailable'],
        },
      },
    });
    expect(findFreeSlots.outputSchema).toMatchObject({
      properties: {
        coverage: {
          required: ['complete', 'returned', 'totalAvailable'],
        },
      },
    });
  });

  it('exposes MYCALENDAR_TOOLS via getToolDefinition, declares attendees on get_event output, and enforces x-resource myevent grounding on eventId', () => {
    for (const tool of MYCALENDAR_TOOLS) {
      expect(getToolDefinition(tool.name)?.name).toBe(tool.name);
    }

    const getEvent = MYCALENDAR_TOOLS.find(t => t.name === 'mycalendar.get_event')!;
    expect(getEvent.outputSchema).toMatchObject({
      properties: {
        attendees: { type: 'array' },
      },
    });

    const deletePlan = JSON.stringify({
      kind: 'plan',
      thinking: 'Xoá sự kiện khỏi lịch cá nhân',
      summary: 'Huỷ cuộc họp',
      steps: [{
        id: 's_del',
        tool: 'mycalendar.delete_event',
        description: 'Xoá sự kiện',
        dependsOn: [],
        args: {
          calendarId: 'owner@example.test',
          eventId: 'hallucinated_evt_999',
        },
      }],
    });
    const ungroundedEvent = validatePlan(deletePlan, [...ALL_TOOLS, ...MYCALENDAR_TOOLS], {
      grounding: {
        memory: {
          mycalendar: [{ id: 'owner@example.test', title: 'Lịch chính' }],
          myevent: [{ id: 'real_evt_1', title: 'Họp Sprint', calendarId: 'owner@example.test' }],
        },
        userTexts: ['Huỷ lịch họp giúp tôi'],
      },
    });
    expect(ungroundedEvent.valid).toBe(false);
    if (!ungroundedEvent.valid) expect(ungroundedEvent.layer).toBe('grounding');

    const groundedDeletePlan = JSON.stringify({
      kind: 'plan',
      thinking: 'Xoá sự kiện đã tìm thấy',
      summary: 'Huỷ Họp Sprint',
      steps: [{
        id: 's_del',
        tool: 'mycalendar.delete_event',
        description: 'Xoá sự kiện Họp Sprint',
        dependsOn: [],
        args: {
          calendarId: 'owner@example.test',
          eventId: 'real_evt_1',
        },
      }],
    });
    const groundedEvent = validatePlan(groundedDeletePlan, [...ALL_TOOLS, ...MYCALENDAR_TOOLS], {
      grounding: {
        memory: {
          mycalendar: [{ id: 'owner@example.test', title: 'Lịch chính' }],
          myevent: [{ id: 'real_evt_1', title: 'Họp Sprint', calendarId: 'owner@example.test' }],
        },
        userTexts: ['Huỷ lịch họp Sprint giúp tôi'],
      },
    });
    expect(groundedEvent.valid).toBe(true);
  });

  it('requires myevent grounding on mycalendar.rsvp_event and mycalendar.list_event_instances and validates responseStatus enum', () => {
    const rsvpTool = MYCALENDAR_TOOLS.find(t => t.name === 'mycalendar.rsvp_event');
    const instancesTool = MYCALENDAR_TOOLS.find(t => t.name === 'mycalendar.list_event_instances');
    expect(rsvpTool).toBeDefined();
    expect(instancesTool).toBeDefined();
    expect(instancesTool!.discovers).toBe('myevent');

    const ungroundedRsvp = validatePlan(
      JSON.stringify({
        kind: 'plan',
        thinking: 'Chấp nhận lời mời họp',
        summary: 'Xác nhận tham dự',
        steps: [{
          id: 's_rsvp',
          tool: 'mycalendar.rsvp_event',
          description: 'Chấp nhận lời mời Họp Sprint',
          dependsOn: [],
          args: {
            calendarId: 'owner@example.test',
            eventId: 'hallucinated_evt_777',
            responseStatus: 'accepted',
          },
        }],
      }),
      [...ALL_TOOLS, ...MYCALENDAR_TOOLS],
      {
        grounding: {
          memory: {
            mycalendar: [{ id: 'owner@example.test', title: 'Lịch chính' }],
            myevent: [{ id: 'real_evt_1', title: 'Họp Sprint', calendarId: 'owner@example.test' }],
          },
          userTexts: ['Chấp nhận tham gia Họp Sprint'],
        },
      },
    );
    expect(ungroundedRsvp.valid).toBe(false);
    if (!ungroundedRsvp.valid) expect(ungroundedRsvp.layer).toBe('grounding');

    const groundedRsvp = validatePlan(
      JSON.stringify({
        kind: 'plan',
        thinking: 'Liệt kê buổi lặp lại rồi xác nhận tham gia 1 buổi',
        summary: 'Lấy buổi họp rồi RSVP',
        steps: [
          {
            id: 's_inst',
            tool: 'mycalendar.list_event_instances',
            description: 'Liệt kê các buổi trong chuỗi Họp Sprint',
            dependsOn: [],
            args: { calendarId: 'owner@example.test', eventId: 'real_evt_1' },
          },
          {
            id: 's_rsvp',
            tool: 'mycalendar.rsvp_event',
            description: 'Chấp nhận tham dự Họp Sprint',
            dependsOn: ['s_inst'],
            args: {
              calendarId: 'owner@example.test',
              eventId: 'real_evt_1',
              responseStatus: 'accepted',
              comment: 'Tôi sẽ tham gia đúng giờ',
              sendInvites: true,
            },
          },
        ],
      }),
      [...ALL_TOOLS, ...MYCALENDAR_TOOLS],
      {
        grounding: {
          memory: {
            mycalendar: [{ id: 'owner@example.test', title: 'Lịch chính' }],
            myevent: [{ id: 'real_evt_1', title: 'Họp Sprint', calendarId: 'owner@example.test' }],
          },
          userTexts: ['Chấp nhận tham gia Họp Sprint và gửi phản hồi'],
        },
      },
    );
    expect(groundedRsvp.valid).toBe(true);
  });
});
