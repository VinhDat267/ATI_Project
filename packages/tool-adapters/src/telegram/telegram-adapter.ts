import { TELEGRAM_CHAT_ID_PATTERN, normalizeTelegramChatId } from '@wap/tool-schemas';
import { BaseAdapter, StepError, type BaseAdapterConfig, type ErrorCategory } from '../base-adapter.js';
import { GlobalRateLimiter, waitWithSignal } from '../rate-limiter.js';

export interface TelegramAdapterConfig extends BaseAdapterConfig {
  credentials: { botToken: string };
  fetchFn?: typeof fetch;
  chatRateLimiter?: GlobalRateLimiter;
  groupRateLimiter?: GlobalRateLimiter;
}
// Shared across factory instances in this process. Keys remain internal: never
// use BaseAdapter's key-bearing timeout message for a token-bearing key.
const requestLimiter = new GlobalRateLimiter({ maxRequests: 30, windowMs: 1000 });
const chatLimiter = new GlobalRateLimiter({ maxRequests: 1, windowMs: 1000 });
const groupLimiter = new GlobalRateLimiter({ maxRequests: 1, windowMs: 3000 });
const chatTypes = new Set(['private', 'group', 'supergroup', 'channel']);
const fail = (category: ErrorCategory, statusCode?: number) => new StepError({
  category, statusCode, retryable: false,
  message: category === 'UNKNOWN' ? 'Telegram write outcome is unknown; verify before sending again.' : 'Telegram request failed: ' + category,
});
const record = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;

export class TelegramAdapter extends BaseAdapter {
  readonly service = 'telegram';
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  private readonly chatRate: GlobalRateLimiter;
  private readonly groupRate: GlobalRateLimiter;

  constructor(config: TelegramAdapterConfig) {
    super(config); this.token = config.credentials.botToken; this.fetchFn = config.fetchFn ?? fetch;
    this.rateLimiter = config.rateLimiter ?? requestLimiter;
    this.chatRate = config.chatRateLimiter ?? chatLimiter; this.groupRate = config.groupRateLimiter ?? groupLimiter;
  }

  async checkConnection(signal?: AbortSignal): Promise<boolean> {
    const result = await this.request('getMe', {}, false, signal);
    if (!record(result) || !integer(result.id, 1) || result.is_bot !== true) throw fail('SERVER_ERROR');
    return true;
  }

  async execute(toolName: string, args: Record<string, any>, context?: { signal?: AbortSignal }): Promise<any> {
    if (!record(args)) throw fail('VALIDATION');
    const signal = context?.signal;
    if (toolName === 'telegram.list_chats') {
      if (typeof args.query !== 'string' || Array.from(args.query).length > 2000 ||
          Object.keys(args).some(key => !['query', 'limit'].includes(key)) ||
          (args.limit !== undefined && (!integer(args.limit, 1) || args.limit > 10))) throw fail('VALIDATION');
      const ids = this.scope(); const results: Array<{ id: string; title: string; type: string }> = [];
      const query = args.query.trim().toLocaleLowerCase();
      for (const id of ids) {
        const chat = this.chat(await this.request('getChat', { chat_id: id }, false, signal), id);
        if (!query || chat.title.toLocaleLowerCase().includes(query)) results.push(chat);
        if (results.length >= (args.limit ?? 10)) break;
      }
      return results;
    }
    if (toolName === 'telegram.send_message') {
      if (typeof args.chatId !== 'string' || !TELEGRAM_CHAT_ID_PATTERN.test(args.chatId) ||
          typeof args.text !== 'string' || Array.from(args.text).length < 1 || Array.from(args.text).length > 4096 ||
          Object.keys(args).some(key => !['chatId', 'text'].includes(key))) throw fail('VALIDATION');
      const id = normalizeTelegramChatId(args.chatId);
      if (!this.scope().includes(id)) throw fail('AUTH_ERROR', 403);
      // A fresh read establishes chat identity and group type before any write.
      const chat = this.chat(await this.request('getChat', { chat_id: id }, false, signal), id);
      const limiter = chat.type === 'group' || chat.type === 'supergroup' ? this.groupRate : this.chatRate;
      const result = await this.request('sendMessage', {
        chat_id: id, text: args.text, link_preview_options: { is_disabled: true }, allow_paid_broadcast: false,
      }, true, signal, { limiter, key: this.token + ':' + id });
      if (!record(result) || !integer(result.message_id, 1) || !integer(result.date) ||
          !record(result.chat) || !Number.isSafeInteger(result.chat.id) || String(result.chat.id) !== id) throw fail('UNKNOWN');
      return { messageId: result.message_id, chatId: id, date: result.date };
    }
    throw fail('VALIDATION');
  }

