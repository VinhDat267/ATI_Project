import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, SLACK_TOOLS } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider, WorkingMemory, buildSystemPrompt, formatSearchResults, validatePlan } from '../src/index.js';
import * as validator from '../src/validator.js';

const answer = (text = 'Có hai kênh.', extra = {}) => ({ kind: 'answer', text, ...extra });
const search = { kind: 'search', calls: [{ tool: 'slack.search_channels', args: { query: 'frontend' } }] };
function setup(responses: unknown[], options: Record<string, unknown> = {}) {
  const provider = new MockLLMProvider(); provider.setPlanResponses(responses);
  const calls: string[] = [];
  const planner = new AIPlanner({ provider, toolCatalog: SLACK_TOOLS, searchMode: 'llm', readAnswers: true,
    prefetchDirectory: false, gatherSearch: async ({ tool }) => { calls.push(tool); return [{ id: 'C1', name: 'frontend', url: 'https://a.example' }]; },
    ...options } as any);
  return { provider, calls, run: (memory = new WorkingMemory()) => planner.processMessage({ userMessage: 'Xem kênh Slack', memory }) };
}
const validate = (raw: string, options: unknown) => (validator as any).validateAnswer(raw, options);
describe('ANS-01 read answers', () => {
  it('keeps the off prompt and search envelope byte-identical to the registered baseline', () => {
    const date = { now: new Date('2026-10-14T00:00:00Z'), timeZone: 'Asia/Ho_Chi_Minh' };
    const hash = (s: string) => createHash('sha256').update(s).digest('hex');
    expect(hash(buildSystemPrompt(ALL_TOOLS, date, { search: true, readAnswers: false } as any)))
      .toBe('b31234b91e0c22191f5b0c5fb4be73299e673178df36ea3accb2633b42ec64f9');
    expect(hash(formatSearchResults([{ tool: 'slack.search_channels', args: { query: 'frontend' }, result: [] }])))
      .toBe('1edfb5917d31a91aa046dca5ea220a6c131deed29412fa206df107eb32ef9850');
  });
  it('teaches read lookup then answer only when enabled', () => {
    const prompt = buildSystemPrompt(SLACK_TOOLS, undefined, { search: true, readAnswers: true } as any);
    expect(prompt).toContain('"kind":"answer"'); expect(prompt).not.toContain('clarification" IMMEDIATELY');
    expect(prompt).toContain('lookups');
  });
  it('includes the answer option in the enabled search-results continuation', () => {
    const results = formatSearchResults([{ tool: 'slack.search_channels', args: { query: 'frontend' }, result: [] }], { readAnswers: true });
    expect(results).toContain('</search_results>\nContinue:');
    expect(results.split('</search_results>')[1]).toContain('or an answer');
  });
  it('rejects answers with the flag off even when data exists', () => {
    expect(validate(JSON.stringify(answer()), { readAnswers: false, hasReadData: true }).valid).toBe(false);
    expect(validatePlan(JSON.stringify(answer()), SLACK_TOOLS).valid).toBe(false);
  });
  it.each(['', '   ', 'x'.repeat(4001), 123, null])('rejects invalid answer text %s', text => {
    expect(validate(JSON.stringify({ kind: 'answer', text }), { readAnswers: true, hasReadData: true }).valid).toBe(false);
  });
  it('accepts 4000 characters, rejects missing data and ignores forged provenance', () => {
    expect(validate(JSON.stringify(answer('x'.repeat(4000))), { readAnswers: true, hasReadData: true }).valid).toBe(true);
    expect(validate(JSON.stringify(answer()), { readAnswers: true, hasReadData: false })).toMatchObject({ valid: false });
  });
  it('derives lookups from successful model calls, deduplicates/caps https links and drops forged sources', async () => {
    const rows = ['http://bad.example', 'javascript:alert(1)', ...Array.from({ length: 7 }, (_, i) => `https://a.example/${i}`), 'https://a.example/0'];
    const s = setup([search, answer('Tóm tắt', { lookups: [{ tool: 'forged' }], usedDirectory: ['forged'] })], {
      gatherSearch: async () => rows.map((url, i) => ({ id: String(i), name: String(i), url })),
    });
    expect(await s.run()).toEqual({ kind: 'answer', text: 'Tóm tắt', usedDirectory: [], lookups: [{
      tool: 'slack.search_channels', query: 'frontend', resultCount: 10,
      links: Array.from({ length: 5 }, (_, i) => `https://a.example/${i}`),
    }] });
    expect(s.provider.getCallCount()).toBe(2);
  });
  it('accepts a successful empty lookup as evidence for no matching resources', async () => {
    const s = setup([search, answer('Không có kết quả.')], { gatherSearch: async () => [] });
    expect(await s.run()).toMatchObject({ kind: 'answer', lookups: [{ resultCount: 0 }] });
  });
  it('records successful prefetch services separately, without inventing model lookups', async () => {
    const s = setup([answer()], { prefetchDirectory: true });
    expect(await s.run()).toEqual({ ...answer(), lookups: [], usedDirectory: ['slack'] });
    expect(s.calls).toEqual(['slack.search_channels']);
  });
  it('keeps completed prefetch evidence when another service hits the real abort budget', async () => {
    const provider = new MockLLMProvider(); provider.setPlanResponses([answer()]);
    const aborted: boolean[] = [];
    const planner = new AIPlanner({ provider, toolCatalog: ALL_TOOLS, searchMode: 'llm', readAnswers: true,
      directoryBudgetMs: 20, gatherSearch: async ({ tool, signal }) => {
        if (tool === 'slack.search_channels') return [];
        return new Promise((_, reject) => signal!.addEventListener('abort', () => {
          aborted.push(signal!.aborted); reject(signal!.reason);
        }, { once: true }));
      } });
    expect(await planner.processMessage({ userMessage: 'Xem Slack và Google Calendar', memory: new WorkingMemory() }))
      .toEqual({ ...answer(), lookups: [], usedDirectory: ['slack'] });
    expect(aborted).toEqual([true]);
  });
  it('does not count old working memory as data in the current turn', async () => {
    const memory = new WorkingMemory(); memory.setEntity('__observed', { channel: [{ id: 'C1' }] });
    const s = setup([answer(), answer()], { prefetchDirectory: true });
    expect(await s.run(memory)).toMatchObject({ kind: 'clarification', reason: 'read_only' });
    expect(s.provider.getCallCount()).toBe(2);
  });
  it('retries then asks the existing read-only question after all lookups fail', async () => {
    const s = setup([search, answer(), answer()], { gatherSearch: async () => { throw new Error('Unavailable'); } });
    expect(await s.run()).toMatchObject({ kind: 'clarification', reason: 'read_only' });
    expect(s.provider.getCallCount()).toBe(3);
    expect(s.provider.getLastInput()?.conversationHistory.at(-1)?.content).toMatch(/search|look up/i);
  });
  it('retries then asks read_only when every enabled prefetch fails without aborting', async () => {
    const reads: Array<{ tool: string; aborted: boolean }> = [];
    const s = setup([answer(), answer()], { prefetchDirectory: true,
      gatherSearch: async ({ tool, signal }: { tool: string; signal: AbortSignal }) => {
        reads.push({ tool, aborted: signal.aborted });
        throw new Error('invalid_auth');
      },
    });
    const result = await s.run();
    expect(reads).toEqual([{ tool: 'slack.search_channels', aborted: false }]);
    expect(result).toMatchObject({ kind: 'clarification', reason: 'read_only', question: expect.stringMatching(/Bạn muốn.*dữ liệu/) });
    expect(result).not.toHaveProperty('usedDirectory');
    expect(s.provider.getCallCount()).toBe(2);
    expect(s.provider.getLastInput()?.conversationHistory.at(-1)?.content).toMatch(/No successful read data/);
  });
  it('repairs oversized text once without changing lookup evidence', async () => {
    const s = setup([search, answer('x'.repeat(4001)), answer('Ngắn')]);
    expect(await s.run()).toMatchObject({ kind: 'answer', text: 'Ngắn' }); expect(s.provider.getCallCount()).toBe(3);
  });
  it('preserves write plans and READ_ONLY_PLAN in on mode', async () => {
    const write = { kind: 'plan', thinking: 'Send', summary: 'Send', warnings: [], steps: [
      { id: 'send', tool: 'slack.send_message', description: 'Send', args: { channel: 'C1', text: 'Summary' }, dependsOn: [] },
    ] };
    expect(await setup([write], { requireGroundedResources: false }).run()).toEqual(write);
    const read = { ...write, steps: [{ ...write.steps[0], tool: 'slack.search_channels', args: { query: '' } }] };
    expect(await setup([read]).run()).toMatchObject({ kind: 'clarification', reason: 'read_only' });
  });
});
