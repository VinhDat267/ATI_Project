import type { ToolDefinition } from './types.js';

export const TELEGRAM_CHAT_ID_PATTERN = /^-?\d{1,20}$/;
export function normalizeTelegramChatId(value: string): string {
  const id = value.trim();
  return TELEGRAM_CHAT_ID_PATTERN.test(id) ? BigInt(id).toString() : id;
}
const str = { type: 'string' };
const input = (properties: object, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const chat = { type: 'object', properties: { id: str, title: str, type: { ...str, enum: ['private', 'group', 'supergroup', 'channel'] } }, required: ['id', 'title', 'type'] };

export const TELEGRAM_TOOLS: ToolDefinition[] = [
  { name: 'telegram.list_chats', service: 'telegram', sideEffect: 'read', riskLevel: 'low', discovers: 'chat', listable: true,
    description: 'Đọc thông tin chat Telegram trong allowlist bằng getChat; query rỗng liệt kê tối đa 10 chat, query khác lọc tiêu đề.',
    inputSchema: input({ query: { ...str, maxLength: 2000 }, limit: { type: 'integer', minimum: 1, maximum: 10, default: 10 } }, ['query']),
    outputSchema: { type: 'array', items: chat } },
  { name: 'telegram.send_message', service: 'telegram', sideEffect: 'write', riskLevel: 'medium',
    description: 'Sau khi duyệt, gửi 1–4096 ký tự văn bản thuần vào chat Telegram đã tìm thấy; tắt preview link, không dùng parse_mode hoặc broadcast trả phí.',
    inputSchema: input({ chatId: { ...str, pattern: TELEGRAM_CHAT_ID_PATTERN.source, 'x-resource': 'chat' }, text: { ...str, minLength: 1, maxLength: 4096 } }, ['chatId', 'text']),
    outputSchema: { type: 'object', properties: { messageId: { type: 'integer', minimum: 1 }, chatId: str, date: { type: 'integer', minimum: 0 } }, required: ['messageId', 'chatId', 'date'] } },
];
