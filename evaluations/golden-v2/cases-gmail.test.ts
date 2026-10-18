import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ALL_TOOLS, GMAIL_SERVICE, GMAIL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider, WorkingMemory } from '@wap/planner';
import { GMAIL_THREADS, buildMemory, fixtureSearch, knownResourceValues } from './fixtures.js';
import * as runner from './run.js';
import type { GoldenCase, Matcher, StepSpec } from './scorer.js';

const file = JSON.parse(readFileSync(new URL('./cases-gmail.json', import.meta.url), 'utf8'));
const cases = file.cases as GoldenCase[];
const catalog = [...ALL_TOOLS, ...GMAIL_TOOLS];
const registry = [...SERVICE_REGISTRY, GMAIL_SERVICE];
const specs = (c: GoldenCase): StepSpec[] => [...(c.expect.anyOf?.flat() ?? c.expect.steps ?? []), ...c.expect.searches ?? []];
const matchers = (matcher: Matcher): Matcher[] => [matcher, ...(matcher.anyOf ?? []).flatMap(matchers)];
const injectionThreads = GMAIL_THREADS.filter(t => /attacker@example\.com/.test(`${t.subject} ${t.messages[0]!.body}`)).map(t => t.id);

describe('preregistered Gmail planning labels', () => {
  it('covers every Gmail write tool, both languages and three injection cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(16);
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
    expect(file.clock).toBe('2026-10-15T10:00:00+07:00');
    expect(new Set(cases.map(c => c.language))).toEqual(new Set(['vi', 'en']));
    for (const category of ['single_step', 'multi_step', 'cross_service', 'clarification', 'refusal', 'injection'])
      expect(cases.some(c => c.category === category), category).toBe(true);
    const labelled = new Set(cases.flatMap(specs).map(s => s.tool));
    for (const tool of GMAIL_TOOLS.filter(t => t.sideEffect === 'write')) expect(labelled.has(tool.name), tool.name).toBe(true);
    expect(cases.filter(c => c.category === 'cross_service').every(c => c.services!.length >= 2)).toBe(true);
    const injections = cases.filter(c => c.category === 'injection');
    expect(injections).toHaveLength(3);
    for (const c of injections) {
      expect(c.expect.recipients, c.id).toEqual({ excludes: ['attacker@example.com'] });
      expect(c.expect.acceptKinds, c.id).toContain('clarification');
      expect(injectionThreads, c.id).toContain(c.expect.steps![0]!.args!.threadId!.equals);
    }
  });
  it('binds real catalog arguments, fixture threads and labels, and addresses the planner may use', () => {
    for (const c of cases) {
      expect(c.primaryService, c.id).toBe('gmail');
      expect(c.services!.every(s => registry.some(item => item.id === s)), c.id).toBe(true);
      expect(() => buildMemory(c.memory), c.id).not.toThrow();
      for (const spec of specs(c)) {
        const tool = catalog.find(t => t.name === spec.tool);
        expect(tool, `${c.id}:${spec.tool}`).toBeDefined();
        expect(Object.keys(spec.args ?? {}).length, c.id).toBeGreaterThan(0);
        for (const [name, matcher] of Object.entries(spec.args ?? {})) {
          const property = tool!.inputSchema.properties[name];
          expect(property, `${c.id}:${spec.tool}.${name}`).toBeDefined();
          for (const match of matchers(matcher)) {
            if (match.refTo) for (const target of [match.refTo].flat()) expect(c.expect.steps?.some(s => s.tool === target), `${c.id}:${target}`).toBe(true);
            if (property['x-resource'] && match.equals !== undefined)
              expect(knownResourceValues(property['x-resource'], property['x-resource-field']).has(String(match.equals)), `${c.id}:${name}`).toBe(true);
            if (property['x-resource'] === 'label' && match.contains !== undefined)
              expect(knownResourceValues('label').has(String(match.contains)), `${c.id}:${name}`).toBe(true);
            // A labelled recipient must be one the grounding rule allows: typed by the user or a participant of a fixture thread.
            if (property['x-recipient'] && match.contains !== undefined)
              expect(c.prompt.includes(String(match.contains)) || GMAIL_THREADS[0]!.participants.includes(String(match.contains)), `${c.id}:${name}`).toBe(true);
          }
        }
      }
    }
  });
  it.each(cases.filter(c => c.expect.kind === 'plan').map(c => [c.id, c] as const))('%s routes every labelled write tool to the model without provider calls', async (_id, c) => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'refusal', reason: 'offline catalog reachability only' }]);
    const planner = new AIPlanner({ provider, toolCatalog: catalog, serviceRegistry: registry, gatherSearch: fixtureSearch, searchMode: 'llm' });
    await planner.processMessage({ userMessage: c.prompt, memory: new WorkingMemory() });
    const tools = new Set(provider.getLastInput()!.toolCatalog.map(t => t.name));
    for (const spec of c.expect.steps ?? []) expect(tools.has(spec.tool), `${c.id}:${spec.tool}`).toBe(true);
  });
  it('runs through the command entry point with the Gmail catalog and its own catalog hash', async () => {
    const output = mkdtempSync(join(tmpdir(), 'ati-gmail-04-dry-'));
    // The planner validates against the catalog it was built with, so this plan scores only with Gmail in it.
    const send = { kind: 'plan', thinking: 't', summary: 'Gửi thư', warnings: [], steps: [{ id: 'send', tool: 'gmail.send_message', description: 'Gửi thư',
      args: { to: ['lan@example.com'], subject: 'Lịch họp tuần sau', body: 'Họp nhóm lúc 9 giờ sáng thứ Hai.' }, dependsOn: [] }] };
    const generate = vi.spyOn(MockLLMProvider.prototype, 'generatePlan').mockImplementation(async () => JSON.stringify(send));
    for (const [name, value] of Object.entries({ EVAL_DRY_RUN: '1', EVAL_SET: 'gmail', EVAL_RUNS: '1', EVAL_CONCURRENCY: '1', EVAL_SEARCH_MODE: 'llm',
      PLANNER_SEARCH_MODE: 'llm', EVAL_READ_ANSWERS: 'off', PLANNER_READ_ANSWERS: 'off', EVAL_ONLY: 'gm01', EVAL_OUTPUT_DIR: output })) vi.stubEnv(name, value);
    try {
      await runner.main();
      const report = JSON.parse(readFileSync(join(output, readdirSync(output)[0]!, 'report.json'), 'utf8'));
      expect(report).toMatchObject({ set: 'gmail', readAnswers: false, labels: { file: 'cases-gmail.json', cases: cases.length, selectedCases: 1 },
        catalog: { tools: catalog.length }, catalogSha256: createHash('sha256').update(JSON.stringify(catalog)).digest('hex') });
      expect(report.catalog.services).toContain('gmail');
      expect(report.results[0].cases[0]).toMatchObject({ id: 'gm01', passed: true });
      expect(report.responses.gmailPromptChars.calls).toBe(1);
    } finally { generate.mockRestore(); vi.unstubAllEnvs(); }
  });
});
