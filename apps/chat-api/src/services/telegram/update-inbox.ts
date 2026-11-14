import { createHash } from 'node:crypto';

export interface TelegramCachedChatMessage {
  chatId: string;
  messageId: number;
  date: number;
  text: string;
  from?: {
    first_name?: string;
    last_name?: string;
    username?: string;
    title?: string;
  };
}

export const TELEGRAM_CHAT_MESSAGES = Symbol('telegramChatMessages');
export type TelegramProjectedBatch = any[] & { [TELEGRAM_CHAT_MESSAGES]?: TelegramCachedChatMessage[] };

export interface TelegramUpdateStore {
  poll(botKey: string, signal: AbortSignal, fetchPage: (offset?: number) => Promise<any[]>): Promise<any[]>;
  readChatMessages?(botKey: string, chatId: string): Promise<TelegramCachedChatMessage[]>;
}

export const telegramStateHash = (state: string) => createHash('sha256').update(state).digest('hex');
// Telegram may restart update IDs after a week without updates. Reset a day
// early so clock skew or an in-flight request cannot acknowledge an unseen ID.
export const TELEGRAM_CURSOR_IDLE_MS = 6 * 24 * 60 * 60_000;
export const TELEGRAM_CHAT_MESSAGE_RETENTION_MS = 24 * 60 * 60_000;
export const TELEGRAM_CHAT_MESSAGE_LIMIT = 100;

/** Minimize before persistence: no ordinary message text or raw pairing state. */
export function projectTelegramUpdate(update: any): any {
  if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) throw new Error('Invalid Telegram update ID');
  const result: any = { update_id: update.update_id };
  const msg = update.message;
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  const match = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+ati_([A-Za-z0-9_-]{16,128})$/);
  const chat = msg?.chat ?? update.my_chat_member?.chat ?? update.channel_post?.chat ?? update.edited_message?.chat;
  const group = chat && ['group', 'supergroup', 'channel'].includes(chat.type);
  if (match && msg?.from && msg.from.is_bot !== true) {
    result.pairingStateHash = telegramStateHash(match[1]!);
    result.message = {
      from: {
        id: msg.from.id, is_bot: false,
        first_name: String(msg.from.first_name ?? '').slice(0, 200),
        last_name: String(msg.from.last_name ?? '').slice(0, 200),
        username: String(msg.from.username ?? '').slice(0, 64),
      },
    };
  }
  if (group || result.pairingStateHash) {
    const projectedChat = {
      id: chat?.id, type: chat?.type,
      title: String(chat?.title ?? '').slice(0, 300),
      username: String(chat?.username ?? '').slice(0, 64),
    };
    result.message = { ...result.message, chat: projectedChat };
  }
  return result;
}

/** Extract bounded ordinary chat message metadata/text without pairing codes or bot secrets. */
export function extractTelegramChatMessage(update: any, botToken?: string): TelegramCachedChatMessage | null {
  const msg = update?.message ?? update?.edited_message ?? update?.channel_post;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  if (!Number.isSafeInteger(msg.message_id) || msg.message_id < 1) return null;
  if (!Number.isSafeInteger(msg.date) || msg.date < 0) return null;
  const chat = msg.chat;
  if (!chat || typeof chat !== 'object' || !Number.isSafeInteger(chat.id)) return null;
  const rawText = typeof msg.text === 'string' ? msg.text.trim() : typeof msg.caption === 'string' ? msg.caption.trim() : '';
  if (!rawText || /^\/start(?:@[A-Za-z0-9_]+)?\s+ati_/i.test(rawText)) return null;
  if ((botToken && rawText.includes(botToken)) || /api\.telegram\.org\/bot/i.test(rawText)) return null;

  const sender = msg.from && typeof msg.from === 'object'
    ? msg.from
    : msg.sender_chat && typeof msg.sender_chat === 'object'
      ? msg.sender_chat
      : undefined;

  const from: TelegramCachedChatMessage['from'] = sender
    ? {
        ...(typeof sender.first_name === 'string' && sender.first_name.trim() ? { first_name: sender.first_name.slice(0, 200) } : {}),
        ...(typeof sender.last_name === 'string' && sender.last_name.trim() ? { last_name: sender.last_name.slice(0, 200) } : {}),
        ...(typeof sender.username === 'string' && sender.username.trim() ? { username: sender.username.slice(0, 64) } : {}),
        ...(typeof sender.title === 'string' && sender.title.trim() ? { title: sender.title.slice(0, 300) } : {}),
      }
    : undefined;

  return {
    chatId: String(chat.id),
    messageId: msg.message_id,
    date: msg.date,
    text: Array.from(rawText).slice(0, 1000).join(''),
    ...(from && Object.keys(from).length > 0 ? { from } : {}),
  };
}

