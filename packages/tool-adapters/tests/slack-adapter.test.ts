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
});
