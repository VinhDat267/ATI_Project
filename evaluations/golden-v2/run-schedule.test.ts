import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MockLLMProvider, validateSchedule } from '@wap/planner';
import { ALL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import * as runner from './run.js';
import type { GoldenCase } from './scorer.js';

const file = JSON.parse(readFileSync(new URL('./cases-schedule.json', import.meta.url), 'utf8')) as runner.GoldenFile;
const cases = file.cases as GoldenCase[];

describe('SCHED-04 schedule evaluation suite', () => {
  it('preregisters 16 cases across create (6), non-schedule plan (4), clarification (3), and multi-turn (3)', () => {
    expect(cases).toHaveLength(16);
    expect(new Set(cases.map((c) => c.id)).size).toBe(16);
    expect(file.clock).toBe('2026-09-29T10:00:00+07:00');
    expect(file.timeZone).toBe('Asia/Ho_Chi_Minh');

    const creates = cases.filter((c) => !c.turns && c.expect.kind === 'schedule' && c.expect.action === 'create');
    expect(creates).toHaveLength(6);
    expect(creates.filter((c) => c.expect.recurrence?.type === 'once').map((c) => c.language).sort()).toEqual(['en', 'vi']);
    expect(creates.filter((c) => c.expect.recurrence?.type === 'daily').map((c) => c.language).sort()).toEqual(['en', 'vi']);
    expect(creates.filter((c) => c.expect.recurrence?.type === 'weekly').map((c) => c.language).sort()).toEqual(['en', 'vi']);

    const plans = cases.filter((c) => c.expect.kind === 'plan');
    expect(plans).toHaveLength(4);

    const clarifications = cases.filter((c) => c.expect.kind === 'clarification');
    expect(clarifications).toHaveLength(3);

    const multiTurn = cases.filter((c) => Array.isArray(c.turns) && c.turns.length > 0);
    expect(multiTurn).toHaveLength(3);
    expect(multiTurn.map((c) => c.expect.action)).toEqual(['update', 'update', 'pause']);
  });

  it('configures EVAL_SET=schedule with the shared catalog and schedules enabled', () => {
    expect(runner.parseEvalOptions({ EVAL_SET: 'schedule' })).toMatchObject({
      set: 'schedule',
      schedules: true,
      readAnswers: false,
    });
    expect(runner.parseEvalOptions({ EVAL_SET: 'core', SCHEDULES_ENABLED: 'on' })).toMatchObject({
      set: 'core',
      schedules: true,
    });
    expect(runner.evalCatalog('schedule')).toEqual({ tools: ALL_TOOLS, services: SERVICE_REGISTRY });
  });

  it('rebuilds multi-turn schedule_proposal history as proposal JSON and passes schedule.services like ChatService', async () => {
    const turnCase = cases.find((c) => c.id === 'sc_turn02')!;
    const history = runner.historyOf(turnCase);
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({
      role: 'user',
      content: 'Mỗi sáng 8 giờ, gửi lịch họp hôm nay từ Google Calendar Team lên kênh Slack #frontend.',
    });
    const parsedAssistant = JSON.parse(history[1]!.content);
    expect(parsedAssistant).toMatchObject({
      kind: 'schedule',
      action: 'create',
      recurrence: { type: 'daily', time: '08:00' },
    });
    expect(
      validateSchedule(history[1]!.content, {
        enabled: true,
        now: new Date(file.clock),
        timeZone: file.timeZone,
        hasSchedule: false,
      }).valid,
    ).toBe(true);

    const provider = new MockLLMProvider();
    provider.setPlanResponses([
      {
        kind: 'schedule',
        action: 'update',
        name: 'Lịch họp ngày làm việc',
        request: 'Gửi lịch họp hôm nay từ Google Calendar Team lên kênh Slack #frontend',
        recurrence: { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] },
        summary: 'Đổi sang 08:30 từ thứ Hai đến thứ Sáu.',
      } as any,
    ]);

    const row = await runner.runCase(turnCase, file, false, 'llm', { provider, schedules: true });
    expect(row.score.passed).toBe(true);
    // Multi-turn with an existing schedule skips directory prefetch and includes ### Scheduled workflows in prompt
    expect(row.prefetches).toHaveLength(0);
    expect(provider.getLastInput()!.systemPrompt).toContain('### Scheduled workflows');
  });

  it('executes dry-run for EVAL_SET=schedule with exit code 0', async () => {
    const output = mkdtempSync(join(tmpdir(), 'ati-sched-04-dry-'));
    for (const [name, value] of Object.entries({
      EVAL_DRY_RUN: '1',
      EVAL_SET: 'schedule',
      EVAL_RUNS: '1',
      EVAL_CONCURRENCY: '2',
      EVAL_SEARCH_MODE: 'llm',
      PLANNER_SEARCH_MODE: 'llm',
      EVAL_OUTPUT_DIR: output,
    })) {
      vi.stubEnv(name, value);
    }
    try {
      await runner.main();
      const dirs = readdirSync(output);
      expect(dirs).toHaveLength(1);
      const report = JSON.parse(readFileSync(join(output, dirs[0]!, 'report.json'), 'utf8'));
      expect(report).toMatchObject({
        evidence: 'dry_run',
        set: 'schedule',
        schedules: true,
        labels: { file: 'cases-schedule.json', cases: 16, selectedCases: 16 },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
