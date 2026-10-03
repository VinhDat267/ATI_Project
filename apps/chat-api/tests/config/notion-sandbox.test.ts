import { expect, it } from 'vitest';
import { createSandboxAdapter } from '../../src/sandbox/index.js';
import { createSandboxProvider } from '../../src/sandbox/scenarios.js';
import { readLiveConfig } from '../../../../evaluations/live-execution/harness.js';

it('publishes Notion sandbox database/page resources and a create-to-Slack URL dependency', async () => {
  const adapter = createSandboxAdapter('notion', 'notion_slack');
  const directory = await adapter.execute('notion.search_databases', { query: '', limit: 10 });
  expect(directory).toEqual([{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'ATI Notes', url: 'https://www.notion.so/aaaaaaaabbbbccccddddeeeeeeeeeeee' }]);
  const plan = JSON.parse(await createSandboxProvider('notion_slack').generatePlan({} as any));
  expect(plan.steps.map((s: any) => s.tool)).toEqual(['notion.create_page', 'slack.send_message']);
  const created = await adapter.execute(plan.steps[0].tool, plan.steps[0].args);
  expect(created).toMatchObject({ id: '22222222-3333-4444-5555-666666666666', url: 'https://www.notion.so/22222222333344445555666666666666' });
  expect(plan.steps[1].dependsOn).toEqual(['step_1']); expect(plan.steps[1].args.text.$template).toContain('${step_1.output.url}');
});
it('registers live Notion credentials with an explicit UUID database scope without external calls', () => {
  const env = { NOTION_TOKEN: 'synthetic', LIVE_NOTION_DATABASE_IDS: 'AAAAAAAABBBBCCCCDDDDEEEEEEEEEEEE,aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };
  const config = readLiveConfig(env); expect(config.services.notion).toBeDefined();
  expect(readLiveConfig({ ...env, LIVE_NOTION_DATABASE_IDS: 'bad' }).services.notion).toBeUndefined();
  expect(readLiveConfig({ ...env, NOTION_TOKEN: '' }).services.notion).toBeUndefined();
  expect(readLiveConfig({ ...env, LIVE_NOTION_DATABASE_IDS: '' }).services.notion).toBeUndefined();
});
