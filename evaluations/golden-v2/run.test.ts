import { describe, expect, it } from 'vitest';
import { MockLLMProvider, type LLMProvider } from '@wap/planner';
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
});
