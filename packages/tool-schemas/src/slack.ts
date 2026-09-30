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
      },
      required: ['ts', 'channel'],
    },
  },
];