  private scope(): string[] {
    const values = this.allowedScope?.chats;
    if (!Array.isArray(values) || !values.length || !values.every(id => typeof id === 'string' && TELEGRAM_CHAT_ID_PATTERN.test(id.trim()))) throw fail('AUTH_ERROR', 403);
    return [...new Set(values.map(normalizeTelegramChatId))];
  }

  private chat(value: unknown, requested: string) {
    if (!record(value) || !Number.isSafeInteger(value.id) || String(value.id) !== requested || !chatTypes.has(value.type)) throw fail('SERVER_ERROR');
    const title = typeof value.title === 'string' && value.title.trim() ? value.title
      : [value.first_name, value.last_name].filter(part => typeof part === 'string' && part.trim()).join(' ') ||
        (typeof value.username === 'string' && value.username.trim() ? value.username : requested);
    if (title.includes(this.token) || /api\.telegram\.org\/bot/i.test(title)) throw fail('SERVER_ERROR');
    return { id: requested, title, type: String(value.type) };
  }

  private async slot(limiter: GlobalRateLimiter, key: string, signal?: AbortSignal) {
    try {
      if (!await limiter.waitForSlot(key, 30_000, 50, signal)) throw fail('RATE_LIMIT', 429);
    } catch {
      throw signal?.aborted ? fail('NETWORK') : fail('RATE_LIMIT', 429);
    }
  }

  private retryDelay(body: unknown, header: string | null): number | null {
    if (record(body) && record(body.parameters) && 'retry_after' in body.parameters) {
      const seconds = body.parameters.retry_after;
      return integer(seconds) ? seconds * 1000 : null;
    }
    if (header === null) return null;
    const trimmed = header.trim();
    const delay = /^\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - Date.now();
    return Number.isFinite(delay) && delay >= 0 ? delay : null;
  }

  private async request(method: 'getMe' | 'getChat' | 'sendMessage', body: object, write: boolean, signal?: AbortSignal,
    pacing?: { limiter: GlobalRateLimiter; key: string }): Promise<any> {
    if (typeof this.token !== 'string' || !/^\d{1,20}:[A-Za-z0-9_-]{10,200}$/.test(this.token)) throw fail('AUTH_ERROR', 401);
    let networkRetries = 0; let serverRetries = 0; let rateRetries = 0;
    for (;;) {
      if (signal?.aborted) throw fail('NETWORK');
      await this.slot(this.rateLimiter!, this.token, signal);
      // Last reservation before dispatch: transport contention cannot collapse
      // the per-chat send interval. A provider retry takes a fresh message slot.
      if (pacing) await this.slot(pacing.limiter, pacing.key, signal);
      if (signal?.aborted) throw fail('NETWORK');
      let response: Response;
      try {
        response = await this.fetchFn('https://api.telegram.org/bot' + this.token + '/' + method, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal,
        });
      } catch {
        if (write) throw fail('UNKNOWN');
        if (!signal?.aborted && networkRetries++ < 2) continue;
        throw fail('NETWORK');
      }
      let envelope: unknown;
      try { envelope = await response.json(); } catch { envelope = null; }
      // A success envelope contradicting HTTP failure is not definite rejection:
      // the provider may already have sent the message. Never recover/replay it.
      if (write && (response.status < 200 || response.status >= 300) && record(envelope) && envelope.ok === true) {
        throw fail('UNKNOWN', response.status);
      }
      const code = response.status >= 400 ? response.status
        : record(envelope) && envelope.ok === false && integer(envelope.error_code, 400) ? envelope.error_code : undefined;
      if (code === 429) {
        const delay = this.retryDelay(envelope, response.headers?.get('Retry-After') ?? null);
        if (rateRetries++ >= 1 || delay === null || delay > 30_000) throw fail('RATE_LIMIT', 429);
        try { await waitWithSignal(delay, signal); } catch { throw fail('NETWORK'); }
        continue;
      }
      if (code !== undefined) {
        if (code >= 500) {
          if (write) throw fail('UNKNOWN', code);
          if (!signal?.aborted && serverRetries++ < 1) continue;
          throw fail('SERVER_ERROR', code);
        }
        throw fail(code === 401 || code === 403 ? 'AUTH_ERROR' : code === 404 ? 'NOT_FOUND' : 'VALIDATION', code);
      }
      if (response.status < 200 || response.status >= 300 || !record(envelope) || envelope.ok !== true || !('result' in envelope)) {
        throw fail(write ? 'UNKNOWN' : 'SERVER_ERROR');
      }
      return envelope.result;
    }
  }
}
