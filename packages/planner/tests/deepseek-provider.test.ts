import { describe, it, expect } from 'vitest';
import { DeepSeekProvider, createProviderFromEnv } from '../src/index.js';

interface Call {
  url: string;
  init: RequestInit;
  body: any;
}

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

const completion = (
  content: unknown,
  model = 'deepseek-chat',
  extraMessage: Record<string, unknown> = {},
  usage: Record<string, unknown> = { prompt_tokens: 120, completion_tokens: 45 },
) =>
  async () =>
    new Response(
      JSON.stringify({
        model,
        usage,
        choices: [{ message: { role: 'assistant', content, ...extraMessage } }],
      }),
      { status: 200 },
    );

const status = (code: number, message = `status ${code}`) => async () =>
  new Response(JSON.stringify({ error: { message } }), { status: code });

const input = {
  systemPrompt: 'You are the planner. Return only valid JSON.',
  conversationHistory: [
    { role: 'user' as const, content: 'Tạo thẻ trên Trello' },
  ],
  toolCatalog: [],
  workingMemory: { board: { id: 'b1' } },
};

describe('DeepSeekProvider', () => {
  it('posts a JSON-mode chat completion to https://api.deepseek.com/chat/completions with deepseek-chat by default', async () => {
    const { fetchFn, calls } = scriptedFetch([completion('{"kind":"refusal","reason":"x"}')]);
    const provider = new DeepSeekProvider({ apiKey: 'ds-secret-key', fetch: fetchFn, retryDelayMs: 1 });

    await expect(provider.generatePlan({ ...input, maxOutputTokens: 2048 })).resolves.toBe(
      '{"kind":"refusal","reason":"x"}',
    );

    expect(calls[0]!.url).toBe('https://api.deepseek.com/chat/completions');
    expect(calls[0]!.init.method).toBe('POST');
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer ds-secret-key');
    expect(calls[0]!.body).toMatchObject({
      model: 'deepseek-chat',
      stream: false,
      max_tokens: 2048,
      response_format: { type: 'json_object' },
    });
    expect(calls[0]!.body.max_completion_tokens).toBeUndefined();
    expect(provider.lastCallMetrics?.usage).toEqual({
      promptTokens: 120,
      completionTokens: 45,
      reasoningTokens: null,
    });
  });

  it('clamps max_tokens to 8192 for deepseek-chat when maxOutputTokens exceeds DeepSeek V3 output ceiling', async () => {
    const { fetchFn, calls } = scriptedFetch([completion('{"kind":"refusal","reason":"x"}')]);
    const provider = new DeepSeekProvider({ apiKey: 'ds-secret-key', fetch: fetchFn });

    await provider.generatePlan({ ...input, maxOutputTokens: 16384 });
    expect(calls[0]!.body.max_tokens).toBe(8192);
  });

  it('supports deepseek-reasoner (Thinking Mode), records reasoning_tokens, and strips markdown JSON fences if present', async () => {
    const { fetchFn, calls } = scriptedFetch([
      completion(
        '```json\n{"kind":"refusal","reason":"reasoned"}\n```',
        'deepseek-reasoner',
        { reasoning_content: 'Step 1: check tools...' },
        {
          prompt_tokens: 200,
          completion_tokens: 150,
          completion_tokens_details: { reasoning_tokens: 110 },
        },
      ),
    ]);
    const provider = new DeepSeekProvider({
      apiKey: 'ds-secret-key',
      model: 'deepseek-reasoner',
      fetch: fetchFn,
    });

    await expect(provider.generatePlan(input)).resolves.toBe('{"kind":"refusal","reason":"reasoned"}');
    expect(calls[0]!.body.model).toBe('deepseek-reasoner');
    expect(provider.lastCallMetrics?.usage).toEqual({
      promptTokens: 200,
      completionTokens: 150,
      reasoningTokens: 110,
    });
  });

  it('accepts the official deepseek-flash served alias when deepseek-chat is configured', async () => {
    const { fetchFn } = scriptedFetch([completion('{"kind":"refusal","reason":"ok"}', 'deepseek-flash')]);
    const provider = new DeepSeekProvider({ apiKey: 'ds-secret-key', fetch: fetchFn });
    await expect(provider.generatePlan(input)).resolves.toBe('{"kind":"refusal","reason":"ok"}');
    expect(provider.lastServedModel).toBe('deepseek-flash');
  });

  it('redacts the API key on HTTP errors and rejects mismatched served models', async () => {
    const { fetchFn } = scriptedFetch([status(401, 'Invalid key ds-secret-key')]);
    const provider = new DeepSeekProvider({ apiKey: 'ds-secret-key', fetch: fetchFn });
    const err = await provider.generatePlan(input).catch((e) => e);
    expect(String(err.message)).toContain('[redacted]');
    expect(String(err.message)).not.toContain('ds-secret-key');

    const { fetchFn: wrongModelFetch } = scriptedFetch([completion('{}', 'other-model')]);
    const p2 = new DeepSeekProvider({ apiKey: 'ds-secret-key', fetch: wrongModelFetch });
    await expect(p2.generatePlan(input)).rejects.toThrow(/served by other-model/);
  });

  it('creates DeepSeekProvider via createProviderFromEnv when LLM_PROVIDER=deepseek', () => {
    const provider = createProviderFromEnv({
      LLM_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'ds-key',
    });
    expect(provider).toBeInstanceOf(DeepSeekProvider);
    expect(provider.model).toBe('deepseek-chat');
  });
});
