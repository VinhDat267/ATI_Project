import { GMAIL_TOOLS } from '@wap/tool-schemas';
import { StepError } from '../base-adapter.js';
import { GlobalRateLimiter, retryAfterMs, waitWithSignal } from '../rate-limiter.js';
import type { GmailAccessTokenProvider } from './token-provider.js';
import { attachments, bareAddress, cut, header, headerAddresses, messageText, participants, rawMessage, safeHeader, type GmailMessage, type GmailThread } from './mail-format.js';

export interface GmailToolAdapterOptions {
  tokens: GmailAccessTokenProvider;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  /** Each adapter belongs to one member; its limiter must not be shared across members. */
  limiter?: GlobalRateLimiter;
}
function invalid(message: string): never { throw new StepError({ category: 'VALIDATION', message }); }
function check(value: any, schema: any, path: string): void {
  if (schema.type === 'string') {
    if (typeof value !== 'string') invalid(`${path} must be a literal string`);
    if (schema.minLength != null && Array.from(value).length < schema.minLength || schema.maxLength != null && Array.from(value).length > schema.maxLength) invalid(`${path} length exceeds Gmail limits`);
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value) || value < schema.minimum || value > schema.maximum) invalid(`${path} is out of range`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) invalid(`${path} must be a bounded literal array`);
    value.forEach((v: any, i: number) => check(v, schema.items, `${path}[${i}]`));
  } else if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${path} must be an object`);
    for (const key of schema.required ?? []) if (value[key] === undefined) invalid(`${path}.${key} is required`);
    for (const key of Object.keys(value)) {
      if (!schema.properties[key]) invalid(`${path}.${key} is unsupported`);
      check(value[key], schema.properties[key], `${path}.${key}`);
    }
    if (schema.anyOf && !schema.anyOf.some((s: any) => s.required.every((k: string) => value[k] !== undefined))) invalid(`${path} requires labels to add or remove`);
  }
}
export function createGmailToolAdapter(options: GmailToolAdapterOptions) {
  const baseUrl = (options.baseUrl ?? 'https://gmail.googleapis.com').replace(/\/$/, '');
  const fetchFn = options.fetchFn ?? fetch;
  const limiter = options.limiter ?? new GlobalRateLimiter({ maxRequests: 20, windowMs: 1000 });
  return { async execute(toolName: string, input: Record<string, any>, context?: { signal?: AbortSignal }): Promise<any> {
    let writeDispatched = false;
    const signal = context?.signal ?? AbortSignal.timeout(15_000);
    try {
      const tool = GMAIL_TOOLS.find(t => t.name === toolName);
      if (!tool) invalid('Unknown Gmail tool');
      check(input, tool.inputSchema, 'args');
      const args = { ...input };
      for (const key of ['threadId', 'name', 'query', 'subject']) if (args[key] != null) safeHeader(args[key]);
      if (args.threadId && !/^[A-Za-z0-9_-]+$/.test(args.threadId)) invalid('Invalid Gmail threadId');
      for (const key of ['addLabelIds', 'removeLabelIds']) if (args[key]?.some((id: string) => !/^[A-Za-z0-9_-]+$/.test(id))) invalid('Invalid Gmail label id');
      for (const key of ['to', 'cc', 'bcc']) if (args[key]) args[key] = args[key].map(bareAddress);
      if (['to', 'cc', 'bcc'].reduce((n, key) => n + (args[key]?.length ?? 0), 0) > 20) invalid('Gmail allows at most 20 recipients total');
      async function request(path: string, body?: any): Promise<any> {
        const write = body !== undefined;
        let refreshed = false, forceRefresh = false, retries = 0;
        for (;;) {
          signal.throwIfAborted();
          if (!await limiter.waitForSlot('gmail', 30_000, 50, signal)) throw new StepError({ category: 'RATE_LIMIT', message: 'Gmail rate limiter timed out' });
          const token = await options.tokens.getAccessToken({ signal, ...(forceRefresh ? { forceRefresh: true } : {}) });
          forceRefresh = false;
          signal.throwIfAborted();
          let response: Response;
          try {
            if (write) writeDispatched = true;
            response = await fetchFn(`${baseUrl}/gmail/v1/users/me/${path}`, { method: write ? 'POST' : 'GET',
              redirect: 'manual', signal, headers: { Authorization: `Bearer ${token}`, ...(write ? { 'Content-Type': 'application/json' } : {}) },
              ...(write ? { body: JSON.stringify(body) } : {}) });
          } catch {
            throw new StepError({ category: write ? 'UNKNOWN' : 'NETWORK', message: write ? 'Gmail write result is unknown; check Sent before continuing' : 'Gmail request interrupted' });
          }
          let data: any;
          try { data = await response.json(); } catch {
            throw new StepError({ category: write ? 'UNKNOWN' : 'SERVER_ERROR', message: 'Gmail returned an unreadable response' });
          }
          if (response.ok) {
            const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
            const invalidWrite = write && (!id(data?.id) ||
              path === 'messages/send' && !id(data?.threadId) ||
              path === 'drafts' && (!id(data?.message?.id) || !id(data?.message?.threadId)) ||
              path === 'labels' && typeof data?.name !== 'string' ||
              path.endsWith('/modify') && (!Array.isArray(data?.messages) || data.messages.some((message: any) => !message || typeof message !== 'object' || message.labelIds !== undefined && (!Array.isArray(message.labelIds) || message.labelIds.some((label: unknown) => !id(label))))));
            if (!data || typeof data !== 'object' || invalidWrite) throw new StepError({ category: write ? 'UNKNOWN' : 'SERVER_ERROR', message: 'Gmail returned an invalid response' });
            return data;
          }
          // 401 is a definitive rejection: no write occurred. A refresh failure
          // before the next attempt is known unsent, unlike an ambiguous response.
          if (response.status === 401 && !refreshed) { refreshed = true; forceRefresh = true; if (write) writeDispatched = false; continue; }
          const reasons = data?.error?.errors?.map((e: any) => e.reason) ?? [];
          const quota = response.status === 429 || response.status === 403 && reasons.some((r: string) => /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded/i.test(r));
          if (quota && !write && retries++ < 2) { await waitWithSignal(Math.min(5000, retryAfterMs(response.headers.get('retry-after'))), signal); continue; }
          const category = quota ? 'RATE_LIMIT' : [401, 403].includes(response.status) ? 'AUTH_ERROR' : response.status === 404 ? 'NOT_FOUND' : response.status === 400 ? 'VALIDATION' : write ? 'UNKNOWN' : 'SERVER_ERROR';
          throw new StepError({ category, statusCode: response.status, message: `Gmail request failed (${response.status})` });
        }
      }
      const readThread = async (id: string, format = 'full'): Promise<GmailThread> => request(`threads/${encodeURIComponent(id)}?format=${format}`);
      const summary = (thread: GmailThread) => {
        const messages = thread.messages ?? [], latest = messages.at(-1) ?? { id: '' };
        return { id: thread.id, subject: cut(header(latest, 'Subject'), 250), from: header(latest, 'From'), to: headerAddresses(header(latest, 'To')), cc: headerAddresses(header(latest, 'Cc')),
          snippet: cut(latest.snippet ?? '', 200), date: header(latest, 'Date'), labels: [...new Set(messages.flatMap(m => m.labelIds ?? []))], messageCount: messages.length,
          unread: messages.some(m => m.labelIds?.includes('UNREAD')), participants: participants(messages) };
      };
      switch (toolName) {
        case 'gmail.search_threads': {
          const params = new URLSearchParams({ q: args.query, maxResults: String(args.limit ?? 10) });
          const result = await request(`threads?${params}`);
          const threads = (result.threads ?? []).slice(0, args.limit ?? 10);
          return await Promise.all(threads.map(async (t: any) => summary(await readThread(t.id, 'metadata'))));
        }
        case 'gmail.get_thread': {
          const thread = await readThread(args.threadId); let remaining = 12000;
          return { id: thread.id, subject: summary(thread).subject, participants: participants(thread.messages ?? []), messages: (thread.messages ?? []).slice(-5).map(m => {
            const body = cut(messageText(m), Math.min(4000, remaining)); remaining -= Array.from(body).length;
            return { messageId: m.id, from: header(m, 'From'), to: headerAddresses(header(m, 'To')), cc: headerAddresses(header(m, 'Cc')), date: header(m, 'Date'), subject: cut(header(m, 'Subject'), 250), body, attachments: attachments(m.payload) };
          }) };
        }
        case 'gmail.list_labels': {
          const data = await request('labels'); return (data.labels ?? []).filter((l: any) => l.name.toLowerCase().includes(args.query.toLowerCase())).slice(0, args.limit ?? 10).map((l: any) => ({ id: l.id, name: l.name, type: l.type }));
        }
        case 'gmail.modify_thread_labels': {
          const thread = await request(`threads/${args.threadId}/modify`, { ...(args.addLabelIds ? { addLabelIds: args.addLabelIds } : {}), ...(args.removeLabelIds ? { removeLabelIds: args.removeLabelIds } : {}) });
          return { id: thread.id, labelIds: [...new Set(thread.messages.flatMap((message: GmailMessage) => message.labelIds ?? []))] };
        }
        case 'gmail.trash_thread': return await request(`threads/${args.threadId}/trash`, {});
        case 'gmail.create_label': return await request('labels', { name: args.name, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
        default: {
          let subject = args.subject ?? '', body = args.body ?? '', inReplyTo: string | undefined, references: string | undefined;
          if (args.threadId) {
            const thread = await readThread(args.threadId);
            const latest: GmailMessage | undefined = (thread.messages ?? []).filter(m => !m.labelIds?.includes('DRAFT')).at(-1);
            if (!latest) invalid('Gmail thread has only drafts; no delivered message to reply to or forward');
            subject = header(latest, 'Subject'); safeHeader(subject);
            if (toolName === 'gmail.forward') {
              subject = /^Fwd:/i.test(subject) ? subject : 'Fwd: ' + subject;
              body = `${args.note ?? ''}\n\n---------- Forwarded message ----------\nFrom: ${safeHeader(header(latest, 'From'))}\nSubject: ${subject}\n\n${cut(messageText(latest), 12000)}`;
            } else {
              subject = /^Re:/i.test(subject) ? subject : 'Re: ' + subject;
              inReplyTo = header(latest, 'Message-ID');
              if (!/^<[^<>\s]+>$/.test(inReplyTo)) invalid('Gmail message has no valid Message-ID for reply');
              const previous = header(latest, 'References'); safeHeader(previous);
              if (previous && !/^(?:<[^<>\s]+>\s*)+$/.test(previous)) invalid('Invalid Gmail References header');
              references = [...new Set([...(previous.match(/<[^<>\s]+>/g) ?? []), inReplyTo])].join(' ');
            }
          }
          const raw = rawMessage({ to: args.to, cc: args.cc, bcc: args.bcc, subject: cut(subject, 250), body: cut(body, 20000), inReplyTo, references });
          const message = { raw, ...(args.threadId && toolName !== 'gmail.forward' ? { threadId: args.threadId } : {}) };
          if (toolName === 'gmail.create_draft') { const data = await request('drafts', { message }); return { id: data.id, messageId: data.message?.id, threadId: data.message?.threadId }; }
          return await request('messages/send', message);
        }
      }
    } catch (error) {
      const e = error instanceof StepError ? error : new StepError({ category: 'NETWORK', message: 'Gmail operation interrupted before dispatch' });
      if (writeDispatched) throw e;
      throw new StepError({ category: e.category, statusCode: e.statusCode, retryable: e.retryable, message: e.message, details: { requestSent: false } });
    }
  } };
}
