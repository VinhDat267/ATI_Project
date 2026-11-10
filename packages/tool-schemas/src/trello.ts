import type { ToolDefinition } from './types.js';

export const TRELLO_RESOURCE_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$';
export const TRELLO_RESOURCE_ID_REGEX = new RegExp(TRELLO_RESOURCE_ID_PATTERN);

export function isValidTrelloResourceId(value: unknown): value is string {
  return typeof value === 'string' && TRELLO_RESOURCE_ID_REGEX.test(value);
}

const TRELLO_TOOL_RESOURCE_FIELDS: Record<
  string,
  { scalar?: readonly string[]; array?: readonly string[]; required?: readonly string[] }
> = {
  'trello.search_lists': { scalar: ['boardId'], required: ['boardId'] },
  'trello.search_members': { scalar: ['boardId'], required: ['boardId'] },
  'trello.search_cards': { scalar: ['boardId', 'listId'] },
  'trello.get_card': { scalar: ['cardId'], required: ['cardId'] },
  'trello.create_card': { scalar: ['listId'], array: ['idMembers'], required: ['listId'] },
  'trello.update_card': { scalar: ['cardId', 'idList'], required: ['cardId'] },
  'trello.add_member': { scalar: ['cardId', 'memberId'], required: ['cardId', 'memberId'] },
  'trello.add_checklist': { scalar: ['cardId'], required: ['cardId'] },
  'trello.add_comment': { scalar: ['cardId'], required: ['cardId'] },
  'trello.create_list': { scalar: ['boardId'], required: ['boardId'] },
  'trello.remove_member': { scalar: ['cardId', 'memberId'], required: ['cardId', 'memberId'] },
  'trello.update_checklist_item': { scalar: ['cardId', 'checkItemId'], required: ['cardId'] },
  'trello.set_card_due_complete': { scalar: ['cardId'], required: ['cardId'] },
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
          description: 'Số lượng kết quả tối đa (tối đa 10)',
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
    description: 'Tạo thẻ (card) mới trên một danh sách Trello xác định. Gán thành viên ngay khi tạo bằng idMembers.',
    sideEffect: 'write',
    riskLevel: 'low',
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
        title: {
          type: 'string',
          description: 'Tiêu đề của thẻ',
        },
        desc: {
          type: 'string',
          description: 'Mô tả chi tiết nội dung thẻ',
        },
        due: {
          type: 'string',
          description: 'Hạn chót hoàn thành (định dạng ISO-8601)',
        },
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
    description: 'Cập nhật tiêu đề, mô tả, deadline hoặc trạng thái của thẻ Trello.',
    sideEffect: 'write',
    riskLevel: 'low',
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
        title: {
          type: 'string',
          description: 'Tiêu đề mới của thẻ (tùy chọn)',
        },
        desc: {
          type: 'string',
          description: 'Mô tả mới của thẻ (tùy chọn)',
        },
        due: {
          type: 'string',
          description: 'Hạn chót hoàn thành mới (ISO-8601, tùy chọn)',
        },
        dueComplete: {
          type: 'boolean',
          description: 'Đánh dấu đã hoàn thành hạn chót (true) hoặc chưa hoàn thành (false)',
        },
        closed: {
          type: 'boolean',
          description: 'Trạng thái lưu trữ/đóng thẻ (true nếu muốn archive)',
        },
        idList: {
          type: 'string',
          pattern: TRELLO_RESOURCE_ID_PATTERN,
          minLength: 1,
          maxLength: 128,
          description: 'ID danh sách mới nếu muốn di chuyển thẻ',
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
    riskLevel: 'low',
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
    riskLevel: 'low',
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
        title: {
          type: 'string',
          description: 'Tiêu đề của checklist',
        },
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Danh sách các mục việc cần làm trong checklist',
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
    riskLevel: 'low',
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
          description: 'Nội dung bình luận',
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
    riskLevel: 'low',
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
        name: {
          type: 'string',
          description: 'Tên của danh sách/cột mới (ví dụ: Sprint 15 - Cần làm)',
        },
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
    riskLevel: 'low',
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
    riskLevel: 'low',
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
    riskLevel: 'low',
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
];

