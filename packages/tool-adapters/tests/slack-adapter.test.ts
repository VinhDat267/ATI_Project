import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, vi } from 'vitest';
import { GlobalRateLimiter, SlackAdapter, StepError } from '../src/index.js';

describe('packages/tool-adapters (Task 5: Slack Adapter & Allowed Channels Filtering)', () => {
  const mockFetch = vi.fn().mockImplementation(async (url: string | URL, options?: RequestInit) => {
    const urlStr = url.toString();

    const headers = options?.headers;
    const authHeader =
      headers && typeof (headers as any).get === 'function'
        ? (headers as any).get('Authorization') || (headers as any).get('authorization')
        : (headers as any)?.Authorization || (headers as any)?.authorization;

    if (authHeader === 'Bearer invalid-token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: false, error: 'invalid_auth' }),
      };
    }

    if (urlStr.includes('/conversations.list')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C1', name: 'general', is_private: false },
            { id: 'C2', name: 'frontend-team', is_private: false },
            { id: 'C_SECRET', name: 'secret-ops', is_private: true },
          ],
        }),
      };
    }

    if (urlStr.includes('/chat.postMessage')) {
      const body = options?.body ? JSON.parse(options.body as string) : {};
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          ts: '1234567890.123456',
          channel: body.channel || 'C2',
        }),
      };
    }

    if (urlStr.includes('/conversations.history')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          messages: [
            { ts: '1700000001.000100', user: 'U1', text: 'Deploy staging failed on login' },
            { ts: '1700000002.000200', user: 'U2', text: 'All green on production' },
            { ts: '1700000003.000300', subtype: 'channel_join', user: 'U3', text: 'U3 joined' },
          ],
        }),
      };
    }

    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'Not found',
    };
  });

  it('searches channels and filters by query and allowedScope.channels', async () => {
    const adapter = new SlackAdapter({
      credentials: { botToken: 'xoxb-valid' },
      allowedScope: { channels: ['C2', 'frontend-team'] },
      fetchFn: mockFetch as any,
    });

    const channels = await adapter.searchChannels({ query: 'front', limit: 5 });
    expect(channels).toHaveLength(1);
    expect(channels[0]).toEqual({
      id: 'C2',
      name: 'frontend-team',
      isPrivate: false,
    });
  });

  it('posts message to allowed channel and returns ts & channel', async () => {
    const adapter = new SlackAdapter({
      credentials: { botToken: 'xoxb-valid' },
      allowedScope: { channels: ['C2'] },
      fetchFn: mockFetch as any,
    });

    const res = await adapter.sendMessage({
      channel: 'C2',
      text: 'Deploy completed successfully',
    });
    expect(res.ts).toBe('1234567890.123456');
    expect(res.channel).toBe('C2');
  });

  it('blocks sending message to forbidden channel outside allowedScope', async () => {
    const adapter = new SlackAdapter({
      credentials: { botToken: 'xoxb-valid' },
      allowedScope: { channels: ['C2'] },
      fetchFn: mockFetch as any,
    });

    await expect(
      adapter.sendMessage({ channel: 'C1', text: 'Forbidden message' })
    ).rejects.toThrow(/Allowed scope restriction/i);
  });

  it('normalizes Slack API error invalid_auth to AUTH_ERROR', async () => {
    const adapter = new SlackAdapter({
      credentials: { botToken: 'invalid-token' },
      fetchFn: mockFetch as any,
    });

    await expect(
      adapter.sendMessage({ channel: 'C2', text: 'Hello' })
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
    });
  });

  it('dispatches unified execute for slack tools', async () => {
    const adapter = new SlackAdapter({
      credentials: { botToken: 'xoxb-valid' },
      fetchFn: mockFetch as any,
    });

    const channels = await adapter.execute('slack.search_channels', { query: 'gen' });
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('general');

    const msg = await adapter.execute('slack.send_message', {
      channel: 'C1',
      text: 'Notification from execute',
    });
    expect(msg.ts).toBe('1234567890.123456');

    const history = await adapter.execute('slack.read_messages', {
      channel: 'C1',
      query: 'staging',
      limit: 5,
    });
    expect(history).toEqual({
      channel: 'C1',
      messages: [
        {
          ts: '1700000001.000100',
          user: 'U1',
          text: 'Deploy staging failed on login',
        },
      ],
      scanned: 3,
      matched: 1,
      truncated: false,
    });
  });

  it('GAS-01: rejects sendMessage when Slack chat.postMessage returns missing or non-string ts with UNKNOWN category', async () => {
    for (const invalidPayload of [
      { ok: true, channel: 'C2' },
      { ok: true, channel: 'C2', ts: '' },
      { ok: true, channel: 'C2', ts: { bad: 1 } },
    ]) {
      const adapter = new SlackAdapter({
        credentials: { botToken: 'xoxb-valid' },
        allowedScope: { channels: ['C2'] },
        fetchFn: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => invalidPayload,
        }) as any,
      });

      await expect(
        adapter.sendMessage({ channel: 'C2', text: 'Digest body' })
      ).rejects.toMatchObject({
        category: 'UNKNOWN',
        retryable: false,
        details: { requestSent: true },
      });
    }
  });

  it('XSVC-B (GAS-01 ∩ TRELLO-AUDIT-08): enforces strict string channel and ts receipt validation over real HTTP loopback with requestSent: true', async () => {
    let nextResponsePayload: unknown = { ok: true };
    let postCount = 0;

    const server: Server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/api/chat.postMessage') {
        postCount += 1;
        req.resume();
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(nextResponsePayload));
        });
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;

    try {
      const adapter = new SlackAdapter({
        credentials: { botToken: 'xoxb-loopback-test' },
        allowedScope: { channels: ['C2'] },
        baseUrl: `http://127.0.0.1:${port}/api`,
        rateLimiter: new GlobalRateLimiter({ maxRequests: 100, windowMs: 10 }),
      });

      const malformedReceipts: unknown[] = [
        { ok: true, channel: 'C2' },
        { ok: true, channel: 'C2', ts: '' },
        { ok: true, channel: 'C2', ts: '   ' },
        { ok: true, channel: 'C2', ts: { bad: 1 } },
        { ok: true, channel: 'C2', ts: 12345 },
        { ok: true, channel: 'C2', ts: 'undefined' },
        { ok: true, channel: 'C2', ts: 'null' },
        { ok: true, ts: '1700000000.000100' },
        { ok: true, channel: '', ts: '1700000000.000100' },
        { ok: true, channel: { id: 'C2' }, ts: '1700000000.000100' },
        { ok: true, channel: 'undefined', ts: '1700000000.000100' },
        { ok: true, channel: 'null', ts: '1700000000.000100' },
      ];

      let expectedPosts = 0;
      for (const payload of malformedReceipts) {
        nextResponsePayload = payload;
        expectedPosts += 1;
        let caught: unknown;
        try {
          await adapter.sendMessage({ channel: 'C2', text: 'Loopback digest' });
        } catch (err) {
          caught = err;
        }
        expect(caught, `Expected malformed receipt ${JSON.stringify(payload)} to throw StepError`).toBeInstanceOf(
          StepError
        );
        expect(caught).toMatchObject({
          category: 'UNKNOWN',
          retryable: false,
          details: { requestSent: true },
        });
        expect(postCount).toBe(expectedPosts);
      }

      nextResponsePayload = { ok: true, channel: '  C2  ', ts: '  1700000000.000100  ' };
      const validReceipt = await adapter.sendMessage({ channel: 'C2', text: 'Loopback digest' });
      expect(validReceipt).toEqual({
        channel: 'C2',
        ts: '1700000000.000100',
      });
      expect(postCount).toBe(expectedPosts + 1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  it('AUD-W1-06: marks pre-dispatch abort and limiter abort as requestSent: false, post-dispatch network error as requestSent: true, and does not retry 429 on writes', async () => {
    const fetchSpy = vi.fn();
    const preAbortedController = new AbortController();
    preAbortedController.abort();

    const adapterPreAbort = new SlackAdapter({
      credentials: { botToken: 'xoxb-valid' },
      allowedScope: { channels: ['C2'] },
      fetchFn: fetchSpy as any,
    });

    await expect(
      adapterPreAbort.sendMessage({ channel: 'C2', text: 'Pre-aborted' }, { signal: preAbortedController.signal })
    ).rejects.toMatchObject({
      category: 'NETWORK',
      retryable: false,
      details: { requestSent: false },
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Limiter wait abort before fetchFn
    const limiter = new GlobalRateLimiter({ maxRequests: 1, windowMs: 5000 });
    await limiter.acquire('slack');
    const limiterAbortController = new AbortController();
    setTimeout(() => limiterAbortController.abort(), 15);
    const adapterLimiterAbort = new SlackAdapter({
      credentials: { botToken: 'xoxb-valid' },
      allowedScope: { channels: ['C2'] },
      rateLimiter: limiter,
      fetchFn: fetchSpy as any,
    });
    await expect(
      adapterLimiterAbort.sendMessage({ channel: 'C2', text: 'Limiter-aborted' }, { signal: limiterAbortController.signal })
    ).rejects.toMatchObject({
      details: { requestSent: false },
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Post-dispatch network failure sets requestSent: true
    const networkFetch = vi.fn().mockRejectedValue(new Error('socket hang up'));
    const adapterNetworkFail = new SlackAdapter({
      credentials: { botToken: 'xoxb-valid' },
      allowedScope: { channels: ['C2'] },
      rateLimiter: new GlobalRateLimiter({ maxRequests: 100, windowMs: 10 }),
      fetchFn: networkFetch as any,
    });
    await expect(
      adapterNetworkFail.sendMessage({ channel: 'C2', text: 'Dispatched then failed' })
    ).rejects.toMatchObject({
      category: 'NETWORK',
      retryable: false,
      details: { requestSent: true },
    });
    expect(networkFetch).toHaveBeenCalledTimes(1);
  });

  it('resolves slack.search_users via users.lookupByEmail and cursor-paginated users.list, filtering bots/deleted users', async () => {
    const calls: string[] = [];
    const adapter = new SlackAdapter({
      credentials: { botToken: 'xoxb-users-valid' },
      allowedScope: { channels: ['C2'] },
      fetchFn: (async (url: string | URL) => {
        const u = url.toString();
        calls.push(u);
        if (u.includes('/users.lookupByEmail?email=an%40ati.local')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              user: {
                id: 'U_AN',
                name: 'an.nguyen',
                deleted: false,
                is_bot: false,
                profile: { real_name: 'Nguyễn Văn An', display_name: 'an', email: 'an@ati.local' },
              },
            }),
          };
        }
        if (u.includes('/users.lookupByEmail?email=missing%40ati.local')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: false, error: 'users_not_found' }),
          };
        }
        if (u.includes('/users.list') && !u.includes('cursor=')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              members: [
                { id: 'USLACKBOT', name: 'slackbot', deleted: false, is_bot: false },
                { id: 'U_BOT', name: 'planora-bot', deleted: false, is_bot: true },
                { id: 'U_DEL', name: 'old.user', deleted: true, is_bot: false },
                { id: 'U_AN', name: 'an.nguyen', profile: { real_name: 'Nguyễn Văn An', display_name: 'an', email: 'an@ati.local' } },
              ],
              response_metadata: { next_cursor: 'page-2' },
            }),
          };
        }
        if (u.includes('/users.list') && u.includes('cursor=page-2')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              members: [
                { id: 'U_BINH', name: 'binh.tran', profile: { real_name: 'Trần Thị Bình', display_name: 'binh', email: 'binh@ati.local' } },
              ],
              response_metadata: { next_cursor: '' },
            }),
          };
        }
        return { ok: false, status: 404, text: async () => 'not found' };
      }) as any,
    });

    const foundByEmail = await adapter.execute('slack.search_users', { email: 'an@ati.local' });
    expect(foundByEmail).toEqual([
      {
        id: 'U_AN',
        name: 'an.nguyen',
        realName: 'Nguyễn Văn An',
        displayName: 'an',
        email: 'an@ati.local',
      },
    ]);

    const missingEmail = await adapter.execute('slack.search_users', { email: 'missing@ati.local' });
    expect(missingEmail).toEqual([]);

    const listedAll = await adapter.execute('slack.search_users', { query: '' });
    expect(listedAll.map((u: any) => u.id)).toEqual(['U_AN', 'U_BINH']);

    const filtered = await adapter.execute('slack.search_users', { query: 'bình' });
    expect(filtered.map((u: any) => u.id)).toEqual(['U_BINH']);
    expect(calls.some((c) => c.includes('cursor=page-2'))).toBe(true);
  });

  it('forwards optional Block Kit blocks on slack.send_message and rejects invalid blocks with requestSent=false', async () => {
    const sentPayloads: any[] = [];
    const adapter = new SlackAdapter({
      credentials: { botToken: 'xoxb-blocks' },
      allowedScope: { channels: ['C2'] },
      rateLimiter: new GlobalRateLimiter({ maxRequests: 100, windowMs: 10 }),
      fetchFn: (async (url: string | URL, opts?: RequestInit) => {
        if (url.toString().includes('/chat.postMessage')) {
          const parsed = JSON.parse(String(opts?.body ?? '{}'));
          sentPayloads.push(parsed);
          if (parsed.text === 'trigger_invalid_blocks') {
            return { ok: true, status: 200, json: async () => ({ ok: false, error: 'invalid_blocks' }) };
          }
          return { ok: true, status: 200, json: async () => ({ ok: true, channel: 'C2', ts: '1700000100.000200' }) };
        }
        return { ok: false, status: 404, text: async () => 'not found' };
      }) as any,
    });

    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: 'Bản tin Slack' } },
      { type: 'section', text: { type: 'mrkdwn', text: '*Xin chào* <@U_AN>' } },
    ];
    const receipt = await adapter.execute('slack.send_message', { channel: 'C2', text: 'Bản tin', blocks });
    expect(receipt).toEqual({ channel: 'C2', ts: '1700000100.000200' });
    expect(sentPayloads[0]).toEqual({ channel: 'C2', text: 'Bản tin', blocks });

    await expect(
      adapter.execute('slack.send_message', {
        channel: 'C2',
        text: 'bad blocks',
        blocks: Array.from({ length: 51 }, () => ({ type: 'divider' })),
      }),
    ).rejects.toMatchObject({ category: 'VALIDATION', details: { requestSent: false } });

    await expect(
      adapter.execute('slack.send_message', {
        channel: 'C2',
        text: 'bad item',
        blocks: ['not-an-object' as any],
      }),
    ).rejects.toMatchObject({ category: 'VALIDATION', details: { requestSent: false } });
    expect(sentPayloads).toHaveLength(1);

    await expect(
      adapter.execute('slack.send_message', {
        channel: 'C2',
        text: 'trigger_invalid_blocks',
        blocks,
      }),
    ).rejects.toMatchObject({ category: 'VALIDATION', details: { requestSent: false } });
  });

  it('supports limit up to 200 on searchChannels and sets requestSent=false on scope or HTTP 401/403/404 write rejections', async () => {
    const manyChannels = Array.from({ length: 15 }, (_, i) => ({
      id: `C_MANY_${i + 1}`,
      name: `ops-channel-${i + 1}`,
      is_private: false,
    }));
    let httpStatus = 403;
    const adapter = new SlackAdapter({
      credentials: { botToken: 'xoxb-cap' },
      allowedScope: { channels: manyChannels.map((c) => c.id) },
      rateLimiter: new GlobalRateLimiter({ maxRequests: 100, windowMs: 10 }),
      fetchFn: (async (url: string | URL) => {
        if (url.toString().includes('/conversations.list')) {
          return { ok: true, status: 200, json: async () => ({ ok: true, channels: manyChannels }) };
        }
        return { ok: false, status: httpStatus, statusText: 'Err', text: async () => 'err' };
      }) as any,
    });

    const defaultLimit = await adapter.searchChannels({ query: 'ops-channel' });
    expect(defaultLimit).toHaveLength(10);

    const expandedLimit = await adapter.searchChannels({ query: 'ops-channel', limit: 200 });
    expect(expandedLimit).toHaveLength(15);

    await expect(
      adapter.sendMessage({ channel: 'C_OUT_OF_SCOPE', text: 'nope' }),
    ).rejects.toMatchObject({ category: 'AUTH_ERROR', details: { requestSent: false } });

    httpStatus = 401;
    await expect(
      adapter.sendMessage({ channel: 'C_MANY_1', text: 'unauth' }),
    ).rejects.toMatchObject({ category: 'AUTH_ERROR', details: { requestSent: false } });

    httpStatus = 404;
    await expect(
      adapter.sendMessage({ channel: 'C_MANY_1', text: 'missing' }),
    ).rejects.toMatchObject({ category: 'NOT_FOUND', details: { requestSent: false } });
  });
});
