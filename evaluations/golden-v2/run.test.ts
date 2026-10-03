import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { MockLLMProvider, OpenAICompatibleProvider, type LLMProvider } from '@wap/planner';
import { loadEvalFile, parseEvalOptions, runCase, runPool, safeGateway } from './run.js';

describe('service evaluation runner', () => {
  it('accepts services and the production PLANNER_SEARCH_MODE alias with bounded run settings', () => {
    expect(parseEvalOptions({ EVAL_SET: 'services', PLANNER_SEARCH_MODE: 'llm', EVAL_RUNS: '3', EVAL_CONCURRENCY: '2' }))
      .toMatchObject({ set: 'services', searchMode: 'llm', runsCount: 3, concurrency: 2 });
    expect(loadEvalFile('services').file.cases).toHaveLength(44);
    for (const env of [{ EVAL_SET: 'oops' }, { EVAL_RUNS: '0' }, { EVAL_RUNS: 'NaN' }, { EVAL_CONCURRENCY: '-1' },
      { EVAL_SEARCH_MODE: 'regex', PLANNER_SEARCH_MODE: 'llm' }, { PLANNER_SEARCH_MODE: 'bad' }]) expect(() => parseEvalOptions(env)).toThrow();
  });
  it('scores successful searches observed at the real planner/fixture boundary', async () => {
    const { file } = loadEvalFile('services');
    const c = file.cases.find(c => c.id === 'sh01')!;
    const provider = new MockLLMProvider();
    provider.setPlanResponses([
      { kind: 'search', thinking: 'Read cells', calls: [{ tool: 'sheets.read_range', args: { spreadsheetId: 'spreadsheet_frontend_2026', range: 'Tasks!A1:B2' } }] },
      { kind: 'clarification', question: 'Which write action follows?', context: 'Read completed' },
    ]);
    const result = await runCase(c, file, false, 'llm', { provider });
    expect(result.score.passed).toBe(true);
    expect(result.llmCalls).toBe(2);
    expect(result.searches.find(s => s.tool === 'sheets.read_range')?.result)
      .toEqual({ range: 'Tasks!A1:B2', values: [['Task', 'Status'], ['Fix footer', 'To Do']] });
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
