import { expect, it } from 'vitest';
import { createSandboxAdapter } from '../../src/sandbox/index.js';
import { createSandboxProvider } from '../../src/sandbox/scenarios.js';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { readLiveConfig } from '../../../../evaluations/live-execution/harness.js';

it('registers Calendar sandbox metadata and two-step Calendar to Slack output dependencies', async () => {
  const calendar = createSandboxAdapter('calendar', 'calendar_slack');
  expect(await calendar.execute('calendar.list_calendars', { query: '', limit: 10 })).toEqual([{ id: 'ati@group.calendar.google.com', title: 'ATI Review', timeZone: 'Asia/Ho_Chi_Minh' }]);
  const provider = createSandboxProvider('calendar_slack');
  const plan = JSON.parse(await provider.generatePlan({} as any));
  expect(plan.steps.map((step: any) => step.tool)).toEqual(['calendar.create_event', 'slack.send_message']);
  const first = await calendar.execute(plan.steps[0].tool, plan.steps[0].args);
  expect(first).toMatchObject({ id: 'event_sandbox', start: plan.steps[0].args.start, end: plan.steps[0].args.end, title: plan.steps[0].args.summary });
  expect(plan.steps[1].dependsOn).toEqual(['step_1']);
  expect(plan.steps[1].args.text.$template).toContain('${step_1.output.url}');
  expect(plan.steps[1].args.text.$template).toContain('${step_1.output.start}');
  expect(ALL_TOOLS.filter(t => t.service === 'calendar')).toHaveLength(3);
});
it('registers live Calendar independently from Sheets with the same env credentials and scoped ids', () => {
  const env = { GOOGLE_CLIENT_EMAIL: 'fixture@example.test', GOOGLE_PRIVATE_KEY: 'synthetic', LIVE_CALENDAR_IDS: 'ati@group.calendar.google.com, ati@group.calendar.google.com' };
  const config = readLiveConfig(env);
  expect(config.services.calendar!.allowedScope).toEqual({ calendars: ['ati@group.calendar.google.com'] });
  expect(config.services.sheets).toBeUndefined();
  expect(readLiveConfig({ ...env, LIVE_CALENDAR_IDS: 'bad/id' }).services.calendar).toBeUndefined();
  expect(readLiveConfig({ ...env, LIVE_CALENDAR_IDS: '' }).services.calendar).toBeUndefined();
});
