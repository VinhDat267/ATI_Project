import { decryptCredentials } from '@wap/tool-adapters';
import { normalizeTelegramChatId, TELEGRAM_CHAT_ID_PATTERN, type PlanConnections } from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { TelegramTeamChatItem } from '../../db/repositories/telegram-team-repo.js';
import type { TelegramBotClient } from './bot-client.js';

export type TelegramConnectionReference = NonNullable<PlanConnections['telegram']>;

export interface TelegramConnectionLookupOptions {
  credentialRepo:
    | Pick<CredentialRepo, 'getPersonalConnectionStatus'>
    | Pick<CredentialRepo, 'getPersonalCredentials'>;
  encryptionKey: string;
  botClient?: Pick<TelegramBotClient, 'getChatMember'>;
  timeoutMs?: number;
}

export interface TelegramConnectionLookupResult {
  status: 'not_connected' | 'reconnect_required' | 'needs_scope' | 'connected';
  connection?: TelegramConnectionReference;
  selectedChats: TelegramTeamChatItem[];
  telegramUserId?: string;
  username?: string;
  displayName?: string;
}

export function createTelegramConnectionLookup(options: TelegramConnectionLookupOptions) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  return async (userId: string): Promise<TelegramConnectionLookupResult> => {
    const credRepo = options.credentialRepo as any;
    const record = credRepo.getPersonalConnectionStatus
      ? await credRepo.getPersonalConnectionStatus('telegram', userId)
      : await credRepo.getPersonalCredentials('telegram', userId);

    if (!record) {
      return { status: 'not_connected', selectedChats: [] };
    }

    if (record.status !== 'active') {
      return { status: 'reconnect_required', selectedChats: [] };
    }

    let telegramUserId: string | undefined;
    let username: string | undefined;
    let displayName: string | undefined;
    let rawChats: TelegramTeamChatItem[] = [];

    try {
      const config = decryptCredentials(record.config, options.encryptionKey);
      telegramUserId = typeof config.telegramUserId === 'string' && config.telegramUserId.trim()
        ? normalizeTelegramChatId(config.telegramUserId.trim())
        : undefined;
      username = typeof config.username === 'string' ? config.username : '';
      displayName = typeof config.displayName === 'string' ? config.displayName : '';
      if (Array.isArray(config.selectedChats)) {
        rawChats = config.selectedChats
          .filter(
            (c: any) =>
              c &&
              typeof c.chatId === 'string' &&
              TELEGRAM_CHAT_ID_PATTERN.test(c.chatId.trim()) &&
              typeof c.title === 'string' &&
              c.title.trim(),
          )
          .map((c: any) => ({
            chatId: normalizeTelegramChatId(c.chatId),
            title: c.title.trim(),
            type: c.type || (c.chatId.startsWith('-') ? 'supergroup' : 'private'),
          }));
      }
    } catch {
      return { status: 'reconnect_required', selectedChats: [] };
    }

    if (!telegramUserId) {
      return { status: 'reconnect_required', selectedChats: [] };
    }

    if (rawChats.length === 0) {
      return {
        status: 'needs_scope',
        telegramUserId,
        username,
        displayName,
        selectedChats: [],
      };
    }

    const validChats: TelegramTeamChatItem[] = [];
    for (const chat of rawChats) {
      if (chat.type === 'private' || chat.chatId === telegramUserId) {
        if (chat.chatId === telegramUserId) {
          validChats.push(chat);
        }
        continue;
      }
      if (options.botClient) {
        try {
          const isMember = await options.botClient.getChatMember(
            chat.chatId,
            telegramUserId,
            AbortSignal.timeout(timeoutMs),
          );
          if (isMember) validChats.push(chat);
        } catch {
          // Skip group if membership check fails
        }
      } else {
        validChats.push(chat);
      }
    }

    if (validChats.length === 0) {
      return {
        status: 'needs_scope',
        telegramUserId,
        username,
        displayName,
        selectedChats: [],
      };
    }

    const chatIds = [...new Set(validChats.map((c) => c.chatId))].sort();

    return {
      status: 'connected',
      telegramUserId,
      username,
      displayName,
      selectedChats: validChats,
      connection: {
        credentialId: record.id,
        telegramUserId,
        username: username || '',
        chatIds,
      },
    };
  };
}