export function telegramUpdateRetention(update: any): number {
  const type = update.message?.chat?.type;
  return type === 'group' || type === 'supergroup' || type === 'channel' ? 24 * 60 * 60_000 : 10 * 60_000;
}

/** For standalone clients; the server injects the PostgreSQL implementation. */
export class MemoryTelegramUpdateStore implements TelegramUpdateStore {
  private next?: number;
  private lastUpdateAt = 0;
  private inbox = new Map<number, { update: any; expires: number }>();
  private chatInbox = new Map<string, Map<number, { message: TelegramCachedChatMessage; expires: number }>>();
  private tail = Promise.resolve();

  async poll(botKey: string, signal: AbortSignal, fetchPage: (offset?: number) => Promise<any[]>): Promise<any[]> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      signal.throwIfAborted();
      if (Date.now() - this.lastUpdateAt >= TELEGRAM_CURSOR_IDLE_MS) this.next = undefined;
      const batch = await fetchPage(this.next);
      signal.throwIfAborted();
      const now = Date.now();
      for (const [id, saved] of this.inbox) if (saved.expires <= now) this.inbox.delete(id);
      for (const [key, chatMap] of this.chatInbox) {
        for (const [id, saved] of chatMap) if (saved.expires <= now) chatMap.delete(id);
        if (chatMap.size === 0) this.chatInbox.delete(key);
      }
      if (batch.length > 0) this.lastUpdateAt = now;
      for (const update of batch) {
        this.next = Math.max(this.next ?? 0, update.update_id + 1);
        if (update.message && !this.inbox.has(update.update_id)) {
          this.inbox.set(update.update_id, { update, expires: now + telegramUpdateRetention(update) });
        }
      }
      const chatMessages = (batch as TelegramProjectedBatch)[TELEGRAM_CHAT_MESSAGES];
      if (Array.isArray(chatMessages)) {
        for (const msg of chatMessages) {
          const chatKey = `${botKey}:${msg.chatId}`;
          let chatMap = this.chatInbox.get(chatKey);
          if (!chatMap) {
            chatMap = new Map();
            this.chatInbox.set(chatKey, chatMap);
          }
          chatMap.set(msg.messageId, { message: msg, expires: now + TELEGRAM_CHAT_MESSAGE_RETENTION_MS });
        }
        for (const msg of chatMessages) {
          const chatKey = `${botKey}:${msg.chatId}`;
          const chatMap = this.chatInbox.get(chatKey);
          if (chatMap && chatMap.size > TELEGRAM_CHAT_MESSAGE_LIMIT) {
            const keepIds = new Set(
              [...chatMap.values()]
                .sort((a, b) => b.message.date - a.message.date || b.message.messageId - a.message.messageId)
                .slice(0, TELEGRAM_CHAT_MESSAGE_LIMIT)
                .map((entry) => entry.message.messageId),
            );
            for (const id of [...chatMap.keys()]) {
              if (!keepIds.has(id)) chatMap.delete(id);
            }
          }
        }
      }
      return [...this.inbox.values()].map(saved => saved.update).sort((a, b) => a.update_id - b.update_id);
    } finally { release(); }
  }

  async readChatMessages(botKey: string, chatId: string): Promise<TelegramCachedChatMessage[]> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const now = Date.now();
      const chatMap = this.chatInbox.get(`${botKey}:${chatId}`);
      if (!chatMap) return [];
      for (const [id, saved] of chatMap) {
        if (saved.expires <= now) chatMap.delete(id);
      }
      return [...chatMap.values()]
        .map((saved) => saved.message)
        .sort((a, b) => b.date - a.date || b.messageId - a.messageId)
        .slice(0, TELEGRAM_CHAT_MESSAGE_LIMIT);
    } finally { release(); }
  }
}
