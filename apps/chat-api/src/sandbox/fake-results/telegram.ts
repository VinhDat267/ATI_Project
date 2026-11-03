import type { FakeService } from './types.js';

export const TELEGRAM_FAKE: FakeService = {
  id: 'telegram', tools: {
    'telegram.list_chats': () => [{ id: '-1001234567890', title: 'ATI Test', type: 'supergroup' }],
    'telegram.get_chat': args => ({ id: String(args.chatId ?? '-1001234567890'), title: 'ATI Test', type: 'supergroup' }),
    'telegram.read_messages': args => ({
      messages: [
        {
          id: '101',
          messageId: 101,
          chatId: String(args.chatId ?? '-1001234567890'),
          senderName: 'Minh Lead',
          text: 'Cần kiểm tra tiến độ Sprint và cập nhật báo cáo tuần',
          date: 1791014000,
        },
      ],
    }),
    'telegram.send_message': args => ({ messageId: 42, chatId: args.chatId, date: 1791014400 }),
  },
};
