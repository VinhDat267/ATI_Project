import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { ChatService } from '../../src/services/chat-service.js';
import { createMemoryConversationRepositories } from '../../src/db/repositories/memory-conversations.js';

it.each([true, false])('persists and emits structured refusal while keeping text and correlation (router=%s)', async routed => {
  const { convRepo, msgRepo } = createMemoryConversationRepositories();
  const conversation = await convRepo.createConversation('user');
  const events = new EventEmitter();
  const refusal = {
    kind: 'refusal', reason: 'Notion, Trello chưa được kết nối hoặc chưa được cấp quyền.',
    suggestion: 'Hãy kết nối dịch vụ.',
    ...(routed ? { unavailableServices: [{ id: 'notion', name: 'Notion' }, { id: 'trello', name: 'Trello' }] } : {}),
  };
  const service = new ChatService({ msgRepo: msgRepo as any,
    planner: { processMessage: async () => refusal } as any,
    eventEmitter: { emit: (name, payload) => { events.emit(name, payload); } },
  });
  const emitted = new Promise<any>(resolve => events.once('refusal', resolve));
  const accepted = await service.handleUserMessage({ conversationId: conversation.id, userId: 'user', content: 'Tạo trang Notion và issue Trello', requestId: 'client-request' });
  const payload = await emitted;
  const message = (await msgRepo.listMessages(conversation.id)).find(row => row.metadata?.type === 'refusal')!;
  expect(message.content).toBe('Từ chối yêu cầu: Notion, Trello chưa được kết nối hoặc chưa được cấp quyền.\nGợi ý: Hãy kết nối dịch vụ.');
  const fields = { reason: 'Notion, Trello chưa được kết nối hoặc chưa được cấp quyền.', suggestion: 'Hãy kết nối dịch vụ.', replyToMessageId: accepted.messageId, requestId: 'client-request' };
  expect(message.metadata).toMatchObject({ type: 'refusal', ...fields });
  expect(payload).toMatchObject({ conversationId: conversation.id, ...fields });
  for (const value of [message.metadata, payload]) {
    if (routed) expect(value.unavailableServices).toEqual([{ id: 'notion', name: 'Notion' }, { id: 'trello', name: 'Trello' }]);
    else expect(Object.hasOwn(value, 'unavailableServices')).toBe(false);
  }
});
