import type { ToolDefinition } from './types.js';

const repoProperty = {
  type: 'string', description: 'Repository owner/name within the configured allowlist',
  'x-resource': 'repository', 'x-resource-field': 'fullName',
};
const issueNumberProperty = {
  type: 'number', description: 'GitHub issue number', minimum: 1,
  'x-resource': 'issue', 'x-resource-field': 'number',
};
const repoLimitProperty = { type: 'number', minimum: 1, maximum: 10, default: 10 };
const searchIssueLimitProperty = { type: 'number', minimum: 1, maximum: 20, default: 10 };
const issueLimitProperty = { type: 'number', minimum: 1, maximum: 50, default: 10 };
const issueProperties = {
  id: { type: 'string' },
  number: { type: 'number' },
  title: { type: 'string' },
  url: { type: 'string' },
  repo: { type: 'string' },
  state: { type: 'string' },
  author: { type: 'string' },
  labels: { type: 'array', items: { type: 'string' } },
  assignees: { type: 'array', items: { type: 'string' } },
  commentsCount: { type: 'number' },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
};

export const GITHUB_TOOLS: ToolDefinition[] = [
  {
    name: 'github.search_repos', service: 'github', discovers: 'repository', listable: true, sideEffect: 'read', riskLevel: 'low',
    description: 'Search connected GitHub repositories by name, returning only allowed repositories.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: repoLimitProperty }, required: ['query'], additionalProperties: false },
    outputSchema: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, name: { type: 'string' }, fullName: { type: 'string' }, url: { type: 'string' },
    }, required: ['id', 'name', 'fullName', 'url'] } },
  },
  {
    name: 'github.search_issues', service: 'github', discovers: 'issue', sideEffect: 'read', riskLevel: 'low',
    description: 'Search issues within one allowed GitHub repository.',
    inputSchema: { type: 'object', properties: { repo: repoProperty, query: { type: 'string' }, limit: searchIssueLimitProperty }, required: ['repo', 'query'], additionalProperties: false },
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
      repo: repoProperty, title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } }, assignees: { type: 'array', items: { type: 'string' } },
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

export const GITHUB_OAUTH_TOOLS: ToolDefinition[] = [
  {
    name: 'github.get_pull_request', service: 'github', sideEffect: 'read', riskLevel: 'low',
    description: 'Get pull request details in one allowed GitHub repository.',
    inputSchema: { type: 'object', properties: { repo: repoProperty, issueNumber: issueNumberProperty }, required: ['repo', 'issueNumber'], additionalProperties: false },
    outputSchema: { type: 'object', properties: {
      ...issueProperties,
      body: { type: 'string' },
      labels: { type: 'array', items: { type: 'string' } },
      state: { type: 'string' },
      isPullRequest: { type: 'boolean' },
      draft: { type: 'boolean' },
      merged: { type: 'boolean' },
      headRef: { type: 'string' },
      baseRef: { type: 'string' },
      requestedReviewers: { type: 'array', items: { type: 'string' } },
    }, required: ['id', 'number', 'title', 'url', 'repo', 'body', 'labels'] },
  },
  {
    name: 'github.list_comments', service: 'github', sideEffect: 'read', riskLevel: 'low',
    description: 'List comments on an issue or pull request in one allowed GitHub repository.',
    inputSchema: {
      type: 'object',
      properties: { repo: repoProperty, issueNumber: issueNumberProperty, limit: issueLimitProperty },
      required: ['repo', 'issueNumber'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          issueNumber: { type: 'number' },
          author: { type: 'string' },
          body: { type: 'string' },
          url: { type: 'string' },
          repo: { type: 'string' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
        required: ['id', 'issueNumber', 'author', 'body', 'url', 'repo'],
      },
    },
  },
  {
    name: 'github.update_issue', service: 'github', sideEffect: 'write', riskLevel: 'medium',
    description: 'Update an issue (title, body, state open/closed, labels, or assignees) in one allowed GitHub repository after approval.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: repoProperty,
        issueNumber: issueNumberProperty,
        title: { type: 'string' },
        body: { type: 'string' },
        state: { type: 'string', enum: ['open', 'closed'] },
        labels: { type: 'array', items: { type: 'string' } },
        assignees: { type: 'array', items: { type: 'string' } },
      },
      required: ['repo', 'issueNumber'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ...issueProperties,
        state: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        assignees: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'number', 'title', 'url', 'repo', 'state'],
    },
  },
  {
    name: 'github.add_comment', service: 'github', sideEffect: 'write', riskLevel: 'medium',
    description: 'Add a comment to an issue or pull request in one allowed GitHub repository after approval.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: repoProperty,
        issueNumber: issueNumberProperty,
        body: { type: 'string' },
      },
      required: ['repo', 'issueNumber', 'body'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        issueNumber: { type: 'number' },
        body: { type: 'string' },
        repo: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['id', 'issueNumber', 'body', 'repo', 'url'],
    },
  },
  {
    name: 'github.create_pull_request', service: 'github', sideEffect: 'write', riskLevel: 'medium',
    description: 'Create a pull request from head branch into base branch in one allowed GitHub repository after approval.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: repoProperty,
        title: { type: 'string' },
        head: { type: 'string', description: 'Source branch name (or user:branch)' },
        base: { type: 'string', description: 'Target base branch name (e.g. main)' },
        body: { type: 'string' },
        draft: { type: 'boolean' },
      },
      required: ['repo', 'title', 'head', 'base'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ...issueProperties,
        state: { type: 'string' },
        draft: { type: 'boolean' },
        headRef: { type: 'string' },
        baseRef: { type: 'string' },
      },
      required: ['id', 'number', 'title', 'url', 'repo', 'state'],
    },
  },
  {
    name: 'github.request_reviewers', service: 'github', sideEffect: 'write', riskLevel: 'medium',
    description: 'Request one or more GitHub users to review a pull request in one allowed GitHub repository after approval.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: repoProperty,
        issueNumber: issueNumberProperty,
        reviewers: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' } },
      },
      required: ['repo', 'issueNumber', 'reviewers'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        number: { type: 'number' },
        reviewers: { type: 'array', items: { type: 'string' } },
        repo: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['number', 'reviewers', 'repo', 'url'],
    },
  },
  {
    name: 'github.list_issues', service: 'github', discovers: 'issue', sideEffect: 'read', riskLevel: 'low',
    description: 'List issues across allowed GitHub repositories or within one allowed repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: repoProperty,
        state: { type: 'string', enum: ['open', 'closed'] },
        query: { type: 'string' },
        limit: issueLimitProperty,
      },
      required: [],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: issueProperties,
        required: ['id', 'number', 'title', 'url', 'repo'],
      },
    },
  },
  {
    name: 'github.list_pull_requests', service: 'github', discovers: 'issue', sideEffect: 'read', riskLevel: 'low',
    observedFields: ['id', 'number', 'title', 'url', 'repo', 'state', 'author', 'draft'],
    description: 'List and filter pull requests (PRs) by state (open, closed, all) or keyword across allowed GitHub repositories or within one allowed repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: repoProperty,
        state: { type: 'string', enum: ['open', 'closed', 'all'] },
        query: { type: 'string' },
        limit: issueLimitProperty,
      },
      required: [],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ...issueProperties,
          state: { type: 'string' },
          author: { type: 'string' },
          draft: { type: 'boolean' },
          requestedReviewers: { type: 'array', items: { type: 'string' } },
          headRef: { type: 'string' },
          baseRef: { type: 'string' },
        },
        required: ['id', 'number', 'title', 'url', 'repo', 'state'],
      },
    },
  },
];
