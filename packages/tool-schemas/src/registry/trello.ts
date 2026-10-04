import type { ServiceDefinition } from '../types.js';

export const TRELLO_SERVICE: ServiceDefinition = {
    id: 'trello', name: 'Trello', description: 'Task and project management',
    scopes: ['read:boards', 'write:cards', 'write:checklists'], scopeKey: 'boards', scopeLabel: 'Board ID',
    credentialFields: [
      { key: 'apiKey', label: 'API key', type: 'text' },
      { key: 'token', label: 'API token', type: 'password' },
    ],
    intentKeywords: ['trello', 'card', 'cards', 'board', 'boards', 'list', 'lists', 'checklist', 'thẻ'],
    // A creation verb makes "task" a work item to create, not a reference such as "about task X".
    intentPatterns: [/(?<![\p{L}\p{N}_])(?:tạo|thêm|giao|create|add|assign)\s+(?:(?:một|1|a|an|new)\s+)?(?:task|tasks|công việc|việc)(?![\p{L}\p{N}_])/iu],
    fallbackIntentKeywords: ['task', 'tasks', 'deadline', 'hạn chót', 'gán'],
    gatherRules: [
      { entityKey: 'board', tool: 'trello.search_boards', pattern: /\b(?:board|bảng)\s+["']?([\p{L}\p{N}_-]+)["']?/iu, invalidates: ['list'] },
      { entityKey: 'list', tool: 'trello.search_lists', pattern: /\b(?:list|danh sách)\s+["']?([\p{L}\p{N}_-]+(?:\s+[\p{L}\p{N}_-]+)?)["']?/iu,
        requires: { entityKey: 'board', argument: 'boardId', searchTool: 'trello.search_boards', question: 'Danh sách này nằm trong board nào?', context: 'Cần chọn board trước khi tra cứu danh sách.' } },
      { entityKey: 'member', tool: 'trello.search_members', pattern: /\b(?:member|gán|assign(?:\s+to)?)\s+["']?([\p{L}\p{N}_-]+)["']?/iu,
        requires: { entityKey: 'board', argument: 'boardId', searchTool: 'trello.search_boards', question: 'Thành viên này thuộc board nào?', context: 'Cần chọn board trước khi tra cứu thành viên.' } },
    ]
  };
