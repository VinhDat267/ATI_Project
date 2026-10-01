import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider, createProviderFromEnv, GeminiProvider } from '../src/index.js';

interface Call { url: string; init: RequestInit; body: any }

/** Scripted fetch: each entry answers one request, in order. */
function scriptedFetch(script: Array<(call: Call) => Promise<Response>>) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? 'null')) };
    calls.push(call);
    const next = script[calls.length - 1];
    if (!next) throw new Error(`Unexpected request ${calls.length}`);
    return next(call);
  }) as typeof fetch;
  return { fetchFn, calls };
}

const completion = (content: unknown, model = 'ag/gemini-3.8-flash') => async () =>
  new Response(JSON.stringify({ model, choices: [{ message: { role: 'assistant', content } }] }), { status: 200 });
const status = (code: number) => async () => new Response(JSON.stringify({ error: { message: `status ${code}` } }), { status: code });
const hang = (call: Call) => new Promise<Response>((_, reject) => {
  const signal = call.init.signal;
  signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
});

const base = { baseUrl: 'http://localhost:20128/v1/', apiKey: 'sk-test-secret', model: 'ag/gemini-3.8-flash', retryDelayMs: 1 };
const input = {
  systemPrompt: 'You are the planner.',
  conversationHistory: [
    { role: 'user' as const, content: 'Tạo task' },
    { role: 'assistant' as const, content: '{"kind":"clarification"}' },
    { role: 'user' as const, content: 'list To Do' },
  ],
  toolCatalog: [], workingMemory: { list: { id: 'l1' } },
};

