import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider, WorkingMemory } from '../src/index.js';

const now = () => new Date('2026-10-25T01:00:00.000Z'); // Sunday 25/10/2026, 08:00 in Viet Nam
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
/** System prompt SHA-256 from main before SCHED-02 (7bb752d), for the message below on ALL_TOOLS. */
const BASELINE = {
  regex: '14ea8a4bcf831da986cf449f823c959e172c331a7e7cd6c16ef74e927f00fdb1',
  llm: 'b324fa473c28841041540c3e84df742083d1ccb7a92824c16da5bbc6e57deb70',
  llmAnswers: '0826b45b85fada72ebdce87f5d4ccaee8c922821a42ff1a3364284de153be460',
};
const MESSAGE = 'Tạo card Trello sửa lỗi đăng nhập và báo lên Slack';
const MODES = ['regex', 'llm'] as const;
const create = { kind: 'schedule', action: 'create', name: 'Lịch họp hằng ngày', request: 'Gửi lịch họp hôm nay lên Slack #ati-test',
  recurrence: { type: 'daily', time: '08:00' }, summary: 'Mỗi sáng 8 giờ gửi lịch họp.' };
const pause = { kind: 'schedule', action: 'pause', summary: 'Tạm dừng lịch.' };

function planner(searchMode: typeof MODES[number], responses: unknown[], options: Record<string, unknown> = {}) {
  const provider = new MockLLMProvider();
  provider.setPlanResponses(responses);
  // In regex mode gather looks "#ati-test" up before the model runs, as it does for any request.
  const instance = new AIPlanner({ provider, toolCatalog: ALL_TOOLS, searchMode, now, timeZone: 'Asia/Ho_Chi_Minh',
    prefetchDirectory: false, gatherSearch: async () => [{ id: 'C0123456789', name: 'ati-test' }], ...options } as any);
  const run = (userMessage: string, input: Record<string, unknown> = {}) =>
    instance.processMessage({ userMessage, memory: new WorkingMemory(), ...input } as any);
  const servicesSeen = () => [...new Set(provider.getLastInput()!.toolCatalog.map((t) => t.service))].sort();
  return { provider, instance, run, servicesSeen, prompt: () => provider.getLastInput()!.systemPrompt };
}
const baseline = (mode: typeof MODES[number], readAnswers: boolean) => mode === 'regex' ? BASELINE.regex : readAnswers ? BASELINE.llmAnswers : BASELINE.llm;

