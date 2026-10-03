import type { ServiceDefinition } from '../types.js';
import { TELEGRAM_CHAT_ID_PATTERN, normalizeTelegramChatId } from '../telegram.js';

export const TELEGRAM_SERVICE: ServiceDefinition = {
  id: 'telegram', name: 'Telegram', description: 'Đọc thông tin chat và gửi văn bản thuần vào các chat được cấp quyền',
  scopes: ['read', 'send'], scopeKey: 'chats', scopeLabel: 'Chat ID', scopePattern: TELEGRAM_CHAT_ID_PATTERN,
  normalizeScopeEntry: normalizeTelegramChatId,
  credentialFields: [{ key: 'botToken', label: 'Bot token (BotFather)', type: 'password' }],
  intentKeywords: ['telegram'],
};
