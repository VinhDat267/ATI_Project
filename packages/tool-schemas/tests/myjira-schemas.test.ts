import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import {
  MYJIRA_TOOLS,
  MYJIRA_SCOPES,
  JIRA_SITE_ID_PATTERN,
  JIRA_CLOUD_ID_PATTERN,
} from '../src/myjira.js';

describe('myjira tool schemas', () => {
  const ajv = new Ajv({ strict: false });

  it('exports exactly 5 myjira tools with correct service and side-effect properties', () => {
    expect(MYJIRA_TOOLS).toHaveLength(5);
    const names = MYJIRA_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      'myjira.list_sites',
      'myjira.search_projects',
      'myjira.search_issues',
      'myjira.create_issue',
      'myjira.add_comment',
    ]);

    for (const tool of MYJIRA_TOOLS) {
      expect(tool.service).toBe('myjira');
      expect(() => ajv.compile(tool.inputSchema)).not.toThrow();
      expect(() => ajv.compile(tool.outputSchema)).not.toThrow();
    }
  });

  it('defines Atlassian 3LO scopes and id patterns correctly', () => {
    expect(MYJIRA_SCOPES).toEqual([
      'offline_access',
      'read:me',
      'read:jira-work',
      'write:jira-work',
    ]);

    expect(JIRA_SITE_ID_PATTERN.test('site-123_abc')).toBe(true);
    expect(JIRA_SITE_ID_PATTERN.test('')).toBe(false);
    expect(JIRA_SITE_ID_PATTERN.test('a'.repeat(65))).toBe(false);
    expect(JIRA_SITE_ID_PATTERN.test('site/invalid')).toBe(false);

    expect(JIRA_CLOUD_ID_PATTERN.test('12345678-1234-1234-1234-123456789abc')).toBe(true);
    expect(JIRA_CLOUD_ID_PATTERN.test('not-a-uuid')).toBe(false);
  });

  it('configures myjira.list_sites as a listable read tool discovering jira_site', () => {
    const tool = MYJIRA_TOOLS.find((t) => t.name === 'myjira.list_sites')!;
    expect(tool).toBeDefined();
    expect(tool.sideEffect).toBe('read');
    expect(tool.riskLevel).toBe('low');
    expect(tool.discovers).toBe('jira_site');
    expect(tool.listable).toBe(true);
    expect((tool as any).observedFields).toEqual(['id', 'siteId', 'cloudId', 'name', 'url']);

    const validateInput = ajv.compile(tool.inputSchema);
    expect(validateInput({ query: '', limit: 10 })).toBe(true);
    expect(validateInput({ query: 'team site' })).toBe(true);
    expect(validateInput({ query: '', limit: 0 })).toBe(false);
    expect(validateInput({ query: '', limit: 11 })).toBe(false);
    expect(validateInput({})).toBe(false); // query is required
    expect(validateInput({ query: 'a'.repeat(2001) })).toBe(false); // bounded query length
    expect(validateInput({ query: '', limit: 10, rogueField: true })).toBe(false); // no arbitrary args

    const validateOutput = ajv.compile(tool.outputSchema);
    expect((tool.outputSchema as any).items.required).toContain('id');
    expect(validateOutput([
      { id: 'site-1', siteId: 'site-1', cloudId: '12345678-1234-1234-1234-123456789abc', name: 'Site 1', url: 'https://site1.atlassian.net' }
    ])).toBe(true);
    expect(validateOutput([])).toBe(true);
    // Missing id alias is rejected
    expect(validateOutput([
      { siteId: 'site-1', cloudId: '12345678-1234-1234-1234-123456789abc', name: 'Site 1', url: 'https://site1.atlassian.net' }
    ])).toBe(false);
    expect(validateOutput([{ siteId: 'site-1' }])).toBe(false);
  });

  it('configures myjira.search_projects with siteId and discovers jira_project', () => {
    const tool = MYJIRA_TOOLS.find((t) => t.name === 'myjira.search_projects')!;
    expect(tool).toBeDefined();
    expect(tool.sideEffect).toBe('read');
    expect(tool.riskLevel).toBe('low');
    expect(tool.discovers).toBe('jira_project');
    expect(tool.listable).toBe(true);
    expect((tool as any).observedFields).toEqual(['id', 'key', 'name', 'siteId']);

    expect(tool.inputSchema.properties.siteId).toMatchObject({
      'x-resource': 'jira_site',
      'x-resource-field': 'siteId',
    });

    const validateInput = ajv.compile(tool.inputSchema);
    expect(validateInput({ siteId: 'site-1', query: '', limit: 20 })).toBe(true);
    expect(validateInput({ siteId: 'site-1', query: 'proj' })).toBe(true);
    expect(validateInput({ query: '' })).toBe(false); // missing siteId
    expect(validateInput({ siteId: 'site/invalid', query: '' })).toBe(false); // invalid pattern
    expect(validateInput({ siteId: 'site-1', query: '', limit: 21 })).toBe(false);
    expect(validateInput({ siteId: 'site-1', query: 'a'.repeat(2001) })).toBe(false);
    expect(validateInput({ siteId: 'site-1', query: '', limit: 20, arbitraryJql: 'project = FOO' })).toBe(false);

    const validateOutput = ajv.compile(tool.outputSchema);
    expect(validateOutput([
      { siteId: 'site-1', id: '10001', key: 'PROJ', name: 'Project 1' }
    ])).toBe(true);
    expect(validateOutput([{ key: 'PROJ' }])).toBe(false);
  });

  it('configures myjira.search_issues with siteId, projectKey and discovers jira_issue', () => {
    const tool = MYJIRA_TOOLS.find((t) => t.name === 'myjira.search_issues')!;
    expect(tool).toBeDefined();
    expect(tool.sideEffect).toBe('read');
    expect(tool.riskLevel).toBe('low');
    expect(tool.discovers).toBe('jira_issue');
    expect(tool.listable).toBe(false);
    expect((tool as any).observedFields).toEqual(['id', 'key', 'title', 'url', 'status', 'siteId']);

    expect(tool.inputSchema.properties.siteId).toMatchObject({
      'x-resource': 'jira_site',
      'x-resource-field': 'siteId',
    });
    expect(tool.inputSchema.properties.projectKey).toMatchObject({
      'x-resource': 'jira_project',
      'x-resource-field': 'key',
    });

    const validateInput = ajv.compile(tool.inputSchema);
    expect(validateInput({ siteId: 'site-1', projectKey: 'PROJ', query: 'urgent', limit: 10 })).toBe(true);
    expect(validateInput({ siteId: 'site-1', projectKey: 'PROJ' })).toBe(true);
    expect(validateInput({ siteId: 'site-1', projectKey: 'invalid-proj-key' })).toBe(false);
    expect(validateInput({ projectKey: 'PROJ' })).toBe(false); // missing siteId
    expect(validateInput({ siteId: 'site-1' })).toBe(false); // missing projectKey
    expect(validateInput({ siteId: 'site-1', projectKey: 'PROJ', query: 'a'.repeat(2001) })).toBe(false);
    expect(validateInput({ siteId: 'site-1', projectKey: 'PROJ', jql: 'status = Open' })).toBe(false); // arbitrary JQL forbidden

    const validateOutput = ajv.compile(tool.outputSchema);
    expect(validateOutput({
      issues: [
        { siteId: 'site-1', id: '10002', key: 'PROJ-1', url: 'https://site.net/browse/PROJ-1', title: 'Issue 1', status: 'To Do' }
      ]
    })).toBe(true);
    expect(validateOutput({ issues: [] })).toBe(true);
    expect(validateOutput({})).toBe(false);
  });

  it('configures myjira.create_issue with medium risk and write sideEffect', () => {
    const tool = MYJIRA_TOOLS.find((t) => t.name === 'myjira.create_issue')!;
    expect(tool).toBeDefined();
    expect(tool.sideEffect).toBe('write');
    expect(tool.riskLevel).toBe('medium');

    expect(tool.inputSchema.properties.siteId).toMatchObject({
      'x-resource': 'jira_site',
      'x-resource-field': 'siteId',
    });
    expect(tool.inputSchema.properties.projectKey).toMatchObject({
      'x-resource': 'jira_project',
      'x-resource-field': 'key',
    });

    const validateInput = ajv.compile(tool.inputSchema);
    expect(validateInput({
      siteId: 'site-1',
      projectKey: 'PROJ',
      summary: 'Task summary',
      description: 'Detail text',
      issueType: 'Task',
    })).toBe(true);
    expect(validateInput({
      siteId: 'site-1',
      projectKey: 'PROJ',
      summary: 'Minimal summary',
    })).toBe(true);
    expect(validateInput({ siteId: 'site-1', projectKey: 'PROJ', summary: '' })).toBe(false);
    expect(validateInput({ siteId: 'site-1', projectKey: 'PROJ', summary: 'a'.repeat(256) })).toBe(false);
    expect(validateInput({ siteId: 'site-1', projectKey: 'PROJ' })).toBe(false); // missing summary
    expect(validateInput({ siteId: 'site-1', projectKey: 'PROJ', summary: 'Valid', description: 'a'.repeat(4001) })).toBe(false);
    expect(validateInput({ siteId: 'site-1', projectKey: 'PROJ', summary: 'Valid', issueType: 'a'.repeat(256) })).toBe(false);
    expect(validateInput({ siteId: 'site-1', projectKey: 'PROJ', summary: 'Valid', arbitraryUrl: 'https://evil.com' })).toBe(false);

    const validateOutput = ajv.compile(tool.outputSchema);
    expect(validateOutput({
      siteId: 'site-1',
      id: '10003',
      key: 'PROJ-2',
      url: 'https://site.net/browse/PROJ-2',
    })).toBe(true);
    expect(validateOutput({ id: '10003', key: 'PROJ-2' })).toBe(false); // missing siteId and url
  });

  it('configures myjira.add_comment with medium risk and write sideEffect', () => {
    const tool = MYJIRA_TOOLS.find((t) => t.name === 'myjira.add_comment')!;
    expect(tool).toBeDefined();
    expect(tool.sideEffect).toBe('write');
    expect(tool.riskLevel).toBe('medium');

    expect(tool.inputSchema.properties.siteId).toMatchObject({
      'x-resource': 'jira_site',
      'x-resource-field': 'siteId',
    });
    expect(tool.inputSchema.properties.issueKey).toMatchObject({
      'x-resource': 'jira_issue',
      'x-resource-field': 'key',
    });

    const validateInput = ajv.compile(tool.inputSchema);
    expect(validateInput({
      siteId: 'site-1',
      issueKey: 'PROJ-1',
      body: 'Comment text',
    })).toBe(true);
    expect(validateInput({ siteId: 'site-1', issueKey: 'PROJ-1', body: '' })).toBe(false);
    expect(validateInput({ siteId: 'site-1', issueKey: 'invalid-key', body: 'Comment text' })).toBe(false);
    expect(validateInput({ siteId: 'site-1', body: 'Comment text' })).toBe(false); // missing issueKey
    expect(validateInput({ siteId: 'site-1', issueKey: 'PROJ-1', body: 'a'.repeat(4001) })).toBe(false);
    expect(validateInput({ siteId: 'site-1', issueKey: 'PROJ-1', body: 'Comment', extraPayload: {} })).toBe(false);

    const validateOutput = ajv.compile(tool.outputSchema);
    expect(validateOutput({
      siteId: 'site-1',
      id: '20001',
      issueKey: 'PROJ-1',
      url: 'https://site.net/browse/PROJ-1?focusedCommentId=20001',
    })).toBe(true);
    expect(validateOutput({ id: '20001', issueKey: 'PROJ-1' })).toBe(false); // missing siteId and url
  });

  it('enforces strict additionalProperties: false on all tool schemas to prevent arbitrary URL or JQL injection', () => {
    for (const tool of MYJIRA_TOOLS) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      if (tool.outputSchema.type === 'object') {
        expect(tool.outputSchema.additionalProperties).toBe(false);
      }
    }
  });
});
