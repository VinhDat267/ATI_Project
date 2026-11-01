import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSandboxAdapter } from '../../src/sandbox/index.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { createToolRuntimeFactory } from '../../src/config/gmail-tools-runtime.js';
import { TELEGRAM_FAKE } from '../../src/sandbox/fake-results/telegram.js';
import { StepError, encryptCredentials } from '@wap/tool-adapters';

describe('Task 10: Telegram sandbox and personal connection enforcement', () => {
  const key = 'test-encryption-key-must-be-32-bytes!';
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (info: any) => {
      const url = typeof info === 'string' ? info : info?.url || '';
      if (url.includes('api.telegram.org')) {
        throw new Error(`Real network call to api.telegram.org was attempted: ${url}`);
      }
      return new Response('{}', { status: 200 });
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('TELEGRAM_FAKE implements fake results for all 3 Telegram tools without calling api.telegram.org', async () => {
    const threeTools = ['telegram.list_chats', 'telegram.get_chat', 'telegram.send_message'];
    for (const tool of threeTools) {
      expect(typeof TELEGRAM_FAKE.tools[tool], `Expected handler for ${tool}`).toBe('function');
    }

    const adapter = createSandboxAdapter('telegram');
    const chats = await adapter.execute('telegram.list_chats', { query: '', limit: 10 });
    expect(chats).toEqual([{ id: '-1001234567890', title: 'ATI Test', type: 'supergroup' }]);

    const chat = await adapter.execute('telegram.get_chat', { chatId: '-1001234567890' });
    expect(chat).toEqual({
      id: '-1001234567890',
      title: 'ATI Test',
      type: 'supergroup',
    });

    const sent = await adapter.execute('telegram.send_message', {
      chatId: '-1001234567890',
      text: 'Báo cáo sandbox',
    });
    expect(sent).toEqual({
      messageId: 42,
      chatId: '-1001234567890',
      date: 1791014400,
    });

    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain('api.telegram.org');
    }
  });

  it('in sandbox mode, execution with valid personal connection returns fake result without calling api.telegram.org and enforces chatId scope', async () => {
    const userId = 'user-tg-1';
    const credentialId = 'cred-tg-1';
    const chatId = '777001';

    const credRepo: any = {
      getPersonalCredentials: vi.fn().mockResolvedValue({
        id: credentialId,
        service: 'telegram',
        userId,
        status: 'active',
        config: encryptCredentials(
          {
            telegramUserId: '777001',
            username: 'an_nguyen',
            displayName: 'Nguyễn Văn An',
            knownChats: [{ chatId, title: 'Telegram của tôi (Nguyễn Văn An)', type: 'private' }],
            selectedChats: [{ chatId, title: 'Telegram của tôi (Nguyễn Văn An)', type: 'private' }],
          },
          key
        ),
        allowedScope: [chatId],
      }),
      getCredentials: vi.fn().mockResolvedValue(null),
    };

    const realFactory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: key,
      telegramBot: {
        botToken: '123456789:synthetic_bot_token_abcdefghijkl',
        botUsername: 'ati_assistant_bot',
        apiBaseUrl: 'https://api.telegram.org',
      },
      createTelegramAdapter: ({ allowedChats }) => {
        const sandbox = createSandboxAdapter('telegram');
        return {
          execute: async (tool, args, ctx) => {
            const targetChatId = ctx?.chatId ?? args?.chatId;
            if (targetChatId && !allowedChats.includes(String(targetChatId))) {
              throw new StepError({
                category: 'AUTH_ERROR',
                message: 'Cuộc trò chuyện không nằm trong phạm vi được phép.',
              });
            }
            return sandbox.execute(tool, args, ctx);
          },
        };
      },
    });

    const factory = createToolRuntimeFactory(
      'sandbox',
      (service, ctx) => realFactory.getAdapterForService(service, ctx),
      (service) => createSandboxAdapter(service)
    );

    const adapter = await factory.getAdapterForService('telegram', {
      userId,
      phase: 'execution',
      connections: {
        telegram: {
          credentialId,
          telegramUserId: '777001',
          username: 'an_nguyen',
          chatIds: [chatId],
        },
      },
    });

    const result = await adapter.execute('telegram.send_message', {
      chatId,
      text: 'Báo cáo sáng trong sandbox',
    });

    expect(result).toEqual({
      messageId: 42,
      chatId,
      date: 1791014400,
    });

    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain('api.telegram.org');
    }

    await expect(
      adapter.execute('telegram.send_message', { chatId: '-100999999', text: 'Forbidden' })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
    });
  });

  it('in sandbox mode, execution without personal connection fails with AUTH_ERROR and does not fall back to shared credentials', async () => {
    const credRepo: any = {
      getPersonalCredentials: vi.fn().mockResolvedValue(null),
      getCredentials: vi.fn().mockResolvedValue({
        service: 'telegram',
        config: encryptCredentials({ botToken: '123456789:legacy_shared_token' }, key),
      }),
    };

    const realFactory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: key,
    });

    const factory = createToolRuntimeFactory(
      'sandbox',
      (service, ctx) => realFactory.getAdapterForService(service, ctx),
      (service) => createSandboxAdapter(service)
    );

    await expect(
      factory.getAdapterForService('telegram', {
        userId: 'user-no-telegram',
        phase: 'execution',
      })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
    });
  });
});
