import type { TelegramBotConfig } from '../../config/env.js';
import type { TelegramChatType, TelegramTeamChatItem } from '../../db/repositories/telegram-team-repo.js';
import { MemoryTelegramUpdateStore, projectTelegramUpdate, telegramStateHash, type TelegramUpdateStore } from './update-inbox.js';

export class TelegramBotError extends Error {
  constructor(
    readonly kind: 'unauthorized' | 'rejected' | 'network' | 'server',
    readonly status?: number,
  ) {
    super(`Telegram Bot API request failed: ${kind}${status ? ` (${status})` : ''}`);
    this.name = 'TelegramBotError';
  }
}

export type TelegramPairingResult =
  | { matched: false }
  | {
      matched: true;
      telegramUserId: string;
      username: string;
      displayName: string;
      pairedChat?: TelegramTeamChatItem;
      discoveredGroups: TelegramTeamChatItem[];
    };

const MAX_BODY_CHARS = 128_000;
// getUpdates contains up to 100 messages, unlike the single-object methods.
const MAX_UPDATES_BODY_CHARS = 1_048_576;

function normalizeChatType(raw: unknown): TelegramChatType {
  if (raw === 'private' || raw === 'group' || raw === 'supergroup' || raw === 'channel') {
    return raw;
  }
  return 'supergroup';
}

export class TelegramBotClient {
  constructor(
    private config: TelegramBotConfig,
    private fetchFn: typeof fetch = fetch,
    private updates: TelegramUpdateStore = new MemoryTelegramUpdateStore(),
  ) {}

  get botUsername(): string {
    return this.config.botUsername;
  }

  get botToken(): string {
    return this.config.botToken;
  }

  get apiBaseUrl(): string {
    return this.config.apiBaseUrl;
  }

  deepLinkUrl(state: string): string {
    return `${this.config.deepLinkBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(this.config.botUsername)}?start=ati_${encodeURIComponent(state)}`;
  }

  groupDeepLinkUrl(state: string): string {
    return `${this.config.deepLinkBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(this.config.botUsername)}?startgroup=ati_${encodeURIComponent(state)}`;
  }

  callbackUrl(state: string): string {
    const url = new URL(this.config.callbackUrl);
    url.searchParams.set('state', state);
    return url.href;
  }

  async verifyPairing(state: string, signal: AbortSignal): Promise<TelegramPairingResult> {
    const updates = await this.getUpdates(signal);
    const groupMap = new Map<string, TelegramTeamChatItem>();

    for (const u of updates) {
      const chat = u?.message?.chat ?? u?.my_chat_member?.chat ?? u?.channel_post?.chat;
      if (chat && (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel')) {
        const chatId = String(chat.id ?? '').trim();
        const title = String(chat.title ?? chat.username ?? chatId).trim();
        if (/^-?[1-9]\d{0,19}$/.test(chatId) && title) {
          groupMap.set(chatId, { chatId, title, type: normalizeChatType(chat.type) });
        }
      }
    }

    // Search from newest update to oldest for /start ati_<state> from a human user (is_bot !== true)
    for (let i = updates.length - 1; i >= 0; i--) {
      const msg = updates[i]?.message;
      const from = msg?.from;
      if (!from || from.is_bot === true || updates[i]?.pairingStateHash !== telegramStateHash(state)) continue;

      const telegramUserId = String(from.id ?? '').trim();
      if (!/^[1-9]\d{0,19}$/.test(telegramUserId)) continue;

      const firstLast = [from.first_name, from.last_name]
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean)
        .join(' ')
        .trim();
      const rawUsername = typeof from.username === 'string' ? from.username.trim().replace(/^@/, '') : '';
      const displayName = firstLast || rawUsername || `Telegram #${telegramUserId}`;
      const username = rawUsername || displayName;

      let pairedChat: TelegramTeamChatItem | undefined;
      if (msg.chat && (msg.chat.type === 'group' || msg.chat.type === 'supergroup')) {
        const chatId = String(msg.chat.id ?? '').trim();
        const title = String(msg.chat.title ?? msg.chat.username ?? chatId).trim();
        if (/^-?[1-9]\d{0,19}$/.test(chatId) && title) {
          pairedChat = { chatId, title, type: normalizeChatType(msg.chat.type) };
          groupMap.set(chatId, pairedChat);
        }
      }

      return {
        matched: true,
        telegramUserId,
        username,
        displayName,
        ...(pairedChat ? { pairedChat } : {}),
        discoveredGroups: [...groupMap.values()],
      };
    }

    return { matched: false };
  }

