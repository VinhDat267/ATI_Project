import { describe, it, expect } from 'vitest';
import { GeminiProvider, type GeminiClient } from '../src/index.js';

type Request = Parameters<GeminiClient['models']['generateContent']>[0];

function apiError(status: number): Error {
  return Object.assign(new Error(`{"error":{"code":${status}}}`), { status });
}

/** Scripted client: each entry answers one call, in order. */
function scriptedClient(script: Array<(request: Request) => Promise<{ text?: string }>>) {
  const requests: Request[] = [];
  const client: GeminiClient = {
    models: {
      generateContent: (request) => {
        requests.push(request);
        const next = script[requests.length - 1];
        if (!next) throw new Error(`Unexpected call ${requests.length}`);
        return next(request);
      },
    },
  };
  return { client, requests };
}

/** Never settles until the request's abort signal fires, like a hung socket. */
const hang = (request: Request) => new Promise<{ text?: string }>((_, reject) => {
  const signal = request.config?.abortSignal;
  if (!signal) return;
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

const input = { systemPrompt: 'plan', conversationHistory: [{ role: 'user' as const, content: 'hi' }], toolCatalog: [], workingMemory: {} };

describe('GeminiProvider transport', () => {
  it('retries a transient 503 and returns the next response', async () => {
    const { client, requests } = scriptedClient([
      async () => { throw apiError(503); },
      async () => ({ text: '{"kind":"refusal","reason":"x"}' }),
    ]);
    const provider = new GeminiProvider({ apiKey: 'k', client, retryDelayMs: 1 });
    await expect(provider.generatePlan(input)).resolves.toBe('{"kind":"refusal","reason":"x"}');
    expect(requests).toHaveLength(2);
  });

  it('fails fast on a non-transient error without trying another model', async () => {
    const { client, requests } = scriptedClient([async () => { throw apiError(400); }]);
    const provider = new GeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', client, retryDelayMs: 1 });
    await expect(provider.generatePlan(input)).rejects.toMatchObject({ status: 400 });
    expect(requests.map((request) => request.model)).toEqual(['gemini-3.8-flash']);
  });

  it('gives up after the configured number of transient retries', async () => {
    const { client, requests } = scriptedClient([503, 429, 503].map((status) => async () => { throw apiError(status); }));
    const provider = new GeminiProvider({ apiKey: 'k', client, maxRetries: 2, retryDelayMs: 1 });
    await expect(provider.generatePlan(input)).rejects.toMatchObject({ status: 503 });
    expect(requests).toHaveLength(3);
  });

  it('aborts a hung request when the per-call timeout elapses', async () => {
    const { client, requests } = scriptedClient([hang]);
    const provider = new GeminiProvider({ apiKey: 'k', client, timeoutMs: 50, maxRetries: 0 });
    const started = Date.now();
    await expect(provider.generatePlan(input)).rejects.toThrow(/timed out after 50ms/i);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(requests[0]!.config?.abortSignal?.aborted).toBe(true);
  });

  it('stops immediately when the caller aborts, without retrying', async () => {
    const { client, requests } = scriptedClient([hang, hang]);
    const provider = new GeminiProvider({ apiKey: 'k', client, timeoutMs: 10_000, retryDelayMs: 1 });
    const controller = new AbortController();
    const pending = provider.generatePlan({ ...input, signal: controller.signal });
    setTimeout(() => controller.abort(new Error('user left')), 20);
    await expect(pending).rejects.toThrow(/user left/);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.config?.abortSignal?.aborted).toBe(true);
  });

  it('does not start a call when the caller already aborted', async () => {
    const { client, requests } = scriptedClient([]);
    const provider = new GeminiProvider({ apiKey: 'k', client });
    await expect(provider.generatePlan({ ...input, signal: AbortSignal.abort(new Error('gone')) })).rejects.toThrow(/gone/);
    expect(requests).toHaveLength(0);
  });
});
