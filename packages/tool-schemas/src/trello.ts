import type { ToolDefinition } from './types.js';

export const TRELLO_RESOURCE_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$';
export const TRELLO_RESOURCE_ID_REGEX = new RegExp(TRELLO_RESOURCE_ID_PATTERN);

export function isValidTrelloResourceId(value: unknown): value is string {
  return typeof value === 'string' && TRELLO_RESOURCE_ID_REGEX.test(value);
}

/** Bounds shared by the schema and the adapter so both reject the same input. */
export const TRELLO_NAME_MAX_LENGTH = 512;
export const TRELLO_DESC_MAX_LENGTH = 16384;
export const TRELLO_COMMENT_MAX_LENGTH = 16384;
export const TRELLO_CHECKLIST_MAX_ITEMS = 100;
export const TRELLO_CHECKLIST_ITEM_MAX_LENGTH = 512;
export const TRELLO_SEARCH_CARDS_MAX_LIMIT = 50;
export const TRELLO_SEARCH_LABELS_MAX_LIMIT = 10;
export const TRELLO_CARD_MAX_LABELS = 20;
/** ISO-8601 date-time with an explicit timezone (Z or ±HH:MM). */
export const TRELLO_DUE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?(?:Z|[+-]\\d{2}:\\d{2})$';

const trelloName = (description: string) => ({
  type: 'string',
  minLength: 1,
  maxLength: TRELLO_NAME_MAX_LENGTH,
  description,
});
const trelloDesc = (description: string) => ({
  type: 'string',
  maxLength: TRELLO_DESC_MAX_LENGTH,
  description,
});
const trelloDue = (description: string) => ({
  type: 'string',
  pattern: TRELLO_DUE_PATTERN,
  description,
});
const trelloId = (description: string, resource?: string) => ({
  type: 'string',
  pattern: TRELLO_RESOURCE_ID_PATTERN,
  minLength: 1,
  maxLength: 128,
  description,
  ...(resource ? { 'x-resource': resource } : {}),
});

const TRELLO_TOOL_RESOURCE_FIELDS: Record<
  string,
  { scalar?: readonly string[]; array?: readonly string[]; required?: readonly string[] }
> = {
  'trello.search_lists': { scalar: ['boardId'], required: ['boardId'] },
  'trello.search_members': { scalar: ['boardId'], required: ['boardId'] },
  'trello.search_cards': { scalar: ['boardId', 'listId'] },
  'trello.get_card': { scalar: ['cardId'], required: ['cardId'] },
  'trello.create_card': { scalar: ['listId'], array: ['idMembers', 'idLabels'], required: ['listId'] },
  'trello.update_card': { scalar: ['cardId', 'idList'], required: ['cardId'] },
  'trello.add_member': { scalar: ['cardId', 'memberId'], required: ['cardId', 'memberId'] },
  'trello.add_checklist': { scalar: ['cardId'], required: ['cardId'] },
  'trello.add_comment': { scalar: ['cardId'], required: ['cardId'] },
  'trello.create_list': { scalar: ['boardId'], required: ['boardId'] },
  'trello.remove_member': { scalar: ['cardId', 'memberId'], required: ['cardId', 'memberId'] },
  'trello.update_checklist_item': { scalar: ['cardId', 'checkItemId'], required: ['cardId'] },
  'trello.set_card_due_complete': { scalar: ['cardId'], required: ['cardId'] },
  'trello.search_labels': { scalar: ['boardId'], required: ['boardId'] },
  'trello.add_label': { scalar: ['cardId', 'labelId'], required: ['cardId', 'labelId'] },
  'trello.remove_label': { scalar: ['cardId', 'labelId'], required: ['cardId', 'labelId'] },
};

export function validateTrelloToolArgs(
  toolName: string,
  args: Record<string, unknown> | null | undefined
): string | null {
  const spec = TRELLO_TOOL_RESOURCE_FIELDS[toolName];
  if (!spec) return null;
  if (!args || typeof args !== 'object') {
    return `Arguments for ${toolName} must be an object`;
  }
  for (const reqField of spec.required ?? []) {
    if (!isValidTrelloResourceId(args[reqField])) {
      return `Invalid Trello resource ID for ${reqField}`;
    }
  }
  for (const field of spec.scalar ?? []) {
    const val = args[field];
    if (val !== undefined && val !== null && !isValidTrelloResourceId(val)) {
      return `Invalid Trello resource ID for ${field}`;
    }
  }
  for (const arrField of spec.array ?? []) {
    const val = args[arrField];
    if (val === undefined || val === null) continue;
    if (!Array.isArray(val)) {
      return `Invalid Trello resource ID array for ${arrField}`;
    }
    for (let i = 0; i < val.length; i++) {
      if (!isValidTrelloResourceId(val[i])) {
        return `Invalid Trello resource ID for ${arrField}[${i}]`;
      }
    }
  }
  return null;
}

