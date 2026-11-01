import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { WorkingMemory } from '@wap/planner';
import { encryptCredentials } from '@wap/tool-adapters';
import { ChatService } from '../../src/services/chat-service.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { createTelegramConnectionLookup } from '../../src/services/telegram/connection-reference.js';
import { createMemoryConversationRepositories } from '../../src/db/repositories/memory-conversations.js';

const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const BOT_TOKEN = '123456789:synthetic_bot_token_abcdefghijkl';

function buildTestHarness(telegramLookup: (userId: string) => Promise<any>, plannedResponse: any) {
  const { convRepo, msgRepo } = createMemoryConversationRepositories();
  const plans = new Map<string, any>();
  const planRepo: any = {
    createPlan: async (data: any) => {
      const id = 'plan_tg_test_1';
      const row = {
        id,
        conv_id: data.convId,
        plan_json: data.planJson,
        plan_text: data.planText,
        plan_hash: data.planHash,
        resource_labels: data.resourceLabels,
        status: 'pending',
        expires_at: data.expiresAt,
      };
      plans.set(id, row);
      return row;
    },
  };
  const emitted: Array<{ event: string; payload: any }> = [];
  const chatService = new ChatService({
    msgRepo: msgRepo as any,
    convRepo: convRepo as any,
    planRepo,
    planner: {
      processMessage: async () => structuredClone(plannedResponse),
      routeSchedule: async () => ({ services: ['telegram'], unavailable: [] }),
    },
    eventEmitter: {
      emit: (event, payload) => emitted.push({ event, payload }),
    },
    telegramConnection: telegramLookup,
  });

  return { convRepo, msgRepo, plans, emitted, chatService };
}

