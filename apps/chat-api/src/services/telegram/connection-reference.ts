import { decryptCredentials } from '@wap/tool-adapters';
import { normalizeTelegramChatId, TELEGRAM_CHAT_ID_PATTERN, type PlanConnections } from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { TelegramTeamChatItem } from '../../db/repositories/telegram-team-repo.js';
import { TelegramBotError, type TelegramBotClient } from './bot-client.js';

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
  status: 'not_connected' | 'reconnect_required' | 'needs_scope' | 'unavailable' | 'connected';
  connection?: TelegramConnectionReference;
  selectedChats: TelegramTeamChatItem[];
  unavailableChatIds?: string[];
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
    const unavailableChatIds: string[] = [];
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
        } catch (err) {
          if (err instanceof TelegramBotError && err.kind === 'unauthorized') {
            return { status: 'reconnect_required', selectedChats: [] };
          }
          if (err instanceof TelegramBotError && err.kind === 'rejected' && err.status !== 429) {
            continue;
          }
          unavailableChatIds.push(chat.chatId);
        }
      } else {
        validChats.push(chat);
      }
    }

    if (validChats.length === 0) {
      if (unavailableChatIds.length > 0) {
        return {
          status: 'unavailable',
          telegramUserId,
          username,
          displayName,
          selectedChats: [],
          unavailableChatIds,
        };
      }
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
      ...(unavailableChatIds.length > 0 ? { unavailableChatIds } : {}),
      connection: {
        credentialId: record.id,
        telegramUserId,
        username: username || '',
        chatIds,
      },
    };
  };
}