export const TRELLO_TOOLS: ToolDefinition[] = [
  {
    name: 'trello.search_boards',
    service: 'trello',
    discovers: 'board',
    listable: true,
    description: 'Tìm kiếm bảng (boards) trên Trello theo từ khóa hoặc tên.',
    sideEffect: 'read',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Từ khóa tên bảng cần tìm kiếm',
        },
        limit: {
          type: 'number',
          description: 'Số lượng kết quả tối đa trả về (tối đa 10)',
          maximum: 10,
          default: 10,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['id', 'name'],
      },
    },
  },
  {
    name: 'trello.search_lists',
    service: 'trello',
    discovers: 'list',
    listable: true,
    description: 'Tìm kiếm hoặc liệt kê các danh sách (lists) trong một bảng Trello cụ thể.',
    sideEffect: 'read',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của bảng Trello',
          'x-resource': 'board',
        },
        query: {
          type: 'string',
          description: 'Từ khóa lọc tên danh sách (tùy chọn)',
        },
        limit: {
          type: 'number',
          description: 'Số lượng kết quả tối đa trả về (tối đa 10)',
          maximum: 10,
          default: 10,
        },
      },
      required: ['boardId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          boardId: { type: 'string' },
        },
        required: ['id', 'name', 'boardId'],
      },
    },
  },
  {
    name: 'trello.search_members',
    service: 'trello',
    discovers: 'member',
    listable: true,
    description: 'Tìm kiếm thành viên Trello theo tên hoặc username để lấy memberId.',
    sideEffect: 'read',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Tên hoặc username của thành viên cần tìm',
        },
        boardId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của bảng chứa thành viên (bắt buộc; tìm bảng trước)',
          'x-resource': 'board',
        },
        limit: {
          type: 'number',
          description: 'Số lượng kết quả tối đa (tối đa 10)',
          maximum: 10,
          default: 10,
        },
      },
      required: ['query', 'boardId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          fullName: { type: 'string' },
          username: { type: 'string' },
        },
        required: ['id', 'fullName'],
      },
    },
  },
  {
    name: 'trello.search_cards',
    service: 'trello',
    discovers: 'card',
    description: 'Tìm kiếm thẻ (cards) trong Trello theo từ khóa.',
    sideEffect: 'read',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Từ khóa tìm kiếm card',
        },
        boardId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID bảng Trello để thu hẹp phạm vi (tùy chọn)',
          'x-resource': 'board',
        },
        listId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID danh sách Trello để thu hẹp phạm vi (tùy chọn)',
          'x-resource': 'list',
        },
        limit: {
          type: 'number',
          description: 'Số lượng kết quả tối đa (tối đa 50)',
          minimum: 1,
          maximum: TRELLO_SEARCH_CARDS_MAX_LIMIT,
          default: 10,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          url: { type: 'string' },
          listId: { type: 'string' },
          boardId: { type: 'string' },
          due: { type: ['string', 'null'] },
          dueComplete: { type: 'boolean' },
          dateLastActivity: { type: 'string' },
          idMembers: {
            type: 'array',
            items: { type: 'string' },
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['id', 'name'],
      },
    },
  },
  {
    name: 'trello.get_card',
    service: 'trello',
    description: 'Lấy thông tin chi tiết của một thẻ Trello bằng cardId.',
    sideEffect: 'read',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của thẻ Trello cần xem chi tiết',
        },
      },
      required: ['cardId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        desc: { type: 'string' },
        url: { type: 'string' },
        listId: { type: 'string' },
        boardId: { type: 'string' },
        due: { type: ['string', 'null'] },
        dueComplete: { type: 'boolean' },
        idMembers: {
          type: 'array',
          items: { type: 'string' },
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
        },
        checklists: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    state: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'trello.create_card',
    service: 'trello',
    description: 'Tạo thẻ (card) mới trên một danh sách Trello xác định. Gán thành viên ngay khi tạo bằng idMembers, gắn nhãn bằng idLabels (lấy từ trello.search_labels).',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        listId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của danh sách Trello chứa thẻ mới',
          'x-resource': 'list',
        },
        title: trelloName('Tiêu đề của thẻ (tối đa 512 ký tự)'),
        desc: trelloDesc('Mô tả chi tiết nội dung thẻ (tối đa 16384 ký tự)'),
        due: trelloDue('Hạn chót hoàn thành (ISO-8601 date-time có múi giờ, ví dụ 2026-10-02T17:00:00+07:00)'),
        dueComplete: {
          type: 'boolean',
          description: 'Đánh dấu đã hoàn thành hạn chót (true) hoặc chưa hoàn thành (false)',
        },
        idMembers: {
          type: 'array',
          items: {
            type: 'string',
            pattern: TRELLO_RESOURCE_ID_PATTERN,
            minLength: 1,
            maxLength: 128,
          },
          description: 'Danh sách ID thành viên được gán vào thẻ',
          'x-resource': 'member',
        },
        idLabels: {
          type: 'array',
          maxItems: TRELLO_CARD_MAX_LABELS,
          items: {
            type: 'string',
            pattern: TRELLO_RESOURCE_ID_PATTERN,
            minLength: 1,
            maxLength: 128,
          },
          description: 'Danh sách ID nhãn (label) thuộc cùng bảng với danh sách chứa thẻ',
          'x-resource': 'trello_label',
        },
      },
      required: ['listId', 'title'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        url: { type: 'string' },
        listId: { type: 'string' },
        dueComplete: { type: 'boolean' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'trello.update_card',
    service: 'trello',
    description: 'Cập nhật tiêu đề, mô tả, deadline, trạng thái hoặc di chuyển thẻ Trello sang danh sách khác trong cùng bảng. closed: true sẽ lưu trữ (archive) thẻ, thẻ biến khỏi bảng; chỉ dùng khi người dùng yêu cầu lưu trữ/đóng thẻ.',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của thẻ cần cập nhật',
          'x-resource': 'card',
        },
        title: trelloName('Tiêu đề mới của thẻ (tùy chọn, tối đa 512 ký tự)'),
        desc: trelloDesc('Mô tả mới của thẻ (tùy chọn, tối đa 16384 ký tự)'),
        due: trelloDue('Hạn chót hoàn thành mới (ISO-8601 date-time có múi giờ, tùy chọn)'),
        dueComplete: {
          type: 'boolean',
          description: 'Đánh dấu đã hoàn thành hạn chót (true) hoặc chưa hoàn thành (false)',
        },
        closed: {
          type: 'boolean',
          description: 'true = lưu trữ (archive) thẻ, thẻ biến khỏi bảng; false = khôi phục thẻ đã lưu trữ',
        },
        idList: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID danh sách mới (cùng bảng với thẻ) nếu muốn di chuyển thẻ',
          'x-resource': 'list',
        },
      },
      required: ['cardId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        url: { type: 'string' },
        listId: { type: 'string' },
        dueComplete: { type: 'boolean' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'trello.add_member',
    service: 'trello',
    description: 'Gán thành viên vào một thẻ Trello đã có. Với thẻ sắp tạo trong cùng plan, dùng idMembers của trello.create_card thay cho tool này.',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của thẻ Trello',
          'x-resource': 'card',
        },
        memberId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của thành viên Trello cần gán',
          'x-resource': 'member',
        },
      },
      required: ['cardId', 'memberId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        idMembers: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['id', 'idMembers'],
    },
  },
  {
    name: 'trello.add_checklist',
    service: 'trello',
    description: 'Thêm danh sách kiểm tra (checklist) và các mục con vào thẻ Trello.',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của thẻ Trello',
          'x-resource': 'card',
        },
        title: trelloName('Tiêu đề của checklist (tối đa 512 ký tự)'),
        items: {
          type: 'array',
          maxItems: TRELLO_CHECKLIST_MAX_ITEMS,
          items: { type: 'string', minLength: 1, maxLength: TRELLO_CHECKLIST_ITEM_MAX_LENGTH },
          description: 'Danh sách các mục việc cần làm trong checklist (tối đa 100 mục, mỗi mục tối đa 512 ký tự)',
        },
      },
      required: ['cardId', 'title'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              state: { type: 'string' },
            },
          },
        },
      },
      required: ['id', 'name'],
    },
  },
];

