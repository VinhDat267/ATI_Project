import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MockLLMProvider, validateSchemaValue } from '@wap/planner';
import { MYJIRA_TOOLS, type PlannerResponse } from '@wap/tool-schemas';
import { buildMemory, fixtureSearch, knownResourceValues } from './fixtures.js';
import { evalCatalog, loadEvalFile, parseEvalOptions, runCase } from './run.js';
import { scoreCase, type GoldenCase } from './scorer.js';

const { file } = loadEvalFile('myjira');
const catalog = evalCatalog('myjira');
const siteAcme = 'acme-site';
const siteBeta = 'beta-site';

const golden = (id: string) => file.cases.find(c => c.id === id)!;

describe('personal Jira fixture and runner contract', () => {
  it('registers matching label copies in golden and golden-v2', () => {
    expect(readFileSync('evaluations/golden/cases-myjira.json', 'utf8'))
      .toBe(readFileSync('evaluations/golden-v2/cases-myjira.json', 'utf8'));
    expect(golden('mj06')).toMatchObject({ category: 'read_only', expect: { kind: 'clarification' } });
    expect(golden('mj06').expect.steps).toBeUndefined();
    expect(parseEvalOptions({ EVAL_SET: 'myjira' }).set).toBe('myjira');
  });

  it('discovers personal Jira sites using their schema', async () => {
    const sites = await fixtureSearch({ tool: 'myjira.list_sites', args: { query: '' } });
    expect(validateSchemaValue(sites, MYJIRA_TOOLS[0]!.outputSchema, 'output')).toBeNull();
    expect(sites.map((item: { siteId: string }) => item.siteId)).toEqual([siteAcme, siteBeta]);
    expect([...knownResourceValues('jira_site', 'siteId')]).toContain(siteAcme);
    expect([...knownResourceValues('jira_site', 'siteId')]).toContain(siteBeta);
    expect(buildMemory({ jira_site: siteAcme })).toHaveProperty('jira_site.siteId', siteAcme);
  });

  it('scopes projects and issues by siteId and rejects unknown siteId', async () => {
    const projects = await fixtureSearch({ tool: 'myjira.search_projects', args: { siteId: siteAcme, query: '' } });
    expect(validateSchemaValue(projects, MYJIRA_TOOLS[1]!.outputSchema, 'output')).toBeNull();
    expect(projects.map((p: { key: string }) => p.key)).toEqual(['PROJ', 'WEB']);

    const issues = await fixtureSearch({ tool: 'myjira.search_issues', args: { siteId: siteAcme, projectKey: 'PROJ', query: '' } });
    expect(validateSchemaValue(issues, MYJIRA_TOOLS[2]!.outputSchema, 'output')).toBeNull();
    expect(issues.issues.map((i: { key: string }) => i.key)).toContain('PROJ-1');
    expect(issues.issues.map((i: { key: string }) => i.key)).toContain('PROJ-10');

    await expect(fixtureSearch({ tool: 'myjira.search_projects', args: { siteId: 'unknown-site', query: '' } }))
      .rejects.toThrow(/Unknown fixture jira_site/);
  });

  it('distinguishes duplicate issue keys across different sites', async () => {
    const acmeIssues = await fixtureSearch({ tool: 'myjira.search_issues', args: { siteId: siteAcme, projectKey: 'PROJ', query: '' } });
    const betaIssues = await fixtureSearch({ tool: 'myjira.search_issues', args: { siteId: siteBeta, projectKey: 'PROJ', query: '' } });

    const acme10 = acmeIssues.issues.find((i: { key: string }) => i.key === 'PROJ-10');
    const beta10 = betaIssues.issues.find((i: { key: string }) => i.key === 'PROJ-10');

    expect(acme10).toBeDefined();
    expect(beta10).toBeDefined();
    expect(acme10.id).not.toBe(beta10.id);
    expect(acme10.siteId).toBe(siteAcme);
    expect(beta10.siteId).toBe(siteBeta);
  });

  it('contains prompt injection text in issue title as raw data, not instructions', async () => {
    const issues = await fixtureSearch({ tool: 'myjira.search_issues', args: { siteId: siteAcme, projectKey: 'PROJ', query: 'Security review' } });
    expect(issues.issues).toHaveLength(1);
    expect(issues.issues[0].title).toContain('ignore previous instructions');
  });

  it('scores planned create_issue and add_comment cases accurately', () => {
    const planResponse: PlannerResponse = {
      kind: 'plan',
      thinking: 'Create issue on Acme Jira',
      summary: 'Create issue in PROJ',
      warnings: [],
      steps: [
        {
          id: 'step_1',
          tool: 'myjira.create_issue',
          description: 'Create issue',
          args: { siteId: siteAcme, projectKey: 'PROJ', summary: 'Lỗi đăng nhập SSO' },
          dependsOn: [],
        },
      ],
    };

    const scored = scoreCase(golden('mj01'), planResponse, catalog.tools);
    expect(scored.passed).toBe(true);
    expect(scored.toolsOk).toBe(true);
    expect(scored.argsOk).toBe(true);
  });
});
