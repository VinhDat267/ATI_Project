import type { ServiceDefinition } from './types.js';

export const SERVICE_REGISTRY: ServiceDefinition[] = [
  {
    id: 'trello', name: 'Trello', description: 'Task and project management',
    scopes: ['read:boards', 'write:cards', 'write:checklists'], scopeKey: 'boards',
    credentialFields: [
      { key: 'apiKey', label: 'API key', type: 'text' },
      { key: 'token', label: 'API token', type: 'password' },
    ],
    intentKeywords: ['trello', 'card', 'cards', 'board', 'boards', 'list', 'lists', 'checklist', 'thẻ'],
    fallbackIntentKeywords: ['task', 'tasks', 'deadline', 'hạn chót', 'gán'],
    gatherRules: [
      { entityKey: 'board', tool: 'trello.search_boards', pattern: /\b(?:board|bảng)\s+["']?([\p{L}\p{N}_-]+)["']?/iu, invalidates: ['list'] },
      { entityKey: 'list', tool: 'trello.search_lists', pattern: /\b(?:list|danh sách)\s+["']?([\p{L}\p{N}_-]+(?:\s+[\p{L}\p{N}_-]+)?)["']?/iu,
        requires: { entityKey: 'board', argument: 'boardId', searchTool: 'trello.search_boards', question: 'Which board contains this list?', context: 'A board must be selected before searching lists.' } },
      { entityKey: 'member', tool: 'trello.search_members', pattern: /\b(?:member|gán|assign(?:\s+to)?)\s+["']?([\p{L}\p{N}_-]+)["']?/iu,
        requires: { entityKey: 'board', argument: 'boardId', searchTool: 'trello.search_boards', question: 'Which board contains this member?', context: 'A board must be selected before searching members.' } },
    ],
  },
  {
    id: 'slack', name: 'Slack', description: 'Team messaging and notifications',
    scopes: ['chat:write', 'channels:read'], scopeKey: 'channels',
    credentialFields: [{ key: 'botToken', label: 'Bot token', type: 'password' }],
    intentKeywords: ['slack', 'channel', 'channels', 'kênh', 'tin nhắn', 'message', 'notify', 'thông báo'],
    fallbackIntentKeywords: ['báo'],
    gatherRules: [{ entityKey: 'channel', tool: 'slack.search_channels', pattern: /(?:#|\b(?:channel|kênh)\s+)["']?([\p{L}\p{N}_-]+)["']?/iu }],
  },
  {
    id: 'github', name: 'GitHub', description: 'Source code and issue tracking',
    scopes: ['metadata:read', 'issues:read', 'issues:write'], scopeKey: 'repos',
    credentialFields: [{ key: 'token', label: 'Personal access token', type: 'password' }],
    intentKeywords: ['github', 'issue', 'issues', 'repository', 'repositories', 'repo', 'mã nguồn'],
    gatherRules: [{ entityKey: 'repository', tool: 'github.search_repos', pattern: /\b(?:repository|repo)\s+["']?([\p{L}\p{N}_.-]+\/[\p{L}\p{N}_.-]+)["']?/iu, nameField: 'fullName' }],
  },
];

export function getServiceDefinition(id: string): ServiceDefinition | undefined {
  return SERVICE_REGISTRY.find((service) => service.id === id);
}
