import { describe, expect, it } from 'vitest';
import { MYJIRA_TOOLS } from '@wap/tool-schemas';
import { validatePlan } from '../src/validator.js';
import { recordObserved } from '../src/search.js';

const plan = (steps: unknown[]) => JSON.stringify({
  kind: 'plan', thinking: 'Use Jira tools', summary: 'Update Jira', warnings: [], steps,
});

const comment = (siteId: string, issueKey: unknown, id = 'step_1', dependsOn: string[] = []) => ({
  id, tool: 'myjira.add_comment', description: 'Comment', args: { siteId, issueKey, body: 'Reviewed' }, dependsOn,
});

const createIssue = (siteId: string, projectKey: string, id = 'step_1', summary = 'New task') => ({
  id, tool: 'myjira.create_issue', description: 'Create issue', args: { siteId, projectKey, summary }, dependsOn: [],
});

const memory = {
  jira_site: [
    { id: 'site-a', siteId: 'site-a', cloudId: 'cloud-a', name: 'Acme Jira', url: 'https://acme.atlassian.net' },
    { id: 'site-b', siteId: 'site-b', cloudId: 'cloud-b', name: 'Beta Jira', url: 'https://beta.atlassian.net' },
  ],
  jira_issue: [
    { id: '100', key: 'ATI-12', siteId: 'site-a' },
  ],
  jira_project: [
    { id: '1001', key: 'PROJ', siteId: 'site-a', name: 'Acme Project' },
  ],
};

