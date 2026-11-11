import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, SERVICE_REGISTRY, MYCALENDAR_TOOLS, MYCALENDAR_SERVICE, MYCALENDAR_SCOPE } from '../src/index.js';
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
    ]);
    const listEvents = MYCALENDAR_TOOLS.find(t => t.name === 'mycalendar.list_events')!;
    expect(listEvents.discovers).toBe('myevent');
    expect(listEvents.observedFields).toEqual(expect.arrayContaining(['id', 'title', 'start', 'end', 'meetLink', 'attendees', 'location', 'recurrence', 'calendarId']));
  });

  it('marks mycalendar.create_event, update_event, delete_event and schedule_meet as write tools in executor and separates x-resource mycalendar from shared calendar', () => {
    expect(isWriteTool('mycalendar.create_event')).toBe(true);
    expect(isWriteTool('mycalendar.update_event')).toBe(true);
    expect(isWriteTool('mycalendar.delete_event')).toBe(true);
    expect(isWriteTool('mycalendar.schedule_meet')).toBe(true);
    expect(isWriteTool('mycalendar.list_events')).toBe(false);
    expect(isWriteTool('mycalendar.get_event')).toBe(false);
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
});
