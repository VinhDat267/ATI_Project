import { describe, it, expect, vi } from 'vitest';
import { SlackAdapter } from '../src/index.js';

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
  });
});