describe('Jira site grounding', () => {
  it('rejects an issue observed only on another site', () => {
    const result = validatePlan(plan([comment('site-b', 'ATI-12')]), MYJIRA_TOOLS, {
      grounding: { memory, userTexts: ['site-b'] },
    });
    expect(result.valid).toBe(false);
    expect(result.layer).toBe('grounding');
  });

  it('accepts an issue observed in the selected site when site is specified', () => {
    const result = validatePlan(plan([comment('site-a', 'ATI-12')]), MYJIRA_TOOLS, {
      grounding: { memory, userTexts: ['cập nhật trên site-a'] },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects cross-site reference between steps targeting different sites', () => {
    const steps = [
      createIssue('site-a', 'PROJ', 'step_1', 'Create feature'),
      comment('site-b', { $ref: 'step_1.output.key' }, 'step_2', ['step_1']),
    ];
    const result = validatePlan(plan(steps), MYJIRA_TOOLS, {
      grounding: { memory, userTexts: ['site-a', 'site-b'] },
    });
    expect(result.valid).toBe(false);
    expect(result.layer).toBe('semantic');
    expect(result.error).toMatch(/cross-site reference/i);
  });

  it('accepts intra-site reference between steps targeting the same site', () => {
    const steps = [
      createIssue('site-a', 'PROJ', 'step_1', 'Create feature'),
      comment('site-a', { $ref: 'step_1.output.key' }, 'step_2', ['step_1']),
    ];
    const result = validatePlan(plan(steps), MYJIRA_TOOLS, {
      grounding: { memory, userTexts: ['site-a'] },
    });
    expect(result.valid).toBe(true);
  });

  it('keeps duplicate issue keys and IDs across sites as distinct entities in working memory', () => {
    let observed: Record<string, Array<Record<string, unknown>>> = {};
    observed = recordObserved(observed, 'jira_issue', [
      { id: '100', key: 'ATI-12', siteId: 'site-a', cloudId: 'cloud-a', title: 'Task on Site A' },
    ], ['id', 'key', 'siteId', 'cloudId', 'title']);

    observed = recordObserved(observed, 'jira_issue', [
      { id: '100', key: 'ATI-12', siteId: 'site-b', cloudId: 'cloud-b', title: 'Task on Site B' },
    ], ['id', 'key', 'siteId', 'cloudId', 'title']);

    expect(observed.jira_issue).toHaveLength(2);
    expect(observed.jira_issue.some(e => e.siteId === 'site-a' && e.id === '100')).toBe(true);
    expect(observed.jira_issue.some(e => e.siteId === 'site-b' && e.id === '100')).toBe(true);
  });

  it('keeps entities with same siteId and id distinct when workspace or cloud differs', () => {
    let observed: Record<string, Array<Record<string, unknown>>> = {};
    observed = recordObserved(observed, 'jira_issue', [
      { id: '100', key: 'ATI-12', siteId: 'site-a', cloudId: 'cloud-1', workspaceId: 'ws-1', title: 'Task in WS1 Cloud1' },
    ]);

    observed = recordObserved(observed, 'jira_issue', [
      { id: '100', key: 'ATI-12', siteId: 'site-a', cloudId: 'cloud-2', workspaceId: 'ws-1', title: 'Task in WS1 Cloud2' },
    ]);

    observed = recordObserved(observed, 'jira_issue', [
      { id: '100', key: 'ATI-12', siteId: 'site-a', cloudId: 'cloud-1', workspaceId: 'ws-2', title: 'Task in WS2 Cloud1' },
    ]);

    expect(observed.jira_issue).toHaveLength(3);
  });

  it('rejects user-typed siteId when not present in verified site catalog', () => {
    const result = validatePlan(plan([createIssue('site-unverified', 'PROJ')]), MYJIRA_TOOLS, {
      grounding: { memory, userTexts: ['tạo ticket trong project PROJ trên site-unverified'] },
    });
    expect(result.valid).toBe(false);
    expect(result.layer).toBe('grounding');
    expect(result.ungrounded?.some(u => u.argument === 'siteId' && u.value === 'site-unverified')).toBe(true);
  });

  it('rejects ambiguous site destination when multiple sites exist and user did not specify target site', () => {
    // Both site-a and site-b exist in memory, but user just asked "Cập nhật ticket ATI-12" without naming a site
    const result = validatePlan(plan([comment('site-a', 'ATI-12')]), MYJIRA_TOOLS, {
      grounding: { memory, userTexts: ['Cập nhật ticket ATI-12'] },
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/ambiguous.*site/i);
  });

  it('accepts short site name like "Acme" when multiple sites exist', () => {
    const result = validatePlan(plan([comment('site-a', 'ATI-12')]), MYJIRA_TOOLS, {
      grounding: { memory, userTexts: ['Cập nhật ticket ATI-12 trên Acme'] },
    });
    expect(result.valid).toBe(true);
  });

  it('accepts subdomain from site URL when multiple sites exist', () => {
    const result = validatePlan(plan([comment('site-a', 'ATI-12')]), MYJIRA_TOOLS, {
      grounding: { memory, userTexts: ['xem ticket ATI-12 bên acme'] },
    });
    expect(result.valid).toBe(true);
  });

  it('preserves workspaceId and cloudId in observed entities even with custom observedFields', () => {
    let observed: Record<string, Array<Record<string, unknown>>> = {};
    observed = recordObserved(
      observed,
      'jira_issue',
      [
        { id: '100', key: 'ATI-12', siteId: 'site-a', cloudId: 'cloud-1', workspaceId: 'ws-1', title: 'Task in WS1' },
      ],
      ['id', 'key', 'title', 'url', 'status', 'siteId']
    );

    expect(observed.jira_issue[0].cloudId).toBe('cloud-1');
    expect(observed.jira_issue[0].workspaceId).toBe('ws-1');
    expect(observed.jira_issue[0].siteId).toBe('site-a');
  });

  it('accepts single site from context when only one site is connected', () => {
    const singleSiteMemory = {
      jira_site: [{ id: 'site-a', siteId: 'site-a', cloudId: 'cloud-a', name: 'Acme Jira' }],
      jira_issue: [{ id: '100', key: 'ATI-12', siteId: 'site-a' }],
    };
    const result = validatePlan(plan([comment('site-a', 'ATI-12')]), MYJIRA_TOOLS, {
      grounding: { memory: singleSiteMemory, userTexts: ['Cập nhật ticket ATI-12'] },
    });
    expect(result.valid).toBe(true);
  });
});