describe('OpenAICompatibleProvider', () => {
  it('posts a JSON-mode chat completion with the system prompt, memory and history', async () => {
    const { fetchFn, calls } = scriptedFetch([completion('{"kind":"refusal","reason":"x"}')]);
    const provider = new OpenAICompatibleProvider({ ...base, fetch: fetchFn });
    await expect(provider.generatePlan(input)).resolves.toBe('{"kind":"refusal","reason":"x"}');
    expect(calls[0]!.url).toBe('http://localhost:20128/v1/chat/completions');
    expect(calls[0]!.init.method).toBe('POST');
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer sk-test-secret');
    expect(calls[0]!.body).toMatchObject({ model: 'ag/gemini-3.8-flash', stream: false, response_format: { type: 'json_object' } });
    expect(calls[0]!.body.messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(calls[0]!.body.messages[0].content).toContain('You are the planner.');
    expect(calls[0]!.body.messages[0].content).toContain('"id": "l1"');
  });

  it('joins text parts when the gateway returns structured content', async () => {
    const { fetchFn } = scriptedFetch([completion([{ type: 'text', text: '{"kind":' }, { type: 'text', text: '"refusal"}' }])]);
    const provider = new OpenAICompatibleProvider({ ...base, fetch: fetchFn });
    await expect(provider.generatePlan(input)).resolves.toBe('{"kind":"refusal"}');
  });

  it('retries a transient 503 and returns the next completion', async () => {
    const { fetchFn, calls } = scriptedFetch([status(503), completion('{}')]);
    const provider = new OpenAICompatibleProvider({ ...base, fetch: fetchFn });
    await expect(provider.generatePlan(input)).resolves.toBe('{}');
    expect(calls).toHaveLength(2);
  });

  it('fails fast on a client error and never echoes the API key', async () => {
    const { fetchFn, calls } = scriptedFetch([status(400)]);
    const provider = new OpenAICompatibleProvider({ ...base, fetch: fetchFn });
    const error = await provider.generatePlan(input).catch((err) => err);
    expect(error).toMatchObject({ status: 400 });
    expect(String(error.message)).toMatch(/400/);
    expect(String(error.message)).not.toContain('sk-test-secret');
    expect(calls).toHaveLength(1);
  });

  it('rejects a completion served by a different model, without retrying', async () => {
    const { fetchFn, calls } = scriptedFetch([completion('{}', 'kr/some-free-fallback')]);
    const provider = new OpenAICompatibleProvider({ ...base, fetch: fetchFn });
    await expect(provider.generatePlan(input)).rejects.toThrow(/served by kr\/some-free-fallback.*ag\/gemini-3.8-flash/);
    expect(calls).toHaveLength(1);
  });

  it('accepts the served model named without the gateway prefix and records it', async () => {
    const { fetchFn } = scriptedFetch([completion('{}', 'gemini-3.8-flash')]);
    const provider = new OpenAICompatibleProvider({ ...base, fetch: fetchFn });
    await provider.generatePlan(input);
    expect(provider.lastServedModel).toBe('gemini-3.8-flash');
  });

  it('aborts a hung request when the per-call timeout elapses', async () => {
    const { fetchFn, calls } = scriptedFetch([hang]);
    const provider = new OpenAICompatibleProvider({ ...base, fetch: fetchFn, timeoutMs: 50, maxRetries: 0, timeoutRetries: 0 });
    await expect(provider.generatePlan(input)).rejects.toThrow(/timed out after 50ms/);
    expect(calls[0]!.init.signal?.aborted).toBe(true);
  });

  it('retries once after its own deadline and returns the second answer', async () => {
    const { fetchFn, calls } = scriptedFetch([hang, completion('{"kind":"refusal","reason":"x"}')]);
    const provider = new OpenAICompatibleProvider({ ...base, fetch: fetchFn, timeoutMs: 50 });
    await expect(provider.generatePlan(input)).resolves.toBe('{"kind":"refusal","reason":"x"}');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.init.signal?.aborted).toBe(true);
    expect(calls[1]!.init.signal?.aborted).toBe(false);
  });

  it('gives up after the timeout retries even when more transient retries remain', async () => {
    const { fetchFn, calls } = scriptedFetch([hang, hang, hang]);
    const provider = new OpenAICompatibleProvider({ ...base, fetch: fetchFn, timeoutMs: 50, maxRetries: 2, timeoutRetries: 1 });
    await expect(provider.generatePlan(input)).rejects.toThrow(/timed out after 50ms/);
    expect(calls).toHaveLength(2);
  });

  it('does not retry a timeout when timeoutRetries is 0', async () => {
    const { fetchFn, calls } = scriptedFetch([hang, completion('{}')]);
    const provider = new OpenAICompatibleProvider({ ...base, fetch: fetchFn, timeoutMs: 50, timeoutRetries: 0 });
    await expect(provider.generatePlan(input)).rejects.toThrow(/timed out after 50ms/);
    expect(calls).toHaveLength(1);
  });

  it('stops immediately when the caller aborts, without retrying', async () => {
    const { fetchFn, calls } = scriptedFetch([hang, hang]);
    const provider = new OpenAICompatibleProvider({ ...base, fetch: fetchFn, timeoutMs: 10_000 });
    const controller = new AbortController();
    const pending = provider.generatePlan({ ...input, signal: controller.signal });
    setTimeout(() => controller.abort(new Error('user left')), 20);
    await expect(pending).rejects.toThrow(/user left/);
    expect(calls).toHaveLength(1);
  });

  it('requires a base URL and model', () => {
    expect(() => new OpenAICompatibleProvider({ baseUrl: '', model: 'm' })).toThrow(/LLM_BASE_URL/);
    expect(() => new OpenAICompatibleProvider({ baseUrl: 'http://x/v1', model: '' })).toThrow(/LLM_MODEL/);
  });
});

describe('createProviderFromEnv', () => {
  it('builds an OpenAI-compatible provider from LLM_* settings', () => {
    const provider = createProviderFromEnv({
      LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'http://localhost:20128/v1', LLM_API_KEY: 'k', LLM_MODEL: 'ag/gemini-3.8-flash',
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider.model).toBe('ag/gemini-3.8-flash');
  });

  it('keeps Gemini as the default provider', () => {
    const provider = createProviderFromEnv({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-3.8-flash' });
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.model).toBe('gemini-3.8-flash');
  });

  it('rejects an unknown provider name', () => {
    expect(() => createProviderFromEnv({ LLM_PROVIDER: 'mystery' })).toThrow(/LLM_PROVIDER/);
  });
});