describe('Telegram planning & execution binding (Task 6)', () => {
  it('refuses with unavailableServices: [{ id: "telegram", name: "Telegram" }] when user is not connected', async () => {
    const plan = {
      kind: 'plan' as const,
      thinking: 'Send Telegram',
      summary: 'Gửi tin nhắn Telegram',
      warnings: [],
      steps: [
        {
          id: 'step_1',
          tool: 'telegram.send_message',
          description: 'Gửi tin nhắn',
          args: { chatId: '777888999', text: 'Xin chào' },
          dependsOn: [],
        },
      ],
    };
    const { convRepo, emitted, chatService } = buildTestHarness(
      async () => ({ status: 'not_connected', selectedChats: [] }),
      plan,
    );
    const conv = await convRepo.createConversation('user-1');
    await chatService.handleUserMessage({
      conversationId: conv.id,
      userId: 'user-1',
      content: 'Gửi tin nhắn vào Telegram của tôi',
    });
    await new Promise((r) => setTimeout(r, 30));

    const refusal = emitted.find((e) => e.event === 'refusal');
    expect(refusal).toBeDefined();
    expect(refusal!.payload.unavailableServices).toEqual([{ id: 'telegram', name: 'Telegram' }]);
  });

  it('refuses with guidance when user is connected but has not selected any chats (needs_scope)', async () => {
    const plan = {
      kind: 'plan' as const,
      thinking: 'Send Telegram',
      summary: 'Gửi tin nhắn Telegram',
      warnings: [],
      steps: [
        {
          id: 'step_1',
          tool: 'telegram.send_message',
          description: 'Gửi tin nhắn',
          args: { chatId: '777888999', text: 'Xin chào' },
          dependsOn: [],
        },
      ],
    };
    const { convRepo, emitted, chatService } = buildTestHarness(
      async () => ({ status: 'needs_scope', selectedChats: [] }),
      plan,
    );
    const conv = await convRepo.createConversation('user-1');
    await chatService.handleUserMessage({
      conversationId: conv.id,
      userId: 'user-1',
      content: 'Gửi tin nhắn vào Telegram của tôi',
    });
    await new Promise((r) => setTimeout(r, 30));

    const refusal = emitted.find((e) => e.event === 'refusal');
    expect(refusal).toBeDefined();
    expect(refusal!.payload.reason).toContain('chưa chọn cuộc trò chuyện');
  });

  it('binds connections.telegram into plan_hash, sets step.chatId, and populates resourceLabels with chat titles', async () => {
    const plan = {
      kind: 'plan' as const,
      thinking: 'Send Telegram',
      summary: 'Gửi tin nhắn vào nhóm Đội Sản Phẩm',
      warnings: [],
      steps: [
        {
          id: 'step_1',
          tool: 'telegram.send_message',
          description: 'Gửi báo cáo vào Đội Sản Phẩm',
          args: { chatId: '-100555666777', text: 'Báo cáo sáng' },
          dependsOn: [],
        },
      ],
    };
    const { convRepo, plans, emitted, chatService } = buildTestHarness(
      async () => ({
        status: 'connected',
        selectedChats: [
          { chatId: '777888999', title: 'Telegram của tôi (Nguyen Van A)', type: 'private' },
          { chatId: '-100555666777', title: 'Đội Sản Phẩm', type: 'supergroup' },
        ],
        connection: {
          credentialId: 'cred-tg-1',
          telegramUserId: '777888999',
          username: 'nguyenvana',
          chatIds: ['-100555666777', '777888999'],
        },
      }),
      plan,
    );
    const conv = await convRepo.createConversation('user-1');
    await chatService.handleUserMessage({
      conversationId: conv.id,
      userId: 'user-1',
      content: 'Gửi báo cáo sáng vào nhóm Đội Sản Phẩm',
    });
    await new Promise((r) => setTimeout(r, 30));

    const preview = emitted.find((e) => e.event === 'plan_preview');
    expect(preview).toBeDefined();
    const savedPlan = plans.get('plan_tg_test_1');
    expect(savedPlan).toBeDefined();
    expect(savedPlan.plan_json.connections.telegram).toEqual({
      credentialId: 'cred-tg-1',
      telegramUserId: '777888999',
      username: 'nguyenvana',
      chatIds: ['-100555666777', '777888999'],
    });
    expect(savedPlan.plan_json.steps[0].chatId).toBe('-100555666777');
    expect(savedPlan.plan_hash).toBe(
      createHash('sha256').update(savedPlan.plan_text).digest('hex'),
    );
    expect(savedPlan.resource_labels['-100555666777']).toBe('Đội Sản Phẩm');
  });

  it('refuses when plan targets a chatId outside connection.chatIds', async () => {
    const plan = {
      kind: 'plan' as const,
      thinking: 'Send Telegram',
      summary: 'Gửi tin nhắn',
      warnings: [],
      steps: [
        {
          id: 'step_1',
          tool: 'telegram.send_message',
          description: 'Gửi báo cáo',
          args: { chatId: '-100999888777', text: 'Báo cáo' },
          dependsOn: [],
        },
      ],
    };
    const { convRepo, emitted, chatService } = buildTestHarness(
      async () => ({
        status: 'connected',
        selectedChats: [
          { chatId: '777888999', title: 'Telegram của tôi (Nguyen Van A)', type: 'private' },
        ],
        connection: {
          credentialId: 'cred-tg-1',
          telegramUserId: '777888999',
          username: 'nguyenvana',
          chatIds: ['777888999'],
        },
      }),
      plan,
    );
    const conv = await convRepo.createConversation('user-1');
    await chatService.handleUserMessage({
      conversationId: conv.id,
      userId: 'user-1',
      content: 'Gửi báo cáo vào nhóm lạ',
    });
    await new Promise((r) => setTimeout(r, 30));

    const refusal = emitted.find((e) => e.event === 'refusal');
    expect(refusal).toBeDefined();
    expect(refusal!.payload.reason).toContain('không nằm trong phạm vi');
  });

  it('enforces credentialId match, scope match, and live group membership in AdapterFactory.telegramAdapter during execution', async () => {
    let currentCred: any = {
      id: 'cred-tg-1',
      status: 'active',
      config: encryptCredentials(
        {
          telegramUserId: '777888999',
          username: 'nguyenvana',
          displayName: 'Nguyen Van A',
          selectedChats: [
            { chatId: '777888999', title: 'Telegram của tôi (Nguyen Van A)', type: 'private' },
            { chatId: '-100555666777', title: 'Đội Sản Phẩm', type: 'supergroup' },
          ],
        },
        ENCRYPTION_KEY,
      ),
    };
    const credRepo: any = {
      getPersonalCredentials: async (_service: string, userId: string) =>
        userId === 'user-1' ? currentCred : null,
      getPersonalConnectionStatus: async (_service: string, userId: string) =>
        userId === 'user-1' ? currentCred : null,
    };

    let groupMember = true;
    const botClient: any = {
      getChatMember: vi.fn(async (chatId: string, userId: string) => {
        if (chatId === '-100555666777' && userId === '777888999') return groupMember;
        return false;
      }),
    };

    const lookup = createTelegramConnectionLookup({
      credentialRepo: credRepo,
      encryptionKey: ENCRYPTION_KEY,
      botClient,
    });
    const lookedUp = await lookup('user-1');
    expect(lookedUp.status).toBe('connected');
    expect(lookedUp.connection).toEqual({
      credentialId: 'cred-tg-1',
      telegramUserId: '777888999',
      username: 'nguyenvana',
      chatIds: ['-100555666777', '777888999'],
    });

    const factory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: ENCRYPTION_KEY,
      telegramBot: {
        botToken: BOT_TOKEN,
        botUsername: 'ati_assistant_bot',
        apiBaseUrl: 'https://mock-telegram.internal',
      },
      telegramBotClient: botClient,
    });

    // 1. Valid execution context succeeds
    const adapter = await factory.getAdapterForService('telegram', {
      userId: 'user-1',
      phase: 'execution',
      connections: {
        telegram: {
          credentialId: 'cred-tg-1',
          telegramUserId: '777888999',
          username: 'nguyenvana',
          chatIds: ['-100555666777', '777888999'],
        },
      },
    });
    expect(adapter).toBeDefined();

    // 2. Credential replaced -> AUTH_ERROR
    await expect(
      factory.getAdapterForService('telegram', {
        userId: 'user-1',
        phase: 'execution',
        connections: {
          telegram: {
            credentialId: 'cred-tg-stale',
            telegramUserId: '777888999',
            username: 'nguyenvana',
            chatIds: ['-100555666777'],
          },
        },
      }),
    ).rejects.toMatchObject({ category: 'AUTH_ERROR' });

    // 3. User removed from group -> AUTH_ERROR when only group was in previewed chatIds
    groupMember = false;
    await expect(
      factory.getAdapterForService('telegram', {
        userId: 'user-1',
        phase: 'execution',
        connections: {
          telegram: {
            credentialId: 'cred-tg-1',
            telegramUserId: '777888999',
            username: 'nguyenvana',
            chatIds: ['-100555666777'],
          },
        },
      }),
    ).rejects.toMatchObject({ category: 'AUTH_ERROR' });

    // 4. Chat removed from selectedChats -> AUTH_ERROR
    groupMember = true;
    currentCred = {
      ...currentCred,
      config: encryptCredentials(
        {
          telegramUserId: '777888999',
          username: 'nguyenvana',
          displayName: 'Nguyen Van A',
          selectedChats: [
            { chatId: '777888999', title: 'Telegram của tôi (Nguyen Van A)', type: 'private' },
          ],
        },
        ENCRYPTION_KEY,
      ),
    };
    await expect(
      factory.getAdapterForService('telegram', {
        userId: 'user-1',
        phase: 'execution',
        connections: {
          telegram: {
            credentialId: 'cred-tg-1',
            telegramUserId: '777888999',
            username: 'nguyenvana',
            chatIds: ['-100555666777'],
          },
        },
      }),
    ).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  });
});
