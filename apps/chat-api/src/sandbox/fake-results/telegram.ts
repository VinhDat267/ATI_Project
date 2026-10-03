import type { FakeService } from './types.js';

export const TELEGRAM_FAKE: FakeService = {
  id: 'telegram', tools: {
    'telegram.list_chats': () => [{ id: '-1001234567890', title: 'ATI Test', type: 'supergroup' }],
    'telegram.send_message': args => ({ messageId: 42, chatId: args.chatId, date: 1791014400 }),
  },
};