describe('SCHED-02 planner', () => {
  describe('prompt', () => {
    it.each(MODES.flatMap((mode) => [false, true].map((readAnswers) => [mode, readAnswers] as const)))(
      'prompt_unchanged_when_schedules_off (%s, readAnswers %s)', async (mode, readAnswers) => {
        for (const options of [{ readAnswers }, { readAnswers, schedules: false }]) {
          const p = planner(mode, ['{}'], options);
          await p.run(MESSAGE).catch(() => undefined);
          expect(hash(p.prompt())).toBe(baseline(mode, readAnswers));
        }
      });

    it.each(MODES.flatMap((mode) => [false, true].map((readAnswers) => [mode, readAnswers] as const)))(
      'scheduled_run_uses_flag_off_prompt (%s, readAnswers %s)', async (mode, readAnswers) => {
        const p = planner(mode, ['{}'], { readAnswers, schedules: true });
        await p.run(MESSAGE, { scheduledRun: true }).catch(() => undefined);
        expect(hash(p.prompt())).toBe(baseline(mode, readAnswers));
      });

    it.each(MODES)('adds the schedule rules once when schedules are on (%s)', async (mode) => {
      const { scheduleRules } = await import('../src/prompts/schedule-rules.js');
      for (const readAnswers of [false, true]) {
        const p = planner(mode, ['{}'], { readAnswers, schedules: true });
        await p.run(MESSAGE).catch(() => undefined);
        expect(p.prompt().split(scheduleRules()).length - 1).toBe(1);
        expect(p.prompt().split('### Scheduled workflows').length - 1).toBe(1);
      }
    });
  });

  describe('schedule responses', () => {
    it.each(MODES)('returns a schedule after one corrected attempt (%s)', async (mode) => {
      const p = planner(mode, [{ ...create, recurrence: { type: 'daily', time: '8:00' } }, create], { schedules: true });
      expect(await p.run('Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test')).toEqual(create);
      expect(p.provider.getCallCount()).toBe(2);
      expect(p.provider.getLastInput()!.conversationHistory.at(-1)!.content).toContain('recurrence.time');
    });

    it.each(MODES)('pause_without_service_keyword_reaches_model (%s)', async (mode) => {
      const p = planner(mode, [pause], { schedules: true });
      expect(await p.run('Tạm dừng lịch này', { schedule: { services: ['calendar', 'slack'] } })).toEqual(pause);
      expect(p.provider.getCallCount()).toBe(1);
      // Without a schedule the routing is the old one, and there is nothing to pause.
      const old = planner(mode, [pause, pause], { schedules: true });
      await expect(old.run('Tạm dừng lịch này')).rejects.toThrow(/no schedule to pause/);
      expect(old.servicesSeen()).toEqual(['calendar', 'github', 'jira', 'notion', 'sheets', 'slack', 'telegram', 'trello']);
    });

    it.each(MODES)('routes to the services of the conversation schedule too (%s)', async (mode) => {
      const update = { ...create, action: 'update', request: 'Gửi lịch họp hôm nay lên Telegram' };
      const p = planner(mode, [update], { schedules: true });
      await p.run('Chuyển lịch này sang gửi lên Telegram', { schedule: { services: ['calendar', 'slack'] } });
      expect(p.servicesSeen()).toEqual(['calendar', 'slack', 'telegram']);
      const old = planner(mode, [update], { schedules: true });
      await old.run('Chuyển lịch này sang gửi lên Telegram').catch(() => undefined);
      expect(old.servicesSeen()).toEqual(['telegram']);
    });

    it.each(MODES)('still refuses a request that names a service that is not configured (%s)', async (mode) => {
      const p = planner(mode, [create], { schedules: true, toolCatalog: ALL_TOOLS.filter((t) => t.service !== 'telegram') });
      expect(await p.run('Gửi lên Telegram nữa', { schedule: { services: ['calendar', 'slack'] } }))
        .toMatchObject({ kind: 'refusal', unavailableServices: [{ id: 'telegram', name: 'Telegram' }] });
      expect(p.provider.getCallCount()).toBe(0);
    });

    it.each(MODES)('refuses a schedule while planning a scheduled run, on both attempts (%s)', async (mode) => {
      const p = planner(mode, [create, create], { schedules: true });
      await expect(p.run(MESSAGE, { scheduledRun: true })).rejects.toThrow(/Validation failed after retry: \[semantic\]/);
      expect(p.provider.getCallCount()).toBe(2);
    });

    it.each(MODES)('never accepts a schedule with schedules off (%s)', async (mode) => {
      const p = planner(mode, [create, create]);
      await expect(p.run('Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test')).rejects.toThrow(/Validation failed after retry: \[schema\] Invalid kind 'schedule'/);
    });
  });

  describe('routeSchedule', () => {
    it('names the services the request needs, or those that are not configured', () => {
      const p = planner('regex', []);
      expect(p.instance.routeSchedule('Gửi lịch họp hôm nay lên Slack #ati-test')).toEqual({ services: ['slack', 'calendar'], unavailable: [] });
      const noCalendar = planner('regex', [], { toolCatalog: ALL_TOOLS.filter((t) => t.service !== 'calendar') });
      expect(noCalendar.instance.routeSchedule('Gửi lịch họp hôm nay lên Slack #ati-test'))
        .toEqual({ services: [], unavailable: [{ id: 'calendar', name: 'Google Calendar' }] });
    });
  });
});
