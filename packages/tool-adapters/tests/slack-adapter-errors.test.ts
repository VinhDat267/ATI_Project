import { describe, it, expect, vi } from 'vitest';
import { GlobalRateLimiter, SlackAdapter, StepError } from '../src/index.js';

function adapterWith(handler: (url: string, body: any) => any) {
  const fetchFn = vi.fn(async (url: string | URL, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(options.body as string) : {};
    const payload = handler(url.toString(), body);
    return { ok: true, status: 200, headers: new Headers(), json: async () => payload } as any;
  });
  const adapter = new SlackAdapter({
    credentials: { botToken: 'xoxb-test' },
    fetchFn: fetchFn as any,
    allowedScope: { channels: ['C1'] },
    rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1000 }),
  } as any);
  return { adapter, fetchFn };
}

describe('SlackAdapter definitive ok:false errors', () => {
  it.each([
    ['not_in_channel', 'AUTH_ERROR'],
    ['missing_scope', 'AUTH_ERROR'],
    ['is_archived', 'VALIDATION'],
    ['msg_too_long', 'VALIDATION'],
    ['channel_not_found', 'NOT_FOUND'],
    ['invalid_auth', 'AUTH_ERROR'],
  ])('postMessage %s is a definitive failure with requestSent:false', async (code, category) => {
    const { adapter } = adapterWith(() => ({ ok: false, error: code }));
    const err: StepError = await adapter.sendMessage({ channel: 'C1', text: 'hi' }).then(
      () => { throw new Error('expected rejection'); },
      (e) => e,
    );
    expect(err).toBeInstanceOf(StepError);
    expect(err.category).toBe(category);
    expect(err.details?.requestSent).toBe(false);
    expect(err.details?.slackError).toBe(code);
    expect(err.retryable).toBe(false);
  });

  it('postMessage ratelimited ok:false is not retryable and not sent', async () => {
    const { adapter } = adapterWith(() => ({ ok: false, error: 'ratelimited' }));
    const err: StepError = await adapter.sendMessage({ channel: 'C1', text: 'hi' }).then(
      () => { throw new Error('expected rejection'); },
      (e) => e,
    );
    expect(err.category).toBe('RATE_LIMIT');
    expect(err.retryable).toBe(false);
    expect(err.details?.requestSent).toBe(false);
  });

  it('keeps unrecognised ok:false codes UNKNOWN (outcome unclear) without requestSent:false', async () => {
    const { adapter } = adapterWith(() => ({ ok: false, error: 'internal_error' }));
    const err: StepError = await adapter.sendMessage({ channel: 'C1', text: 'hi' }).then(
      () => { throw new Error('expected rejection'); },
      (e) => e,
    );
    expect(err.category).toBe('UNKNOWN');
    expect(err.details?.requestSent).not.toBe(false);
  });

  it('missing_scope message tells the admin which scopes to grant', async () => {
    const { adapter } = adapterWith(() => ({ ok: false, error: 'missing_scope' }));
    const err: StepError = await adapter.readMessages({ channel: 'C1' }).then(
      () => { throw new Error('expected rejection'); },
      (e) => e,
    );
    expect(err.message).toContain('channels:history');
    expect(err.details?.requestSent).toBeUndefined();
  });
});

describe('SlackAdapter searchChannels pagination', () => {
  it('follows next_cursor and finds channels beyond the first page', async () => {
    const { adapter, fetchFn } = adapterWith((url) => {
      if (url.includes('cursor=PAGE2')) {
        return { ok: true, channels: [{ id: 'C1', name: 'ops-late', is_private: false }], response_metadata: { next_cursor: '' } };
      }
      return {
        ok: true,
        channels: [{ id: 'C9', name: 'other', is_private: false }],
        response_metadata: { next_cursor: 'PAGE2' },
      };
    });
    const found = await adapter.searchChannels({ query: 'ops' });
    expect(found).toEqual([{ id: 'C1', name: 'ops-late', isPrivate: false }]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]![0].toString()).toContain('exclude_archived=true');
  });

  it('stops after the page cap instead of looping forever', async () => {
    const { adapter, fetchFn } = adapterWith(() => ({
      ok: true,
      channels: [],
      response_metadata: { next_cursor: 'MORE' },
    }));
    await adapter.searchChannels({ query: 'x' });
    expect(fetchFn).toHaveBeenCalledTimes(10);
  });
});

describe('SlackAdapter readMessages coverage', () => {
  it('scans a wider window when a query is given and reports scanned/matched/truncated', async () => {
    const messages = Array.from({ length: 60 }, (_, i) => ({
      ts: `170000${i}.000100`,
      user: 'U1',
      text: i % 2 === 0 ? 'deploy failed' : 'ok',
      ...(i === 0 ? { reply_count: 3, thread_ts: '1700000.000100' } : {}),
    }));
    const { adapter, fetchFn } = adapterWith(() => ({ ok: true, messages, has_more: true }));
    const out = await adapter.readMessages({ channel: 'C1', query: 'deploy', limit: 5 });
    expect(fetchFn.mock.calls[0]![0].toString()).toContain('limit=100');
    expect(out.messages).toHaveLength(5);
    expect(out.scanned).toBe(60);
    expect(out.matched).toBe(30);
    expect(out.truncated).toBe(true);
    expect(out.messages[0]).toMatchObject({ replyCount: 3, threadTs: '1700000.000100' });
  });

  it('without a query fetches only the requested limit and marks not truncated when complete', async () => {
    const { adapter, fetchFn } = adapterWith(() => ({
      ok: true,
      messages: [{ ts: '1.1', user: 'U1', text: 'a' }],
      has_more: false,
    }));
    const out = await adapter.readMessages({ channel: 'C1', limit: 10 });
    expect(fetchFn.mock.calls[0]![0].toString()).toContain('limit=10');
    expect(out).toMatchObject({ scanned: 1, matched: 1, truncated: false });
  });
});
