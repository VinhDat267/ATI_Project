import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ALL_TOOLS, type PlanStep } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider, WorkingMemory, validatePlan } from '@wap/planner';
import { buildMemory, fixtureSearch, knownResourceValues } from './fixtures.js';
import * as runner from './run.js';
import type { GoldenCase, Matcher, StepSpec } from './scorer.js';

const file = JSON.parse(readFileSync(new URL('./cases-multiturn.json', import.meta.url), 'utf8'));
const cases = file.cases as GoldenCase[];
const specs = (c: GoldenCase): StepSpec[] => c.expect.anyOf?.flat() ?? c.expect.steps ?? [];
const matchers = (matcher: Matcher): Matcher[] => [matcher, ...(matcher.anyOf ?? []).flatMap(matchers)];
const lastAssistant = (c: GoldenCase) => c.turns!.at(-1)!.content;
const isPlan = (content: unknown): content is { steps: PlanStep[] } => typeof content === 'object' && content !== null;
const resource = (tool: string, name: string) => ALL_TOOLS.find(t => t.name === tool)!.inputSchema.properties[name] as Record<string, string>;

describe('preregistered multi-turn labels', () => {
  it('has at least 12 cases: six edits, three replies to a question, three new requests', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
    expect(file.clock).toBe('2026-09-29T10:00:00+07:00');
    expect(cases.filter(c => c.category === 'turn_edit').length).toBeGreaterThanOrEqual(6);
    expect(cases.filter(c => c.category === 'turn_reply').length).toBeGreaterThanOrEqual(3);
    expect(cases.filter(c => c.category === 'turn_new').length).toBeGreaterThanOrEqual(3);
    expect(cases.every(c => ['turn_edit', 'turn_reply', 'turn_new'].includes(c.category))).toBe(true);
  });
  it('gives each case user/assistant turns ending with the assistant, and earlier plans the planner itself accepts', () => {
    for (const c of cases) {
      expect(c.turns!.length, c.id).toBeGreaterThanOrEqual(2);
      c.turns!.forEach((turn, index) => expect(turn.role, `${c.id}:${index}`).toBe(index % 2 ? 'assistant' : 'user'));
      expect(c.turns!.at(-1)!.role, c.id).toBe('assistant');
      // A reply answers a question; an edit or a new request follows a plan.
      expect(isPlan(lastAssistant(c)), c.id).toBe(c.category !== 'turn_reply');
      for (const turn of c.turns!) if (isPlan(turn.content)) {
        expect(validatePlan(JSON.stringify(turn.content), ALL_TOOLS).valid, c.id).toBe(true);
        for (const step of turn.content.steps) for (const [name, value] of Object.entries(step.args)) {
          const property = resource(step.tool, name);
          if (property['x-resource'] && typeof value === 'string') expect(knownResourceValues(property['x-resource'], property['x-resource-field']).has(value), `${c.id}:${name}`).toBe(true);
        }
      }
      expect(() => buildMemory(c.memory), c.id).not.toThrow();
    }
  });
  it('binds labels to real arguments and fixture resources, checks what changed and what stayed, and drops old steps', () => {
    for (const c of cases) {
      expect(c.expect.kind, c.id).toBe('plan');
      for (const spec of specs(c)) for (const [name, matcher] of Object.entries(spec.args ?? {})) {
        const property = resource(spec.tool, name);
        expect(property, `${c.id}:${spec.tool}.${name}`).toBeDefined();
        for (const match of matchers(matcher)) {
          if (match.refTo) for (const target of [match.refTo].flat()) expect(specs(c).some(s => s.tool === target), `${c.id}:${target}`).toBe(true);
          if (property['x-resource'] && match.equals !== undefined)
            expect(knownResourceValues(property['x-resource'], property['x-resource-field']).has(String(match.equals)), `${c.id}:${name}`).toBe(true);
        }
      }
      if (c.category === 'turn_edit') {
        const options = c.expect.anyOf ?? [c.expect.steps!];
        for (const option of options) expect(option.reduce((sum, s) => sum + Object.keys(s.args ?? {}).length, 0), c.id).toBeGreaterThanOrEqual(2);
      }
      if (c.category === 'turn_new') {
        const old = (lastAssistant(c) as { steps: PlanStep[] }).steps.map(s => s.tool);
        const allowed = [...specs(c).map(s => s.tool), ...c.expect.allowExtraTools ?? []];
        for (const tool of old) expect(allowed, `${c.id}:${tool}`).not.toContain(tool);
      }
    }
  });
  it.each(cases.map(c => [c.id, c] as const))('%s offers every labelled tool to the model with its history', async (_id, c) => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'refusal', reason: 'offline catalog reachability only' }]);
    const planner = new AIPlanner({ provider, toolCatalog: ALL_TOOLS, gatherSearch: fixtureSearch, searchMode: 'llm' });
    const memory = new WorkingMemory();
    memory.fromJSON(buildMemory(c.memory));
    await planner.processMessage({ userMessage: c.prompt, history: runner.historyOf(c), memory });
    const input = provider.getLastInput()!;
    const tools = new Set(input.toolCatalog.map(t => t.name));
    for (const spec of specs(c)) expect(tools.has(spec.tool), `${c.id}:${spec.tool}`).toBe(true);
    expect(input.conversationHistory.slice(0, c.turns!.length)).toEqual(runner.historyOf(c));
  });
  it('runs through the command entry point and keeps every user turn out of public evidence', async () => {
    const output = mkdtempSync(join(tmpdir(), 'ati-w4-02-dry-'));
    const c = cases.find(item => item.id === 'mt_edit01')!;
    const echo = { kind: 'plan', thinking: c.turns![0]!.content, summary: c.prompt, warnings: [], steps: [{ id: 'card', tool: 'trello.create_card', description: 'Tạo card',
      args: { listId: 'list_fe_todo', title: 'Sửa lỗi đăng nhập trên Safari' }, dependsOn: [] }] };
    const generate = vi.spyOn(MockLLMProvider.prototype, 'generatePlan').mockImplementation(async () => JSON.stringify(echo));
    for (const [name, value] of Object.entries({ EVAL_DRY_RUN: '1', EVAL_SET: 'multiturn', EVAL_RUNS: '1', EVAL_CONCURRENCY: '1', EVAL_SEARCH_MODE: 'llm',
      PLANNER_SEARCH_MODE: 'llm', EVAL_READ_ANSWERS: 'off', PLANNER_READ_ANSWERS: 'off', EVAL_ONLY: c.id, EVAL_OUTPUT_DIR: output })) vi.stubEnv(name, value);
    try {
      await runner.main();
      const report = JSON.parse(readFileSync(join(output, readdirSync(output)[0]!, 'report.json'), 'utf8'));
      expect(report).toMatchObject({ set: 'multiturn', labels: { file: 'cases-multiturn.json', cases: cases.length } });
      const row = report.results[0].cases[0];
      expect(row).toMatchObject({ id: c.id, category: 'turn_edit', passed: true,
        response: { thinking: '[redacted case prompt]', summary: '[redacted case prompt]' } });
      // Search parsed strings: the prompts contain quotes, which the raw JSON escapes.
      const strings: string[] = [];
      const collect = (value: unknown): void => {
        if (typeof value === 'string') strings.push(value);
        else if (value && typeof value === 'object') for (const [key, nested] of Object.entries(value)) { strings.push(key); collect(nested); }
      };
      collect(report);
      for (const text of runner.casePrompts(c)) expect(strings.filter(s => s.includes(text)), text).toEqual([]);
    } finally { generate.mockRestore(); vi.unstubAllEnvs(); }
  });
});
