import { describe, expect, it, vi } from 'vitest';
import { GlobalRateLimiter, SlackAdapter, TrelloBaseAdapter, TrelloAdapter } from '../src/index.js';

describe('adapter transport controls', () => {
  it('waits for a shared limiter slot before sending a second Trello request', async () => {
    const limiter = new GlobalRateLimiter({ maxRequests: 1, windowMs: 80 });
    const sentAt: number[] = [];
    const fetchFn = async () => {
      sentAt.push(Date.now());
      return new Response('{}');
    };
    const first = new TrelloBaseAdapter({ credentials: { apiKey: 'k', token: 't' }, rateLimiter: limiter, fetchFn: fetchFn as typeof fetch });
    const second = new TrelloBaseAdapter({ credentials: { apiKey: 'k', token: 't' }, rateLimiter: limiter, fetchFn: fetchFn as typeof fetch });

    await first.request('/members/me');
    await second.request('/members/me');

    expect(sentAt).toHaveLength(2);
    expect(sentAt[1]! - sentAt[0]!).toBeGreaterThanOrEqual(70);
  });

  it.each(['trello', 'slack'] as const)('%s retries HTTP 429 once, then succeeds', async (service) => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return calls === 1
        ? new Response('limited', { status: 429, headers: { 'Retry-After': '0' } })
        : new Response(JSON.stringify(service === 'slack' ? { ok: true, ts: '1', channel: 'C1' } : { id: 'c1' }));
    };
    const adapter = service === 'trello'
      ? new TrelloBaseAdapter({ credentials: { apiKey: 'k', token: 't' }, fetchFn: fetchFn as typeof fetch })
      : new SlackAdapter({ credentials: { botToken: 'token' }, fetchFn: fetchFn as typeof fetch });

    await expect(adapter.request(service === 'trello' ? '/cards' : '/chat.postMessage', { method: 'POST' })).resolves.toBeDefined();
    expect(calls).toBe(2);
  });

  it.each(['trello', 'slack'] as const)('%s stops after one 429 retry', async (service) => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return new Response('limited', { status: 429, headers: { 'Retry-After': '0' } });
    };
    const adapter = service === 'trello'
      ? new TrelloBaseAdapter({ credentials: { apiKey: 'k', token: 't' }, fetchFn: fetchFn as typeof fetch })
      : new SlackAdapter({ credentials: { botToken: 'token' }, fetchFn: fetchFn as typeof fetch });

    await expect(adapter.request(service === 'trello' ? '/cards' : '/chat.postMessage', { method: 'POST' })).rejects.toMatchObject({ category: 'RATE_LIMIT', statusCode: 429 });
    expect(calls).toBe(2);
  });

  it('cancels Retry-After wait when the step signal aborts', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return new Response('limited', { status: 429, headers: { 'Retry-After': '5' } });
    };
    const adapter = new TrelloBaseAdapter({ credentials: { apiKey: 'k', token: 't' }, fetchFn: fetchFn as typeof fetch });
    const pending = adapter.request('/cards', { method: 'POST', signal: controller.signal });
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  it.each(['trello', 'slack'] as const)('%s forwards the step AbortSignal to fetch', async (service) => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const fetchFn = async (_url: string | URL, options?: RequestInit) => {
      observedSignal = options?.signal ?? undefined;
      controller.abort();
      if (options?.signal?.aborted) throw new Error('fetch aborted');
      return new Response('{}');
    };
    const limiter = new GlobalRateLimiter({ maxRequests: 10, windowMs: 1000 });
    const adapter = service === 'trello'
      ? new TrelloBaseAdapter({ credentials: { apiKey: 'k', token: 't' }, rateLimiter: limiter, fetchFn: fetchFn as typeof fetch })
      : new SlackAdapter({ credentials: { botToken: 'token' }, rateLimiter: limiter, fetchFn: fetchFn as typeof fetch });

    await expect(adapter.request(service === 'trello' ? '/members/me' : '/conversations.list', { signal: controller.signal })).rejects.toMatchObject({ category: 'NETWORK' });
    expect(observedSignal).toBe(controller.signal);
    expect(observedSignal?.aborted).toBe(true);
  });

  it('caps a huge Retry-After value at 30 seconds', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchFn = async () => {
        calls++;
        return calls === 1
          ? new Response('limited', { status: 429, headers: { 'Retry-After': '999999' } })
          : new Response('{}');
      };
      const adapter = new TrelloBaseAdapter({ credentials: { apiKey: 'k', token: 't' }, fetchFn: fetchFn as typeof fetch });
      const request = adapter.request('/members/me');
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(request).resolves.toEqual({});
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Trello write scope', () => {
  it.each([
    ['create_card', (a: TrelloAdapter) => a.createCard({ listId: 'list1', title: 'New' })],
    ['update_card', (a: TrelloAdapter) => a.updateCard({ cardId: 'card1', title: 'New' })],
    ['add_member', (a: TrelloAdapter) => a.addMember({ cardId: 'card1', memberId: 'm1' })],
    ['add_checklist', (a: TrelloAdapter) => a.addChecklist({ cardId: 'card1', title: 'Tasks' })],
    ['move_card', (a: TrelloAdapter) => a.updateCard({ cardId: 'card1', idList: 'list2' })],
  ])('%s rejects a parent lookup without idBoard before any write', async (_name, run) => {
    const writes: string[] = [];
    const fetchFn = async (url: string | URL, options?: RequestInit) => {
      if (options?.method && options.method !== 'GET') writes.push(String(url));
      return new Response(JSON.stringify({ id: 'resource1' }));
    };
    const adapter = new TrelloAdapter({
      credentials: { apiKey: 'k', token: 't' },
      allowedScope: { boards: ['board1'] },
      fetchFn: fetchFn as typeof fetch,
    });

    await expect(run(adapter)).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403, retryable: false });
    expect(writes).toEqual([]);
  });
});

describe('Trello read scope', () => {
  it('refuses a member search without an allowed board before sending a request', async () => {
    const fetchFn = vi.fn();
    const adapter = new TrelloAdapter({ credentials: { apiKey: 'k', token: 't' }, allowedScope: { boards: ['board1'] }, fetchFn: fetchFn as typeof fetch });
    await expect(adapter.searchMembers({ query: 'Minh' })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('omits search cards whose board cannot be verified', async () => {
    const fetchFn = async () => new Response(JSON.stringify({ cards: [
      { id: 'unknown', name: 'Hidden', idList: 'list1' },
      { id: 'allowed', name: 'Visible', idList: 'list1', idBoard: 'board1' },
    ] }));
    const adapter = new TrelloAdapter({ credentials: { apiKey: 'k', token: 't' }, allowedScope: { boards: ['board1'] }, fetchFn: fetchFn as typeof fetch });

    await expect(adapter.searchCards({ query: 'card' })).resolves.toEqual([
      { id: 'allowed', name: 'Visible', url: '', listId: 'list1' },
    ]);
  });

  it('rejects a card detail without verifiable board identity', async () => {
    const fetchFn = async () => new Response(JSON.stringify({ id: 'card1', name: 'Hidden' }));
    const adapter = new TrelloAdapter({ credentials: { apiKey: 'k', token: 't' }, allowedScope: { boards: ['board1'] }, fetchFn: fetchFn as typeof fetch });

    await expect(adapter.getCard({ cardId: 'card1' })).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });
  });
});
