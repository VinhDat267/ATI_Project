import { describe, it, expect, vi } from 'vitest';
import { GlobalRateLimiter, SlackAdapter, StepError } from '../src/index.js';

function make(handler: (url: string, body: any) => { status?: number; json: any } | Error) {
  const fetchFn = vi.fn(async (url: string | URL, options?: RequestInit) => {
    const out = handler(url.toString(), options?.body ? JSON.parse(options.body as string) : {});
    if (out instanceof Error) throw out;
    const status = out.status ?? 200;
    return { ok: status < 400, status, headers: new Headers(), json: async () => out.json, text: async () => '' } as any;
  });
  const adapter = new SlackAdapter({
    credentials: { botToken: 'xoxb-test' },
    fetchFn: fetchFn as any,
    allowedScope: { channels: ['C1'] },
    rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1000 }),
  } as any);
  return { adapter, fetchFn };
}

const POSTED = { ok: true, channel: 'C1', ts: '1700000000.000100' };

describe('SlackAdapter send_message receipt link and threads', () => {
  it('returns a permalink after a confirmed post when requested (e.g. interactive plan step)', async () => {
    const { adapter } = make((url) =>
      url.includes('chat.getPermalink')
        ? { json: { ok: true, permalink: 'https://acme.slack.com/archives/C1/p1700000000000100' } }
        : { json: POSTED },
    );
    const out = await adapter.execute('slack.send_message', { channel: 'C1', text: 'hi' }, { stepId: 'step_1' });
    expect(out).toEqual({ ts: POSTED.ts, channel: 'C1', permalink: 'https://acme.slack.com/archives/C1/p1700000000000100' });
  });

  it('skips the extra permalink call for headless callers (e.g. digest runners)', async () => {
    const { adapter, fetchFn } = make(() => ({ json: POSTED }));
    const out = await adapter.execute('slack.send_message', { channel: 'C1', text: 'digest' });
    expect(out).toEqual({ ts: POSTED.ts, channel: 'C1' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a failing or malicious permalink lookup never fails a delivered message', async () => {
    for (const failure of [
      new Error('network down'),
      { status: 500, json: {} },
      { json: { ok: false, error: 'message_not_found' } },
      { json: { ok: true, permalink: 'javascript:alert(1)' } },
    ]) {
      const { adapter } = make((url) => (url.includes('chat.getPermalink') ? failure : { json: POSTED }));
      await expect(adapter.sendMessage({ channel: 'C1', text: 'hi' }, { includePermalink: true })).resolves.toEqual({
        ts: POSTED.ts,
        channel: 'C1',
      });
    }
  });

  it('posts into a thread when threadTs is given', async () => {
    const { adapter, fetchFn } = make((url) => (url.includes('chat.getPermalink') ? { json: { ok: false } } : { json: POSTED }));
    await adapter.execute('slack.send_message', { channel: 'C1', text: 'reply', threadTs: '1699999999.000200' });
    const postCall = fetchFn.mock.calls.find((c) => c[0].toString().includes('chat.postMessage'))!;
    expect(JSON.parse(postCall[1]!.body as string)).toEqual({ channel: 'C1', text: 'reply', thread_ts: '1699999999.000200' });
  });

  it('rejects a malformed threadTs before any request', async () => {
    const { adapter, fetchFn } = make(() => ({ json: POSTED }));
    const err: StepError = await adapter.sendMessage({ channel: 'C1', text: 'x', threadTs: 'abc' }).then(
      () => { throw new Error('expected rejection'); },
      (e) => e,
    );
    expect(err.category).toBe('VALIDATION');
    expect(err.details?.requestSent).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('SlackAdapter readThread (slack.read_thread)', () => {
  it('reads parent and replies via conversations.replies with honest coverage', async () => {
    const { adapter, fetchFn } = make((url) => {
      expect(url).toContain('/conversations.replies?channel=C1&ts=1700000001.000100&limit=10');
      return {
        json: {
          ok: true,
          has_more: true,
          messages: [
            { ts: '1700000001.000100', user: 'U1', text: 'Parent question' },
            { ts: '1700000002.000200', user: 'U2', text: 'Reply 1' },
          ],
        },
      };
    });
    const out = await adapter.execute('slack.read_thread', { channel: 'C1', threadTs: '1700000001.000100', limit: 10 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(out).toEqual({
      channel: 'C1',
      threadTs: '1700000001.000100',
      messages: [
        { ts: '1700000001.000100', user: 'U1', text: 'Parent question', isParent: true },
        { ts: '1700000002.000200', user: 'U2', text: 'Reply 1', isParent: false },
      ],
      scanned: 2,
      truncated: true,
    });
  });

  it('enforces allowedScope and rejects malformed threadTs before calling fetch', async () => {
    const { adapter, fetchFn } = make(() => ({ json: { ok: true, messages: [] } }));
    await expect(
      adapter.execute('slack.read_thread', { channel: 'C_FORBIDDEN', threadTs: '1700000001.000100' }),
    ).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    await expect(
      adapter.execute('slack.read_thread', { channel: 'C1', threadTs: 'not-a-ts' }),
    ).rejects.toMatchObject({ category: 'VALIDATION' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
