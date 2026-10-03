import { expect, it } from 'vitest';
import { createSandboxAdapter } from '../../src/sandbox/index.js';
import { createSandboxProvider } from '../../src/sandbox/scenarios.js';
import { readLiveConfig } from '../../../../evaluations/live-execution/harness.js';

it('provides Jira project/issue discovery and Jira-to-Slack key/url dependencies', async () => {
  const adapter = createSandboxAdapter('jira', 'jira_slack');
  expect(await adapter.execute('jira.search_projects', { query: '', limit: 10 })).toEqual([{ id: '10000', key: 'ATI', name: 'ATI Project' }]);
  const issues = await adapter.execute('jira.search_issues', { projectKey: 'ATI' }) as { issues: Array<{ id: string; key: string; title: string }> }; expect(issues.issues[0]).toMatchObject({ id: '10042', key: 'ATI-42', title: 'Login bug' });
  const plan = JSON.parse(await createSandboxProvider('jira_slack').generatePlan({} as any));
  expect(plan.steps.map((s: any) => s.tool)).toEqual(['jira.create_issue', 'slack.send_message']);
  expect(await adapter.execute(plan.steps[0].tool, plan.steps[0].args)).toEqual({ id: '10042', key: 'ATI-42', url: 'https://ati-test.atlassian.net/browse/ATI-42' });
  expect(plan.steps[1].dependsOn).toEqual(['step_1']); expect(plan.steps[1].args.text.$template).toContain('${step_1.output.key}'); expect(plan.steps[1].args.text.$template).toContain('${step_1.output.url}');
});
it('reads live Jira environment and refuses invalid/empty scope without provider calls', () => {
  const env = { JIRA_SITE_URL: 'https://ati-test.atlassian.net', JIRA_EMAIL: 'fixture@example.test', JIRA_API_TOKEN: 'synthetic', LIVE_JIRA_PROJECT_KEYS: 'ATI,OTHER' };
  expect(readLiveConfig(env).services.jira).toEqual({ credentials: { siteUrl: env.JIRA_SITE_URL, email: env.JIRA_EMAIL, apiToken: env.JIRA_API_TOKEN }, allowedScope: { projects: ['ATI', 'OTHER'] } });
  for (const value of ['', 'ati', 'ATI,A-B']) expect(readLiveConfig({ ...env, LIVE_JIRA_PROJECT_KEYS: value }).services.jira).toBeUndefined();
  expect(readLiveConfig({ ...env, JIRA_API_TOKEN: '' }).services.jira).toBeUndefined();
});
