import { createHash } from 'node:crypto';

export interface TelegramUpdateStore {
  poll(botKey: string, signal: AbortSignal, fetchPage: (offset?: number) => Promise<any[]>): Promise<any[]>;
}

export const telegramStateHash = (state: string) => createHash('sha256').update(state).digest('hex');
// Telegram may restart update IDs after a week without updates. Reset a day
// early so clock skew or an in-flight request cannot acknowledge an unseen ID.
export const TELEGRAM_CURSOR_IDLE_MS = 6 * 24 * 60 * 60_000;

/** Minimize before persistence: no ordinary message text or raw pairing state. */
export function projectTelegramUpdate(update: any): any {
  if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) throw new Error('Invalid Telegram update ID');
  const result: any = { update_id: update.update_id };
  const msg = update.message;
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  const match = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+ati_([A-Za-z0-9_-]{16,128})$/);
  const chat = msg?.chat ?? update.my_chat_member?.chat ?? update.channel_post?.chat;
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

export function telegramUpdateRetention(update: any): number {
  const type = update.message?.chat?.type;
  return type === 'group' || type === 'supergroup' || type === 'channel' ? 24 * 60 * 60_000 : 10 * 60_000;
}

/** For standalone clients; the server injects the PostgreSQL implementation. */
export class MemoryTelegramUpdateStore implements TelegramUpdateStore {
  private next?: number;
  private lastUpdateAt = 0;
  private inbox = new Map<number, { update: any; expires: number }>();
  private tail = Promise.resolve();

  async poll(_botKey: string, signal: AbortSignal, fetchPage: (offset?: number) => Promise<any[]>): Promise<any[]> {
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
      if (batch.length > 0) this.lastUpdateAt = now;
      for (const update of batch) {
        this.next = Math.max(this.next ?? 0, update.update_id + 1);
        if (update.message && !this.inbox.has(update.update_id)) {
          this.inbox.set(update.update_id, { update, expires: now + telegramUpdateRetention(update) });
        }
      }
      return [...this.inbox.values()].map(saved => saved.update).sort((a, b) => a.update_id - b.update_id);
    } finally { release(); }
  }
}
