import type { ToolDefinition } from './types.js';

export const SLACK_TOOLS: ToolDefinition[] = [
  {
    name: 'slack.search_channels',
    discovers: 'channel',
    listable: true,
    service: 'slack',
    description: 'Tìm kiếm kênh (channels) trên Slack theo tên để lấy channel ID.',
    sideEffect: 'read',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Từ khóa tên kênh Slack cần tìm kiếm',
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
          isPrivate: { type: 'boolean' },
        },
        required: ['id', 'name'],
      },
    },
  },
  {
    name: 'slack.send_message',
    service: 'slack',
    description: 'Gửi tin nhắn vào kênh Slack đã chọn.',
    sideEffect: 'write',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'ID kênh Slack nhận tin nhắn',
          'x-resource': 'channel',
        },
        text: {
          type: 'string',
          description: 'Nội dung tin nhắn cần gửi',
        },
        threadTs: {
          type: 'string',
          description: 'Tùy chọn: ts của tin gốc để trả lời trong thread (lấy từ slack.read_messages)',
          pattern: '^\\d+\\.\\d+$',
        },
        blocks: {
          type: 'array',
          description: 'Tùy chọn: Danh sách Slack Block Kit blocks (tối đa 50 block) để hiển thị tin nhắn có cấu trúc',
          maxItems: 50,
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
      required: ['channel', 'text'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        ts: {
          type: 'string',
          description: 'Timestamp của tin nhắn Slack đã gửi',
        },
        channel: {
          type: 'string',
          description: 'ID kênh Slack đã gửi thành công',
        },
        permalink: {
          type: 'string',
          description: 'Link mở tin nhắn trong Slack (có thể thiếu nếu Slack không trả về)',
        },
      },
      required: ['ts', 'channel'],
    },
  },
];

export const SLACK_EXTENDED_TOOLS: ToolDefinition[] = [
  {
    name: 'slack.read_messages',
    service: 'slack',
    description:
      'Đọc các tin nhắn gần đây trong một kênh Slack được cấp quyền (channel) để tóm tắt thảo luận, bóc tách đầu việc hoặc tra cứu thông tin. Chỉ đọc tin gốc gần nhất (tối đa 25 tin trả về; khi có từ khóa thì quét 100 tin gần nhất), người gửi trả về dạng ID. Khi tin có replyCount > 0, gọi thêm slack.read_thread với threadTs để đọc các phản hồi trong thread. Kết quả có scanned/matched/truncated để báo cáo đúng phạm vi đã đọc.',
    sideEffect: 'read',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'ID kênh Slack cần đọc tin nhắn',
          'x-resource': 'channel',
        },
        query: {
          type: 'string',
          description: 'Từ khóa tùy chọn để lọc nội dung tin nhắn',
        },
        limit: {
          type: 'number',
          description: 'Số lượng tin nhắn tối đa cần lấy (1..25, mặc định 15)',
          minimum: 1,
          maximum: 25,
          default: 15,
        },
      },
      required: ['channel'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string' },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ts: { type: 'string' },
              user: { type: 'string' },
              text: { type: 'string' },
              replyCount: { type: 'number' },
              threadTs: { type: 'string' },
            },
            required: ['ts', 'text'],
          },
        },
        scanned: { type: 'number', description: 'Số tin gần nhất đã quét' },
        matched: { type: 'number', description: 'Số tin khớp bộ lọc trong phạm vi đã quét' },
        truncated: { type: 'boolean', description: 'true nếu còn tin khớp hoặc tin cũ hơn chưa được trả về' },
      },
      required: ['channel', 'messages'],
    },
  },
  {
    name: 'slack.read_thread',
    service: 'slack',
    description:
      'Đọc tin gốc và các câu trả lời trong một thread Slack thuộc kênh được cấp quyền (lấy threadTs từ kết quả slack.read_messages khi replyCount > 0). Tối đa 50 tin trong thread, người gửi trả về dạng ID.',
    sideEffect: 'read',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'ID kênh Slack chứa thread',
          'x-resource': 'channel',
        },
        threadTs: {
          type: 'string',
          description: 'Timestamp gốc của thread (ví dụ 1700000001.000100)',
          pattern: '^\\d+\\.\\d+$',
        },
        limit: {
          type: 'number',
          description: 'Số lượng tin tối đa cần lấy trong thread (1..50, mặc định 25)',
          minimum: 1,
          maximum: 50,
          default: 25,
        },
      },
      required: ['channel', 'threadTs'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string' },
        threadTs: { type: 'string' },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ts: { type: 'string' },
              user: { type: 'string' },
              text: { type: 'string' },
              isParent: { type: 'boolean' },
            },
            required: ['ts', 'text'],
          },
        },
        scanned: { type: 'number', description: 'Số tin trong thread đã nhận' },
        truncated: { type: 'boolean', description: 'true nếu thread còn nhiều phản hồi hơn giới hạn' },
      },
      required: ['channel', 'threadTs', 'messages'],
    },
  },
  {
    name: 'slack.search_users',
    service: 'slack',
    description:
      'Tìm thành viên Slack đang hoạt động (bỏ qua bot và tài khoản đã khóa) theo tên hoặc email để lấy Slack user ID (<@U...>) phục vụ nhắc tên trong báo cáo.',
    sideEffect: 'read',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Từ khóa tên đăng nhập, tên hiển thị, họ tên hoặc email',
        },
        email: {
          type: 'string',
          description: 'Tùy chọn: Email chính xác để tra cứu nhanh qua users.lookupByEmail',
        },
        limit: {
          type: 'number',
          description: 'Số lượng kết quả tối đa trả về (1..200, mặc định 50)',
          minimum: 1,
          maximum: 200,
          default: 50,
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          realName: { type: 'string' },
          displayName: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['id', 'name'],
      },
    },
  },
];
