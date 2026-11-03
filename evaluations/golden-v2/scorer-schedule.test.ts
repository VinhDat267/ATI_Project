import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, type PlannerResponse, type ScheduleRecurrence, type ScheduleResponse } from '@wap/tool-schemas';
import { aggregateRuns, scoreCase, type CaseRun, type GoldenCase } from './scorer.js';

const schedule = (
  action: ScheduleResponse['action'],
  recurrence?: ScheduleRecurrence,
  extra: Partial<ScheduleResponse> = {},
): PlannerResponse => ({
  kind: 'schedule',
  action,
  ...(action === 'create' || action === 'update'
    ? {
        name: 'Lịch mẫu',
        request: 'Gửi lịch họp hôm nay từ Google Calendar Team lên kênh Slack #frontend',
        recurrence: recurrence ?? { type: 'daily', time: '08:00' },
      }
    : {}),
  summary: 'Tóm tắt lịch.',
  ...extra,
});

describe('schedule scoring (SCHED-04)', () => {
  it('scores once, daily, and weekly create/update/pause schedules on action and recurrence (type, time, date, days)', () => {
    const onceCase: GoldenCase = {
      id: 'sc_once',
      category: 'schedule',
      language: 'vi',
      prompt: '9 giờ sáng mai chạy',
      expect: { kind: 'schedule', action: 'create', recurrence: { type: 'once', date: '2026-09-30', time: '09:00' } },
    };
    expect(scoreCase(onceCase, schedule('create', { type: 'once', date: '2026-09-30', time: '09:00' }), ALL_TOOLS)).toMatchObject({
      kindOk: true,
      toolsOk: null,
      argsOk: true,
      passed: true,
    });
    // Wrong date fails
    expect(scoreCase(onceCase, schedule('create', { type: 'once', date: '2026-10-01', time: '09:00' }), ALL_TOOLS)).toMatchObject({
      kindOk: true,
      argsOk: false,
      passed: false,
    });
    // Wrong time fails
    expect(scoreCase(onceCase, schedule('create', { type: 'once', date: '2026-09-30', time: '09:30' }), ALL_TOOLS)).toMatchObject({
      kindOk: true,
      argsOk: false,
      passed: false,
    });
    // Wrong recurrence type fails
    expect(scoreCase(onceCase, schedule('create', { type: 'daily', time: '09:00' }), ALL_TOOLS)).toMatchObject({
      kindOk: true,
      argsOk: false,
      passed: false,
    });
  });

  it('catches mutation 1 (dropping recurrence.days comparison): rejects weekly schedule with mismatched days', () => {
    const weeklyCase: GoldenCase = {
      id: 'sc_weekly',
      category: 'schedule',
      language: 'vi',
      prompt: 'T2 đến T6 lúc 8:30',
      expect: { kind: 'schedule', action: 'update', recurrence: { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] } },
    };
    expect(scoreCase(weeklyCase, schedule('update', { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] }), ALL_TOOLS).passed).toBe(true);
    // Subset or different days (including same-length different weekdays) must fail
    const wrongDaysSubset = scoreCase(weeklyCase, schedule('update', { type: 'weekly', time: '08:30', days: [1, 3, 5] }), ALL_TOOLS);
    expect(wrongDaysSubset.passed).toBe(false);
    expect(wrongDaysSubset.argsOk).toBe(false);
    expect(wrongDaysSubset.failures.join('\n')).toMatch(/recurrence\.days/);

    const wrongDaysSameLength = scoreCase(weeklyCase, schedule('update', { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 6] }), ALL_TOOLS);
    expect(wrongDaysSameLength.passed).toBe(false);
    expect(wrongDaysSameLength.argsOk).toBe(false);
    expect(wrongDaysSameLength.failures.join('\n')).toMatch(/recurrence\.days/);
  });

  it('catches mutation 2 (accepting schedule for a Calendar event plan case): rejects schedule response when expect.kind is plan', () => {
    const calendarEventCase: GoldenCase = {
      id: 'sc_cal_event',
      category: 'single_step',
      language: 'vi',
      services: ['calendar'],
      prompt: 'Tạo sự kiện Họp Sprint trên Google Calendar Team ngày mai 9h-10h',
      expect: {
        kind: 'plan',
        steps: [
          {
            tool: 'calendar.create_event',
            args: {
              calendarId: { equals: 'team@example.test' },
              summary: { includesAll: ['Họp Sprint'] },
            },
          },
        ],
      },
    };
    const wronglyScheduled = scoreCase(
      calendarEventCase,
      schedule('create', { type: 'once', date: '2026-09-30', time: '09:00' }),
      ALL_TOOLS,
    );
    expect(wronglyScheduled.kindOk).toBe(false);
    expect(wronglyScheduled.passed).toBe(false);
    expect(wronglyScheduled.failures).toContain('kind: expected plan, got schedule');
  });

  it('catches mutation 3 (dropping action comparison): rejects schedule with wrong action', () => {
    const pauseCase: GoldenCase = {
      id: 'sc_pause',
      category: 'schedule',
      language: 'vi',
      prompt: 'Tạm dừng lịch này.',
      expect: { kind: 'schedule', action: 'pause' },
    };
    expect(scoreCase(pauseCase, schedule('pause'), ALL_TOOLS).passed).toBe(true);
    const wrongAction = scoreCase(pauseCase, schedule('cancel'), ALL_TOOLS);
    expect(wrongAction.passed).toBe(false);
    expect(wrongAction.argsOk).toBe(false);
    expect(wrongAction.failures.join('\n')).toMatch(/action/);

    const updateCase: GoldenCase = {
      id: 'sc_update',
      category: 'schedule',
      language: 'vi',
      prompt: 'Đổi giờ sang 08:30',
      expect: { kind: 'schedule', action: 'update', recurrence: { type: 'daily', time: '08:30' } },
    };
    expect(scoreCase(updateCase, schedule('create', { type: 'daily', time: '08:30' }), ALL_TOOLS).passed).toBe(false);
  });

  it('aggregates schedule runs cleanly alongside plan cases', () => {
    const c: GoldenCase = {
      id: 'sc_daily',
      category: 'schedule',
      language: 'vi',
      services: ['calendar', 'slack'],
      prompt: 'Mỗi sáng 8 giờ',
      expect: { kind: 'schedule', action: 'create', recurrence: { type: 'daily', time: '08:00' } },
    };
    const resp = schedule('create', { type: 'daily', time: '08:00' });
    const row: CaseRun = { case: c, response: resp, latencyMs: 120, llmCalls: 1, score: scoreCase(c, resp, ALL_TOOLS) };
    const agg = aggregateRuns([[row]], ALL_TOOLS);
    expect(agg.mean.kindAccuracy).toBe(1);
    expect(agg.mean.strictPassRate).toBe(1);
    expect(agg.byCategory.schedule.strictPassRate).toBe(1);
  });
});
