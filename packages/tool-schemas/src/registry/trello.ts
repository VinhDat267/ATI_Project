import type { ServiceDefinition } from '../types.js';

export const TRELLO_SERVICE: ServiceDefinition = {
    id: 'trello', name: 'Trello', description: 'Task and project management',
    scopes: ['read:boards', 'write:cards', 'write:checklists'], scopeKey: 'boards', scopeLabel: 'Board ID',
    credentialFields: [],
    intentKeywords: ['trello', 'card', 'cards', 'board', 'boards', 'list', 'lists', 'checklist', 'thẻ'],
    // A creation or task-management verb/state makes "task/công việc/việc" a work item, not a reference such as "about task X".
    intentPatterns: [
      /(?<![\p{L}\p{N}_])(?:tạo|thêm|giao|chuyển|di\s+chuyển|kéo|cập\s+nhật|kiểm\s+tra|tổng\s+hợp|báo\s+cáo|rà\s+soát|đánh\s+dấu|tích|create|add|assign|move|update)\s+(?:(?:một|1|các|những|toàn\s+bộ|tiến\s+độ|trạng\s+thái|a|an|new)\s+)*(?:task|tasks|công\s+việc|việc)(?![\p{L}\p{N}_])/iu,
      /(?<![\p{L}\p{N}_])(?:task|tasks|công\s+việc|việc)\s+(?:đang\s+)?(?:quá\s+hạn|trễ\s+hạn|sắp\s+đến\s+hạn|chưa\s+hoàn\s+thành|chưa\s+xong)(?![\p{L}\p{N}_])/iu,
    ],
    fallbackIntentKeywords: ['task', 'tasks', 'deadline', 'hạn chót', 'gán'],
    gatherRules: [
      // "bảng tính" is a spreadsheet, not a board.
      { entityKey: 'board', tool: 'trello.search_boards', pattern: /\b(?:board|bảng)\s+(?!tính(?![\p{L}\p{N}_-]))["']?([\p{L}\p{N}_-]+)["']?/iu, invalidates: ['list'] },
      { entityKey: 'list', tool: 'trello.search_lists', pattern: /\b(?:list|danh sách)\s+(?!(?:các\s+)?(?:pull\s+requests?|prs?|issues?|tickets?|blockers?)(?![\p{L}\p{N}_-]))["']?([\p{L}\p{N}_-]+(?:\s+[\p{L}\p{N}_-]+)?)["']?/iu,
        requires: { entityKey: 'board', argument: 'boardId', searchTool: 'trello.search_boards', question: 'Danh sách này nằm trong board nào?', context: 'Cần chọn board trước khi tra cứu danh sách.' } },
      { entityKey: 'member', tool: 'trello.search_members', pattern: /\b(?:member|gán|assign(?:\s+to)?)\s+["']?([\p{L}\p{N}_-]+)["']?/iu,
        requires: { entityKey: 'board', argument: 'boardId', searchTool: 'trello.search_boards', question: 'Thành viên này thuộc board nào?', context: 'Cần chọn board trước khi tra cứu thành viên.' } },
      { entityKey: 'card', tool: 'trello.search_cards', pattern: /(?<![\p{L}\p{N}_])(?:cập\s+nhật|sửa|di\s+chuyển|chuyển|bình\s+luận(?:\s+vào)?|đóng|update|move|comment(?:\s+on)?)\s+(?:thẻ|card)\s+["']([^"']+)["']/iu },
    ]
  };
