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
      'mycalendar.create_event',
    ]);
  });

  it('marks mycalendar.create_event as a write tool in executor and separates x-resource mycalendar from shared calendar', () => {
    expect(isWriteTool('mycalendar.create_event')).toBe(true);
    expect(isWriteTool('mycalendar.list_events')).toBe(false);
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
  });
});
