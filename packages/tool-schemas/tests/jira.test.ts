import { expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { ALL_TOOLS, getServiceDefinition } from '../src/index.js';

it('exposes four bounded grounded Jira tools and exact project/site metadata', () => {
  const service = getServiceDefinition('jira'); expect(service).toBeDefined();
  expect(service).toMatchObject({ scopeKey: 'projects', scopeLabel: 'Project key', intentKeywords: ['jira', 'ticket'], credentialFields: [{ key: 'siteUrl', type: 'text' }, { key: 'email', type: 'text' }, { key: 'apiToken', type: 'password' }] });
  for (const key of ['AT', 'ATI_123', 'ABCDEFGHIJ']) expect(service!.scopePattern!.test(key)).toBe(true);
  for (const key of ['A', 'ati', '1ATI', 'A-B', 'ABCDEFGHIJK']) expect(service!.scopePattern!.test(key)).toBe(false);
  const tools = ALL_TOOLS.filter(t => t.service === 'jira');
  expect(tools.map(t => t.name)).toEqual(['jira.search_projects', 'jira.search_issues', 'jira.create_issue', 'jira.add_comment']);
  const ajv = new Ajv({ strict: false }); for (const t of tools) { ajv.compile(t.inputSchema); ajv.compile(t.outputSchema); }
  expect(tools[0]).toMatchObject({ discovers: 'project', listable: true });
  expect(tools[1]).toMatchObject({ discovers: 'jira_issue' }); expect(tools[1]!.listable).toBeFalsy();
  expect(tools[1]!.inputSchema.properties.projectKey).toMatchObject({ 'x-resource': 'project', 'x-resource-field': 'key' });
  expect(tools[3]!.inputSchema.properties.issueKey).toMatchObject({ 'x-resource': 'jira_issue', 'x-resource-field': 'key' });
  const valid = (i: number, args: object) => ajv.compile(tools[i]!.inputSchema)(args);
  expect(valid(0, { query: '', limit: 10 })).toBe(true); expect(valid(0, { query: '', limit: 11 })).toBe(false);
  expect(valid(1, { projectKey: 'ATI', limit: 20 })).toBe(true); expect(valid(1, { projectKey: 'ATI', jql: 'project=OTHER' })).toBe(false);
  expect(valid(2, { projectKey: 'ATI', summary: 'X'.repeat(255), description: 'x'.repeat(4000) })).toBe(true);
  expect(valid(2, { projectKey: 'ATI', summary: '' })).toBe(false); expect(valid(2, { projectKey: 'ATI', summary: 'x'.repeat(256) })).toBe(false);
  expect(valid(3, { issueKey: 'ATI-123', body: 'Plain' })).toBe(true); expect(valid(3, { issueKey: 'ATI-123', body: '' })).toBe(false);
  for (const t of tools.slice(2)) expect(t).toMatchObject({ sideEffect: 'write', riskLevel: 'medium' });
});