  async discoverGroups(signal: AbortSignal): Promise<TelegramTeamChatItem[]> {
    const updates = await this.getUpdates(signal);
    const groupMap = new Map<string, TelegramTeamChatItem>();
    for (const u of updates) {
      const chat = u?.message?.chat ?? u?.my_chat_member?.chat ?? u?.channel_post?.chat;
      if (chat && (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel')) {
        const chatId = String(chat.id ?? '').trim();
        const title = String(chat.title ?? chat.username ?? chatId).trim();
        if (/^-?[1-9]\d{0,19}$/.test(chatId) && title) {
          groupMap.set(chatId, { chatId, title, type: normalizeChatType(chat.type) });
        }
      }
    }
    return [...groupMap.values()];
  }

  async getChatMember(chatId: string, telegramUserId: string, signal: AbortSignal): Promise<boolean> {
    if (chatId === telegramUserId) return true;
    try {
      const result = await this.callMethod(
        'getChatMember',
        { chat_id: chatId, user_id: Number.isSafeInteger(Number(telegramUserId)) ? Number(telegramUserId) : telegramUserId },
        signal,
      );
      const status = result?.status;
      if (status === 'creator' || status === 'administrator' || status === 'member') {
        return true;
      }
      if (status === 'restricted') {
        return result?.is_member !== false;
      }
      return false;
    } catch (err) {
      if (err instanceof TelegramBotError && err.kind === 'rejected') {
        return false;
      }
      throw err;
    }
  }

  async getChat(chatId: string, signal: AbortSignal): Promise<TelegramTeamChatItem | null> {
    try {
      const chat = await this.callMethod('getChat', { chat_id: chatId }, signal);
      if (!chat || (typeof chat.id !== 'number' && typeof chat.id !== 'string')) return null;
      const id = String(chat.id).trim();
      const title =
        [chat.title, [chat.first_name, chat.last_name].filter(Boolean).join(' '), chat.username]
          .find((v) => typeof v === 'string' && v.trim())
          ?.trim() || id;
      return {
        chatId: id,
        title,
        type: normalizeChatType(chat.type),
      };
    } catch (err) {
      if (err instanceof TelegramBotError && err.kind === 'rejected') {
        return null;
      }
      throw err;
    }
  }

  private async getUpdates(signal: AbortSignal): Promise<any[]> {
    const botKey = telegramStateHash(`${this.config.apiBaseUrl}:${this.config.botToken}`);
    try {
      return await this.updates.poll(botKey, signal, async (offset) => {
        const result = await this.callMethod(
          'getUpdates',
          { limit: 100, timeout: 0, allowed_updates: ['message', 'my_chat_member', 'channel_post'], ...(offset !== undefined ? { offset } : {}) },
          signal,
        );
        if (!Array.isArray(result)) throw new TelegramBotError('server');
        return result.map(projectTelegramUpdate);
      });
    } catch (error) {
      if (error instanceof TelegramBotError) throw error;
      throw new TelegramBotError(signal.aborted ? 'network' : 'server');
    }
  }

  private async callMethod(method: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<any> {
    if (signal?.aborted) {
      throw new TelegramBotError('network');
    }

    const base = this.config.apiBaseUrl.replace(/\/$/, '');
    const url = `${base}/bot${this.config.botToken}/${method}`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'manual',
        signal,
      });
    } catch {
      throw new TelegramBotError('network');
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new TelegramBotError('network');
    }

    let body: any = null;
    try {
      const limit = method === 'getUpdates' ? MAX_UPDATES_BODY_CHARS : MAX_BODY_CHARS;
      body = text && text.length <= limit ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (response.ok && body?.ok === true) {
      return body.result;
    }

    const status = response.status;
    if (status === 401 || body?.error_code === 401) {
      throw new TelegramBotError('unauthorized', 401);
    }
    if (status >= 500 || status < 400) {
      throw new TelegramBotError('server', status);
    }
    throw new TelegramBotError('rejected', status);
  }
}
