import { describe, expect, it } from 'vitest';
import { MYJIRA_TOOLS, ALL_TOOLS, SERVICE_REGISTRY, MYJIRA_SERVICE } from '@wap/tool-schemas';
import { validatePlan } from '../src/validator.js';
import { recordObserved, groundingMemory } from '../src/search.js';
import { AIPlanner, WorkingMemory } from '../src/index.js';

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
    { id: 'site-a', siteId: 'site-a', cloudId: 'cloud-a', workspaceId: 'ws-1', name: 'Acme Jira', url: 'https://acme.atlassian.net' },
    { id: 'site-b', siteId: 'site-b', cloudId: 'cloud-b', workspaceId: 'ws-1', name: 'Beta Jira', url: 'https://beta.atlassian.net' },
  ],
  jira_issue: [
    { id: '100', key: 'ATI-12', siteId: 'site-a', cloudId: 'cloud-a', workspaceId: 'ws-1' },
  ],
  jira_project: [
    { id: '1001', key: 'PROJ', siteId: 'site-a', cloudId: 'cloud-a', workspaceId: 'ws-1', name: 'Acme Project' },
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

  it('rejects partial word match like "Acme2" from selecting site "Acme"', () => {
    const result = validatePlan(plan([comment('site-a', 'ATI-12')]), MYJIRA_TOOLS, {
      grounding: { memory, userTexts: ['Cập nhật ticket ATI-12 trên Acme2'] },
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/ambiguous.*site/i);
  });

  it('rejects Jira resource when observed entity lacks mandatory cloudId or workspaceId', () => {
    const missingCloudMemory = {
      ...memory,
      jira_issue: [{ id: '100', key: 'ATI-12', siteId: 'site-a', workspaceId: 'ws-1' }],
    };
    const result = validatePlan(plan([comment('site-a', 'ATI-12')]), MYJIRA_TOOLS, {
      grounding: { memory: missingCloudMemory, userTexts: ['site-a'] },
    });
    expect(result.valid).toBe(false);
    expect(result.layer).toBe('grounding');
  });

  it('rejects plan when target site lacks mandatory cloudId or workspaceId', () => {
    const missingSiteScopeMemory = {
      ...memory,
      jira_site: [
        { id: 'site-a', siteId: 'site-a', name: 'Acme Jira' },
      ],
    };
    const result = validatePlan(plan([comment('site-a', 'ATI-12')]), MYJIRA_TOOLS, {
      grounding: { memory: missingSiteScopeMemory, userTexts: ['site-a'] },
    });
    expect(result.valid).toBe(false);
    expect(result.layer).toBe('grounding');
  });

  it('executes full flow: list_sites -> search_projects/search_issues -> attaches scope info from __observed.jira_site -> validatePlan', async () => {
    const mem = new WorkingMemory();
    const actor = { userId: 'u-1', workspaceId: 'ws-ati-corp' };

    const searchResults: Record<string, unknown> = {
      'myjira.list_sites': [
        { id: 'site-acme', siteId: 'site-acme', cloudId: 'cloud-acme-123', name: 'Acme Jira', url: 'https://acme.atlassian.net' },
        { id: 'site-beta', siteId: 'site-beta', cloudId: 'cloud-beta-456', name: 'Beta Jira', url: 'https://beta.atlassian.net' },
      ],
      'myjira.search_projects': [
        { id: '1001', key: 'PROJ', name: 'Project Acme', siteId: 'site-acme' },
      ],
      'myjira.search_issues': [
        { id: '10042', key: 'ATI-42', title: 'Login Bug', status: 'Open', url: 'https://acme.atlassian.net/browse/ATI-42', siteId: 'site-acme' },
      ],
    };

    const scriptedOutputs = [
      { kind: 'search', thinking: 'find sites', calls: [{ tool: 'myjira.list_sites', args: { query: '' } }] },
      {
        kind: 'search',
        thinking: 'find project and issue',
        calls: [
          { tool: 'myjira.search_projects', args: { siteId: 'site-acme', query: 'PROJ' } },
          { tool: 'myjira.search_issues', args: { siteId: 'site-acme', projectKey: 'PROJ' } },
        ],
      },
      {
        kind: 'plan',
        thinking: 'create issue and comment on site-acme',
        summary: 'Work on Acme Jira',
        warnings: [],
        steps: [
          { id: 'step_1', tool: 'myjira.create_issue', description: 'Create task', args: { siteId: 'site-acme', projectKey: 'PROJ', summary: 'New task' }, dependsOn: [] },
          { id: 'step_2', tool: 'myjira.add_comment', description: 'Add comment', args: { siteId: 'site-acme', issueKey: 'ATI-42', body: 'Reviewed' }, dependsOn: ['step_1'] },
        ],
      },
    ];

    const inputs: any[] = [];
    const provider = {
      name: 'mock-llm',
      async generatePlan(input: any) {
        inputs.push(structuredClone(input));
        return JSON.stringify(scriptedOutputs[inputs.length - 1]);
      },
    };

    const planner = new AIPlanner({
      provider,
      toolCatalog: [...ALL_TOOLS.filter(t => t.service !== 'jira'), ...MYJIRA_TOOLS],
      serviceRegistry: [...SERVICE_REGISTRY, MYJIRA_SERVICE],
      searchMode: 'llm',
      prefetchDirectory: false,
      requireGroundedResources: true,
      gatherSearch: async ({ tool }: any) => {
        return searchResults[tool] ?? [];
      },
    });

    const response = await planner.processMessage({
      userMessage: 'Tạo ticket trong project PROJ và bình luận vào ATI-42 trên Acme',
      memory: mem,
      actor,
    });

    expect(response.kind).toBe('plan');
    if (response.kind === 'plan') {
      expect(response.steps).toHaveLength(2);
    }

    const observed = mem.getEntity<Record<string, Array<Record<string, unknown>>>>('__observed')!;
    expect(observed.jira_site).toHaveLength(2);
    expect(observed.jira_site[0].workspaceId).toBe('ws-ati-corp');
    expect(observed.jira_site[0].cloudId).toBe('cloud-acme-123');

    expect(observed.jira_project).toHaveLength(1);
    expect(observed.jira_project[0].siteId).toBe('site-acme');
    expect(observed.jira_project[0].cloudId).toBe('cloud-acme-123');
    expect(observed.jira_project[0].workspaceId).toBe('ws-ati-corp');

    expect(observed.jira_issue).toHaveLength(1);
    expect(observed.jira_issue[0].siteId).toBe('site-acme');
    expect(observed.jira_issue[0].cloudId).toBe('cloud-acme-123');
    expect(observed.jira_issue[0].workspaceId).toBe('ws-ati-corp');

    const planStr = JSON.stringify(scriptedOutputs[2]);
    const validated = validatePlan(planStr, MYJIRA_TOOLS, {
      grounding: {
        memory: groundingMemory(mem.getAll(), observed),
        userTexts: ['Tạo ticket trong project PROJ và bình luận vào ATI-42 trên Acme'],
      },
    });
    expect(validated.valid).toBe(true);
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
      jira_site: [{ id: 'site-a', siteId: 'site-a', cloudId: 'cloud-a', workspaceId: 'ws-1', name: 'Acme Jira' }],
      jira_issue: [{ id: '100', key: 'ATI-12', siteId: 'site-a', cloudId: 'cloud-a', workspaceId: 'ws-1' }],
    };
    const result = validatePlan(plan([comment('site-a', 'ATI-12')]), MYJIRA_TOOLS, {
      grounding: { memory: singleSiteMemory, userTexts: ['Cập nhật ticket ATI-12'] },
    });
    expect(result.valid).toBe(true);
  });
});
