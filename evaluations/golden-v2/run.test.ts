import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { MockLLMProvider, OpenAICompatibleProvider, type LLMProvider } from '@wap/planner';
import { loadEvalFile, parseEvalOptions, runCase, runPool, safeGateway } from './run.js';
import * as runner from './run.js';

describe('service evaluation runner', () => {
  it('exports scored search traces without a full prompt echoed by the model', async () => {
    const { file } = loadEvalFile('services');
    const golden = file.cases.find(c => c.id === 'sh02')!;
    const output = mkdtempSync(join(tmpdir(), 'ati-w3-10-export-test-'));
    const responses = [
      { kind: 'search', calls: [{ tool: 'sheets.list_spreadsheets', args: { query: golden.prompt } }] },
      { kind: 'clarification', question: 'Choose a spreadsheet.' },
    ];
    const generate = vi.spyOn(MockLLMProvider.prototype, 'generatePlan').mockImplementation(async () => JSON.stringify(responses.shift()));
    const casePrompts: string[] = [];
    vi.stubEnv('EVAL_DRY_RUN', '1');
    vi.stubEnv('EVAL_SET', 'services');
    vi.stubEnv('EVAL_RUNS', '1');
    vi.stubEnv('EVAL_ONLY', golden.id);
    vi.stubEnv('EVAL_CONCURRENCY', '1');
    vi.stubEnv('EVAL_SEARCH_MODE', 'llm');
    vi.stubEnv('PLANNER_SEARCH_MODE', 'llm');
    vi.stubEnv('EVAL_OUTPUT_DIR', output);
    try {
      await runner.main();
      expect(generate).toHaveBeenCalledTimes(2);
      const report = JSON.parse(readFileSync(join(output, readdirSync(output)[0]!, 'report.json'), 'utf8'));
      const row = report.results[0].cases[0];
      expect(row.searches).toContainEqual(expect.objectContaining({ tool: 'sheets.list_spreadsheets', phase: 'search' }));
      expect(row.score).toMatchObject({ kindOk: false, passed: false });
      expect(row.llmCalls).toBe(2);
      expect(row.searchRounds).toBe(1);
      const inspect = (value: unknown): void => {
        if (typeof value === 'string' && value.includes(golden.prompt)) casePrompts.push(value);
        else if (Array.isArray(value)) value.forEach(inspect);
        else if (value && typeof value === 'object') Object.values(value).forEach(inspect);
      };
      inspect(report);
      expect(casePrompts).toEqual([]);
      expect(row.searches[0].args.query).toBe('[redacted case prompt]');
      expect(generate.mock.calls[1]![0].workingMemory).toBeDefined();
    } finally {
      generate.mockRestore();
      vi.unstubAllEnvs();
      if (dirname(realpathSync(output)) === realpathSync(tmpdir()) && basename(output).startsWith('ati-w3-10-export-test-')) {
        rmSync(output, { recursive: true });
      }
    }
  });

  it('redacts a full case prompt copied into a model response only in exported evidence', () => {
    const prompt = 'Send the status report to the team channel.';
    const response = { kind: 'plan' as const, summary: prompt, steps: [{ id: 's1', tool: 'slack.send_message', args: { text: `Echo: ${prompt}`, channel: 'team', properties: { [prompt]: { count: 7 } } } }] };
    expect(runner.publicEvidenceResponse).toBeTypeOf('function');
    const exported = runner.publicEvidenceResponse(response as any, prompt);
    expect(JSON.stringify(exported)).not.toContain(prompt);
    expect(exported).toMatchObject({ kind: 'plan', summary: '[redacted case prompt]', steps: [{ args: { text: 'Echo: [redacted case prompt]', channel: 'team' } }] });
    expect(response.summary).toBe(prompt);
    expect(response.steps[0]!.args.text).toBe(`Echo: ${prompt}`);
    expect(response.steps[0]!.args.properties[prompt]).toEqual({ count: 7 });
    expect((exported as any).steps[0].args.properties).toEqual({ '[redacted case prompt]': { count: 7 } });
    expect(runner.publicEvidenceResponse({ kind: 'plan', summary: '1', steps: [], metrics: { '1': [1, 11, '1'] } } as any, '1'))
      .toEqual({ kind: 'plan', summary: '[redacted case prompt]', steps: [], metrics: { '[redacted case prompt]': [1, 11, '[redacted case prompt]'] } });
  });

  it('classifies invalid gateway JSON without exposing the response text', async () => {
    const { file } = loadEvalFile('services');
    const provider = new OpenAICompatibleProvider({ baseUrl: 'http://unused.test/v1', model: 'test-model',
      fetch: (async () => new Response('secret invalid JSON')) as typeof fetch });
    const row = await runCase(file.cases[0]!, file, false, 'llm', { provider });
    expect(row.providerError).toBe('Gateway returned invalid JSON');
    expect(row.error).not.toContain('secret');
  });

  it('summarizes retry counts and non-overlapping phase time rather than adding parallel search calls', () => {
    expect(runner.summarizeTiming).toBeTypeOf('function');
    const summary = runner.summarizeTiming([{ latencyMs: 1000,
      modelCalls: [{ startedAtMs: 100, durationMs: 600, usage: { promptTokens: 1, completionTokens: 2, reasoningTokens: null },
        attempts: [{ startedAtMs: 0, durationMs: 300, outcome: 'timeout', retryReason: 'timeout' }, { startedAtMs: 300, durationMs: 300, outcome: 'success' }] }],
      phases: [{ phase: 'prefetch', startedAtMs: 0, durationMs: 100 }, { phase: 'search', startedAtMs: 700, durationMs: 200 }],
    }] as any);
    expect(summary).toMatchObject({ calls: 1, attempts: 2, timeouts: 1, attemptDistribution: { '2': 1 },
      retryReasons: { timeout: 1 }, timeMs: { total: 1000, model: 600, prefetch: 100, search: 200, other: 100 },
      timeShare: { model: 0.6, prefetch: 0.1, search: 0.2, other: 0.1 }, under15Seconds: { count: 1, total: 1, rate: 1 } });
  });
  it('never copies provider error bodies, prompts or headers into public error evidence', async () => {
    const { file } = loadEvalFile('services');
    const provider: LLMProvider = { name: 'synthetic', async generatePlan() {
      throw Object.assign(new Error(`authorization Bearer secret ${file.cases[0]!.prompt}`), { status: 503 });
    } };
    const row = await runCase(file.cases[0]!, file, false, 'llm', { provider });
    expect(row.providerError).toBe('LLM gateway returned HTTP 503');
    expect(row.error).not.toContain(file.cases[0]!.prompt);
    expect(row.providerError).not.toMatch(/secret|authorization/);
  });
  it('records the real deadline abort, retry and usage without recording prompts or headers', async () => {
    const { file } = loadEvalFile('services');
    let requests = 0;
    let expiredSignal: AbortSignal | undefined;
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'http://unused.test/v1', model: 'test-model', apiKey: 'secret-test-key', timeoutMs: 30,
      fetch: (async (_url, init) => {
        requests++;
        if (requests === 1) {
          expiredSignal = init!.signal!;
          return new Promise<Response>((_, reject) => expiredSignal!.addEventListener('abort', () => reject(expiredSignal!.reason), { once: true }));
        }
        return new Response(JSON.stringify({ model: 'test-model', usage: { prompt_tokens: 123, completion_tokens: 17,
          completion_tokens_details: { reasoning_tokens: 9 } },
          choices: [{ message: { content: '{"kind":"clarification","question":"Bạn muốn ghi dữ liệu ở đâu?"}' } }] }));
      }) as typeof fetch,
    });
    const row = await runCase(file.cases[0]!, file, false, 'llm', { provider });
    expect(expiredSignal?.aborted).toBe(true);
    expect(row.llmCalls).toBe(1);
    expect(row.modelCalls).toHaveLength(1);
    expect(row.modelCalls[0]).toMatchObject({ servedModel: 'test-model', usage: { promptTokens: 123, completionTokens: 17, reasoningTokens: 9 },
      attempts: [{ outcome: 'timeout', retryReason: 'timeout' }, { outcome: 'success' }] });
    expect(row.modelCalls[0]!.durationMs).toBeGreaterThanOrEqual(25);
    expect(row.modelCalls[0]!.attempts[0]!.durationMs).toBeGreaterThanOrEqual(25);
    expect(row.modelCalls[0]!.startedAtMs).toBeGreaterThanOrEqual(0);
    const metrics = JSON.stringify(row.modelCalls);
    expect(metrics).not.toContain('secret-test-key');
    expect(metrics).not.toContain(file.cases[0]!.prompt);
    expect(metrics).not.toMatch(/authorization|systemPrompt|conversationHistory/);
    expect(row.phases.map(p => p.phase)).toEqual(['prefetch']);
  });
  it('records transient attempts and individual search rounds', async () => {
    const { file } = loadEvalFile('services');
    let requests = 0;
    const provider = new OpenAICompatibleProvider({ baseUrl: 'http://unused.test', model: 'test-model', retryDelayMs: 1,
      fetch: (async () => {
        requests++;
        if (requests === 1) return new Response('{}', { status: 429 });
        const content = requests === 2 ? JSON.stringify({ kind: 'search', calls: [{ tool: 'sheets.list_spreadsheets', args: { query: 'Frontend' } }] })
          : '{"kind":"clarification","question":"Chọn trang tính nào?"}';
        return new Response(JSON.stringify({ model: 'test-model', choices: [{ message: { content } }] }));
      }) as typeof fetch });
    const row = await runCase(file.cases.find(c => c.id === 'sh02')!, file, false, 'llm', { provider });
    expect(row.modelCalls).toHaveLength(2);
    expect(row.modelCalls[0]!.attempts).toMatchObject([{ outcome: 'transient', status: 429, retryReason: 'http_429' }, { outcome: 'success' }]);
    expect(row.modelCalls[1]!.attempts).toHaveLength(1);
    expect(row.modelCalls[1]!.usage).toEqual({ promptTokens: null, completionTokens: null, reasoningTokens: null });
    expect(row.phases.filter(p => p.phase === 'search')).toHaveLength(1);
    expect(row.phases.filter(p => p.phase === 'prefetch')).toHaveLength(1);
    expect(row.searches).toHaveLength(1);
    expect(row.searches[0]).toMatchObject({ tool: 'sheets.list_spreadsheets', phase: 'search' });
    expect(row.searches[0]!.result).toBeDefined();
    expect(row.searches[0]!.error).toBeUndefined();
    expect(row.phases.every(p => p.durationMs >= 0 && p.startedAtMs >= 0)).toBe(true);
  });
  it('accepts services and the production PLANNER_SEARCH_MODE alias with bounded run settings', () => {
    expect(parseEvalOptions({ EVAL_SET: 'services', PLANNER_SEARCH_MODE: 'llm', EVAL_RUNS: '3', EVAL_CONCURRENCY: '2' }))
      .toMatchObject({ set: 'services', searchMode: 'llm', runsCount: 3, concurrency: 2 });
    expect(loadEvalFile('services').file.cases).toHaveLength(44);
    for (const env of [{ EVAL_SET: 'oops' }, { EVAL_RUNS: '0' }, { EVAL_RUNS: 'NaN' }, { EVAL_CONCURRENCY: '-1' },
      { EVAL_SEARCH_MODE: 'regex', PLANNER_SEARCH_MODE: 'llm' }, { PLANNER_SEARCH_MODE: 'bad' }]) expect(() => parseEvalOptions(env)).toThrow();
  });
  it('rejects read-only clarification following a model-opened search round', async () => {
    const { file } = loadEvalFile('services');
    const c = file.cases.find(c => c.id === 'sh01')!;
    const provider = new MockLLMProvider();
    provider.setPlanResponses([
      { kind: 'search', thinking: 'Read cells', calls: [{ tool: 'sheets.read_range', args: { spreadsheetId: 'spreadsheet_frontend_2026', range: 'Tasks!A1:B2' } }] },
      { kind: 'clarification', question: 'Which write action follows?', context: 'Read completed' },
    ]);
    const result = await runCase(c, file, false, 'llm', { provider });
    expect(result.score.passed).toBe(false);
    expect(result.searchRounds).toBe(1);
    expect(result.prefetches.every(s => s.phase === 'prefetch')).toBe(true);
    expect(result.prefetches.length).toBeGreaterThan(0);
    expect(result.searches.every(s => s.phase === 'search')).toBe(true);
    expect(result.llmCalls).toBe(2);
    expect(result.searches.find(s => s.tool === 'sheets.read_range')?.result)
      .toEqual({ range: 'Tasks!A1:B2', values: [['Task', 'Status'], ['Fix footer', 'To Do']] });
  });
  it('scores read-only clarification with one model call and platform prefetch separately', async () => {
    const { file } = loadEvalFile('services');
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'clarification', question: 'Which write action follows?' }]);
    const result = await runCase(file.cases.find(c => c.id === 'sh01')!, file, false, 'llm', { provider });
    expect(result.score.passed).toBe(true);
    expect(result.llmCalls).toBe(1);
    expect(result.searchRounds).toBe(0);
    expect(result.searches).toEqual([]);
    expect(result.prefetches).toContainEqual(expect.objectContaining({ tool: 'sheets.list_sheets', phase: 'prefetch' }));
  });
  it('stops scheduling after a provider fault and preserves unfinished cases instead of scoring fictitious results', async () => {
    const { file } = loadEvalFile('services');
    let calls = 0;
    const provider: LLMProvider = { name: 'test-provider', async generatePlan() { calls++; throw new Error('LLM gateway returned 503'); } };
    const result = await runPool(file.cases.slice(0, 3), 1, (c, signal) => runCase(c, file, false, 'llm', { provider, signal }));
    expect(calls).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.providerError).toBeDefined();
    expect(result.stopped).toBe(true);
    expect(result.pendingIds).toEqual(['sh02', 'sh03']);
  });
  it('removes credentials and query/fragment values from a gateway recorded in public evidence', () => {
    expect(safeGateway('https://user:secret@example.test/v1?token=secret#secret')).toBe('https://example.test/v1');
  });
  it('aborts a real in-flight HTTP response when its concurrent sibling provider fails', async () => {
    let received = 0;
    let secondStarted!: () => void;
    let observeClose!: () => void;
    const second = new Promise<void>(resolve => { secondStarted = resolve; });
    const closed = new Promise<void>(resolve => { observeClose = resolve; });
    const server = createServer(async (_request, response) => {
      received++;
      if (received === 1) {
        await second;
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end('{"error":{"message":"synthetic capacity fault"}}');
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{');
        response.on('close', observeClose);
        secondStarted();
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing local server address');
      const { file } = loadEvalFile('services');
      const result = await runPool(file.cases.slice(0, 3), 2, (c, signal) => runCase(c, file, false, 'llm', {
        signal, provider: new OpenAICompatibleProvider({ baseUrl: `http://127.0.0.1:${address.port}`, model: 'test-model', maxRetries: 0, timeoutRetries: 0, timeoutMs: 2000 }),
      }));
      let closeTimeout: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([closed, new Promise((_, reject) => { closeTimeout = setTimeout(() => reject(new Error('Abort did not close the HTTP response')), 1000); })]); }
      finally { clearTimeout(closeTimeout); }
      expect(received).toBe(2);
      expect(result.rows.find(row => row.case.id === 'sh02')!.providerError).toContain('Evaluation stopped after provider failure');
      expect(result.stopped).toBe(true);
      expect(result.pendingIds).toEqual(['sh03']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