export const TRELLO_OAUTH_TOOLS: ToolDefinition[] = [
  {
    name: 'trello.add_comment',
    service: 'trello',
    description: 'Thêm bình luận (comment) ghi chú hoặc cập nhật tiến độ vào thẻ Trello.',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của thẻ Trello cần bình luận',
          'x-resource': 'card',
        },
        text: {
          type: 'string',
          minLength: 1,
          maxLength: TRELLO_COMMENT_MAX_LENGTH,
          description: 'Nội dung bình luận (tối đa 16384 ký tự)',
        },
      },
      required: ['cardId', 'text'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        cardId: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['id', 'cardId', 'text'],
    },
  },
  {
    name: 'trello.create_list',
    service: 'trello',
    description: 'Tạo danh sách/cột (list) mới trên một bảng Trello.',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của bảng Trello nơi cần tạo danh sách mới',
          'x-resource': 'board',
        },
        name: trelloName('Tên của danh sách/cột mới (ví dụ: Sprint 15 - Cần làm; tối đa 512 ký tự)'),
        pos: {
          type: 'string',
          enum: ['top', 'bottom'],
          description: 'Vị trí cột mới trên bảng (top hoặc bottom, tùy chọn)',
        },
      },
      required: ['boardId', 'name'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        boardId: { type: 'string' },
      },
      required: ['id', 'name', 'boardId'],
    },
  },
  {
    name: 'trello.remove_member',
    service: 'trello',
    description: 'Gỡ một thành viên khỏi thẻ Trello để điều phối lại người phụ trách.',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của thẻ Trello',
          'x-resource': 'card',
        },
        memberId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của thành viên Trello cần gỡ khỏi thẻ',
          'x-resource': 'member',
        },
      },
      required: ['cardId', 'memberId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        idMembers: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['id', 'idMembers'],
    },
  },
  {
    name: 'trello.update_checklist_item',
    service: 'trello',
    description: 'Đánh dấu hoàn thành (complete) hoặc chưa hoàn thành (incomplete) một mục con trong checklist của thẻ Trello theo tên mục.',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của thẻ Trello chứa checklist',
          'x-resource': 'card',
        },
        itemName: {
          type: 'string',
          minLength: 1,
          maxLength: TRELLO_CHECKLIST_ITEM_MAX_LENGTH,
          description: 'Tên mục công việc con trong checklist cần cập nhật trạng thái',
        },
        state: {
          type: 'string',
          enum: ['complete', 'incomplete'],
          description: 'Trạng thái mới của mục checklist: complete (đã xong) hoặc incomplete (chưa xong)',
        },
        checkItemId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của mục checklist (tùy chọn nếu đã biết)',
        },
      },
      required: ['cardId', 'itemName', 'state'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        cardId: { type: 'string' },
        name: { type: 'string' },
        state: { type: 'string' },
      },
      required: ['id', 'cardId', 'name', 'state'],
    },
  },
  {
    name: 'trello.set_card_due_complete',
    service: 'trello',
    description: 'Đánh dấu hoàn thành (dueComplete = true) hoặc mở lại (dueComplete = false) hạn chót của một thẻ Trello mà không làm ẩn/lưu trữ thẻ.',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID của thẻ Trello cần đánh dấu hoàn thành hạn chót',
          'x-resource': 'card',
        },
        dueComplete: {
          type: 'boolean',
          description: 'true nếu đã hoàn thành đúng hạn, false nếu mở lại chưa hoàn thành',
        },
      },
      required: ['cardId', 'dueComplete'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        dueComplete: { type: 'boolean' },
      },
      required: ['id', 'name', 'dueComplete'],
    },
  },
  {
    name: 'trello.search_labels',
    service: 'trello',
    discovers: 'trello_label',
    listable: true,
    description: 'Liệt kê hoặc tìm nhãn (labels) của một bảng Trello theo tên/màu để lấy labelId trước khi gắn nhãn cho thẻ.',
    sideEffect: 'read',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: trelloId('ID của bảng Trello chứa nhãn (bắt buộc; tìm bảng trước)', 'board'),
        query: {
          type: 'string',
          maxLength: TRELLO_NAME_MAX_LENGTH,
          description: 'Từ khóa lọc theo tên hoặc màu nhãn (tùy chọn)',
        },
        limit: {
          type: 'number',
          description: 'Số lượng kết quả tối đa (tối đa 10)',
          minimum: 1,
          maximum: TRELLO_SEARCH_LABELS_MAX_LIMIT,
          default: 10,
        },
      },
      required: ['boardId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          color: { type: ['string', 'null'] },
          boardId: { type: 'string' },
        },
        required: ['id', 'name'],
      },
    },
  },
  {
    name: 'trello.add_label',
    service: 'trello',
    description: 'Gắn một nhãn (label) có sẵn của bảng vào thẻ Trello đã có, ví dụ để phân loại hoặc đánh dấu độ ưu tiên. Nhãn phải thuộc cùng bảng với thẻ.',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: trelloId('ID của thẻ Trello', 'card'),
        labelId: trelloId('ID của nhãn (lấy từ trello.search_labels)', 'trello_label'),
      },
      required: ['cardId', 'labelId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        labelId: { type: 'string' },
        idLabels: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'labelId'],
    },
  },
  {
    name: 'trello.remove_label',
    service: 'trello',
    description: 'Gỡ một nhãn (label) khỏi thẻ Trello. Không xóa nhãn khỏi bảng.',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        cardId: trelloId('ID của thẻ Trello', 'card'),
        labelId: trelloId('ID của nhãn cần gỡ khỏi thẻ', 'trello_label'),
      },
      required: ['cardId', 'labelId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        labelId: { type: 'string' },
      },
      required: ['id', 'labelId'],
    },
  },
];

