import type { ToolDefinition } from './types.js';

const repoProperty = { type: 'string', description: 'Repository owner/name within the configured allowlist' };
const issueNumberProperty = { type: 'number', description: 'GitHub issue number', minimum: 1 };
const limitProperty = { type: 'number', maximum: 10, default: 10 };
const issueProperties = {
  id: { type: 'string' },
  number: { type: 'number' },
  title: { type: 'string' },
  url: { type: 'string' },
  repo: { type: 'string' },
};

export const GITHUB_TOOLS: ToolDefinition[] = [
  {
    name: 'github.search_repos', service: 'github', sideEffect: 'read', riskLevel: 'low',
    description: 'Search connected GitHub repositories by name, returning only allowed repositories.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: limitProperty }, required: ['query'], additionalProperties: false },
    outputSchema: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, name: { type: 'string' }, fullName: { type: 'string' }, url: { type: 'string' },
    }, required: ['id', 'name', 'fullName', 'url'] } },
  },
  {
    name: 'github.search_issues', service: 'github', sideEffect: 'read', riskLevel: 'low',
    description: 'Search issues within one allowed GitHub repository.',
    inputSchema: { type: 'object', properties: { repo: repoProperty, query: { type: 'string' }, limit: limitProperty }, required: ['repo', 'query'], additionalProperties: false },
    outputSchema: { type: 'array', items: { type: 'object', properties: issueProperties, required: ['id', 'number', 'title', 'url', 'repo'] } },
  },
  {
    name: 'github.get_issue', service: 'github', sideEffect: 'read', riskLevel: 'low',
    description: 'Get an issue in one allowed GitHub repository.',
    inputSchema: { type: 'object', properties: { repo: repoProperty, issueNumber: issueNumberProperty }, required: ['repo', 'issueNumber'], additionalProperties: false },
    outputSchema: { type: 'object', properties: {
      ...issueProperties, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } },
    }, required: ['id', 'number', 'title', 'url', 'repo', 'body', 'labels'] },
  },
  {
    name: 'github.create_issue', service: 'github', sideEffect: 'write', riskLevel: 'medium',
    description: 'Create an issue in one allowed GitHub repository after approval.',
    inputSchema: { type: 'object', properties: {
      repo: repoProperty, title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } },
    }, required: ['repo', 'title'], additionalProperties: false },
    outputSchema: { type: 'object', properties: issueProperties, required: ['id', 'number', 'title', 'url', 'repo'] },
  },
  {
    name: 'github.add_label', service: 'github', sideEffect: 'write', riskLevel: 'medium',
    description: 'Add an existing label to an issue in one allowed GitHub repository after approval.',
    inputSchema: { type: 'object', properties: { repo: repoProperty, issueNumber: issueNumberProperty, label: { type: 'string' } }, required: ['repo', 'issueNumber', 'label'], additionalProperties: false },
    outputSchema: { type: 'object', properties: {
      number: { type: 'number' }, labels: { type: 'array', items: { type: 'string' } }, repo: { type: 'string' }, url: { type: 'string' },
    }, required: ['number', 'labels', 'repo', 'url'] },
  },
];
