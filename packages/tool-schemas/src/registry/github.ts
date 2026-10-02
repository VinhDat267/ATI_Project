import type { ServiceDefinition } from '../types.js';

export const GITHUB_SERVICE: ServiceDefinition = {
    id: 'github', name: 'GitHub', description: 'Source code and issue tracking',
    scopes: ['metadata:read', 'issues:read', 'issues:write'], scopeKey: 'repos', scopeLabel: 'Repository',
    scopePattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
    credentialFields: [{ key: 'token', label: 'Personal access token', type: 'password' }],
    intentKeywords: ['github', 'issue', 'issues', 'repository', 'repositories', 'repo', 'mã nguồn'],
    gatherRules: [{ entityKey: 'repository', tool: 'github.search_repos', pattern: /\b(?:repository|repo)\s+["']?([\p{L}\p{N}_.-]+\/[\p{L}\p{N}_.-]+)["']?/iu, nameField: 'fullName' }],
  };
