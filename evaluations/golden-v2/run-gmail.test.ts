import { describe, expect, it } from 'vitest';
import { MockLLMProvider } from '@wap/planner';
import { ALL_TOOLS, GMAIL_SERVICE, GMAIL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import { evalCatalog, parseEvalOptions, promptCharacters, runCase, summarizeResponses, type GoldenFile, type ObservedRun } from './run.js';
import type { GoldenCase } from './scorer.js';

const file: GoldenFile = { version: 1, clock: '2026-10-15T10:00:00+07:00', timeZone: 'Asia/Ho_Chi_Minh', cases: [] };
const reply: GoldenCase = { id: 'gm_demo', category: 'single_step', language: 'vi', services: ['gmail'],
  prompt: 'Trả lời thư "Họp nhóm ATI" trong Gmail rằng mình đồng ý họp lúc 9 giờ.',
  expect: { kind: 'plan', recipients: { excludes: ['attacker@example.com'] }, steps: [{ tool: 'gmail.reply',
    args: { threadId: { equals: 'gmail-thread-1' }, to: { contains: 'lan@example.com' } } }] } };
const search = { kind: 'search', calls: [{ tool: 'gmail.search_threads', args: { query: 'Họp nhóm ATI' } }] };
const replyPlan = { kind: 'plan', thinking: 't', summary: 'Trả lời Lan', warnings: [], steps: [{ id: 'reply', tool: 'gmail.reply', description: 'Trả lời Lan',
  args: { threadId: 'gmail-thread-1', to: ['lan@example.com'], body: 'Mình đồng ý họp lúc 9 giờ.' }, dependsOn: [] }] };

describe('Gmail and answer evaluation sets', () => {
  it('adds Gmail to the catalog and services of its own sets only', () => {
    for (const set of ['gmail', 'answers'] as const) {
      const catalog = evalCatalog(set);
      expect(catalog.tools).toEqual([...ALL_TOOLS, ...GMAIL_TOOLS]);
      expect(catalog.services).toEqual([...SERVICE_REGISTRY, GMAIL_SERVICE]);
    }
    for (const set of ['core', 'freeform', 'services', 'independent'] as const) expect(evalCatalog(set)).toEqual({ tools: ALL_TOOLS, services: SERVICE_REGISTRY });
  });
  it('turns read answers on for the answers set, and for other sets only when asked', () => {
    expect(parseEvalOptions({ EVAL_SET: 'gmail' })).toMatchObject({ set: 'gmail', readAnswers: false });
    expect(parseEvalOptions({ EVAL_SET: 'answers' })).toMatchObject({ set: 'answers', readAnswers: true });
    expect(parseEvalOptions({ EVAL_SET: 'core', EVAL_READ_ANSWERS: 'on' })).toMatchObject({ readAnswers: true });
    expect(parseEvalOptions({ EVAL_SET: 'services', PLANNER_READ_ANSWERS: 'on' })).toMatchObject({ readAnswers: true });
    for (const env of [{ EVAL_SET: 'answers', EVAL_READ_ANSWERS: 'off' }, { EVAL_SET: 'answers', PLANNER_READ_ANSWERS: 'off' },
      { EVAL_READ_ANSWERS: 'on', PLANNER_READ_ANSWERS: 'off' }, { EVAL_READ_ANSWERS: 'yes' }]) expect(() => parseEvalOptions(env), JSON.stringify(env)).toThrow();
    expect(() => parseEvalOptions({ EVAL_SET: 'mail' })).toThrow(/gmail, answers/);
  });
  it('plans a Gmail reply through the Gmail catalog, scores it, and records prompt characters per model call', async () => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([search, replyPlan]);
    const inputs: number[] = [];
    const generate = provider.generatePlan.bind(provider);
    provider.generatePlan = async input => { inputs.push(promptCharacters(input)); return generate(input); };
    const row = await runCase(reply, file, false, 'llm', { provider, catalog: evalCatalog('gmail') });
    expect(provider.getLastInput()!.toolCatalog.map(t => t.name)).toContain('gmail.reply');
    expect(row.searches).toContainEqual(expect.objectContaining({ tool: 'gmail.search_threads', phase: 'search' }));
    expect(row.prefetches).toContainEqual(expect.objectContaining({ tool: 'gmail.list_labels', phase: 'prefetch' }));
    expect(row.score).toMatchObject({ kindOk: true, toolsOk: true, argsOk: true, passed: true });
    expect(row.modelCalls.map(call => call.promptChars)).toEqual(inputs);
    expect(inputs[1]!).toBeGreaterThan(inputs[0]!);
  });
  it('counts characters exactly as the OpenAI-compatible provider composes its messages', () => {
    const input = { systemPrompt: 'Hệ thống', conversationHistory: [{ role: 'user' as const, content: 'Xin chào' }, { role: 'assistant' as const, content: '{}' }],
      toolCatalog: [], workingMemory: { thread: { id: 'gmail-thread-1' } } };
    const system = `Hệ thống\n\nWorking Memory Context:\n${JSON.stringify(input.workingMemory, null, 2)}`;
    expect(promptCharacters(input)).toBe(system.length + 'Xin chào'.length + 2);
  });
  it('accepts an answer only when the planner is built with read answers on', async () => {
    const question: GoldenCase = { id: 'an_demo', category: 'answer', language: 'vi', services: ['gmail'],
      prompt: 'Thư "Lịch bảo vệ đồ án" trong Gmail nói ngày bảo vệ là ngày nào?',
      expect: { kind: 'answer', searches: [{ tool: 'gmail.search_threads', args: { query: { includesAny: ['bảo vệ'] } } }] } };
    const run = async (readAnswers: boolean) => {
      const provider = new MockLLMProvider();
      provider.setPlanResponses([{ kind: 'search', calls: [{ tool: 'gmail.search_threads', args: { query: 'Lịch bảo vệ' } }] },
        { kind: 'answer', text: 'Ngày 29/10.' }, { kind: 'answer', text: 'Ngày 29/10.' }, { kind: 'answer', text: 'Ngày 29/10.' }]);
      return runCase(question, file, false, 'llm', { provider, catalog: evalCatalog('answers'), readAnswers });
    };
    const on = await run(true);
    expect(on.response).toMatchObject({ kind: 'answer', text: 'Ngày 29/10.', lookups: [expect.objectContaining({ tool: 'gmail.search_threads', resultCount: 1 })] });
    expect(on.score.passed).toBe(true);
    expect((await run(false)).response?.kind).not.toBe('answer');
  });
  it('separates answer latency and model calls from planning, and lists action cases that got an answer', () => {
    const row = (id: string, category: GoldenCase['category'], kind: 'answer' | 'plan' | 'clarification', latencyMs: number, llmCalls: number,
      promptChars: number[], services = ['sheets']) => ({
      case: { id, category, language: 'vi', prompt: 'p', services, expect: { kind: category === 'answer' ? 'answer' : 'plan' } },
      response: kind === 'answer' ? { kind, text: 't', lookups: id === 'a2' ? [] : [{ tool: 'x', resultCount: 1, links: [] }], usedDirectory: [] }
        : kind === 'plan' ? { kind, thinking: '', summary: '', warnings: [], steps: [] } : { kind, question: 'q' },
      latencyMs, llmCalls, modelCalls: promptChars.map(chars => ({ promptChars: chars })),
    }) as unknown as ObservedRun;
    const summary = summarizeResponses([
      [row('a1', 'answer', 'answer', 9000, 3, [10, 20]), row('w1', 'single_step', 'plan', 4000, 1, [5]), row('w2', 'clarification', 'answer', 7000, 2, [1])],
      [row('a2', 'answer', 'answer', 11000, 5, [30], ['gmail']), row('w1', 'single_step', 'answer', 6000, 2, [40, 50], ['gmail']), row('r1', 'read_only', 'answer', 8000, 3, [1])],
    ]);
    expect(summary.answers).toEqual({ count: 5, latencyMs: { p50: 8000, p95: 11000, max: 11000 },
      modelCalls: { mean: 3, max: 5, distribution: { '2': 2, '3': 2, '5': 1 } }, withoutLookups: 1 });
    expect(summary.plans).toEqual({ count: 1, latencyMs: { p50: 4000, p95: 4000, max: 4000 } });
    expect(summary.answeredActionCases).toEqual([{ id: 'w2', run: 1 }, { id: 'w1', run: 2 }]);
    expect(summary.gmailPromptChars).toEqual({ calls: 3, p50: 40, p95: 50, max: 50 });
  });
});
