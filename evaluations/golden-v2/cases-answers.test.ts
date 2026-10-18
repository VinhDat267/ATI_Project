import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ALL_TOOLS, GMAIL_SERVICE, GMAIL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider, WorkingMemory } from '@wap/planner';
import { fixtureSearch, knownResourceValues } from './fixtures.js';
import * as runner from './run.js';
import type { GoldenFile } from './run.js';
import type { GoldenCase } from './scorer.js';

const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const file = read('./cases-answers.json');
const cases = file.cases as GoldenCase[];
const services = (read('./cases-services.json').cases as GoldenCase[]);
const catalog = [...ALL_TOOLS, ...GMAIL_TOOLS];
const registry = [...SERVICE_REGISTRY, GMAIL_SERVICE];

describe('preregistered answer labels', () => {
  it('reuses the six read-only service prompts verbatim and adds Gmail questions, all expecting a looked-up answer', () => {
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
    const readOnly = services.filter(c => c.category === 'read_only');
    expect(readOnly).toHaveLength(6);
    for (const original of readOnly) {
      const answer = cases.find(c => c.id === `an_${original.id}`)!;
      expect(answer, original.id).toBeDefined();
      expect([answer.prompt, answer.language, answer.services]).toEqual([original.prompt, original.language, original.services]);
    }
    expect(file.clock).toBe(read('./cases-services.json').clock);
    expect(cases.filter(c => c.services!.includes('gmail')).length).toBeGreaterThanOrEqual(3);
    for (const c of cases) {
      expect([c.category, c.expect.kind, c.expect.steps], c.id).toEqual(['answer', 'answer', undefined]);
      expect(c.expect.searches?.length, c.id).toBeGreaterThan(0);
      for (const spec of c.expect.searches!) {
        const tool = catalog.find(t => t.name === spec.tool);
        expect(tool?.sideEffect, `${c.id}:${spec.tool}`).toBe('read');
        for (const [name, matcher] of Object.entries(spec.args ?? {})) {
          const property = tool!.inputSchema.properties[name];
          expect(property, `${c.id}:${name}`).toBeDefined();
          if (property['x-resource'] && matcher.equals !== undefined)
            expect(knownResourceValues(property['x-resource'], property['x-resource-field']).has(String(matcher.equals)), `${c.id}:${name}`).toBe(true);
        }
      }
    }
  });
  it.each(cases.map(c => [c.id, c] as const))('%s offers its lookup tools to the model with read answers on', async (_id, c) => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'refusal', reason: 'offline catalog reachability only' }]);
    const planner = new AIPlanner({ provider, toolCatalog: catalog, serviceRegistry: registry, gatherSearch: fixtureSearch, searchMode: 'llm', readAnswers: true });
    await planner.processMessage({ userMessage: c.prompt, memory: new WorkingMemory() });
    const tools = new Set(provider.getLastInput()!.toolCatalog.map(t => t.name));
    for (const spec of c.expect.searches!) expect(tools.has(spec.tool), `${c.id}:${spec.tool}`).toBe(true);
  });
  it('scores an answer resting only on the Telegram directory listing', async () => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'answer', text: 'Có hai chat: frontend và release.' }]);
    const row = await runner.runCase(cases.find(c => c.id === 'an_tg01')!, file as GoldenFile, false, 'llm',
      { provider, catalog: runner.evalCatalog('answers'), readAnswers: true });
    expect(row.prefetches).toContainEqual(expect.objectContaining({ tool: 'telegram.list_chats', phase: 'prefetch' }));
    expect(row.response).toMatchObject({ kind: 'answer', lookups: [], usedDirectory: ['telegram'] });
    expect(row.score.passed).toBe(true);
  });
  it('runs through the command entry point with read answers on and the Gmail catalog', async () => {
    const output = mkdtempSync(join(tmpdir(), 'ati-gmail-04-answers-'));
    for (const [name, value] of Object.entries({ EVAL_DRY_RUN: '1', EVAL_SET: 'answers', EVAL_RUNS: '1', EVAL_CONCURRENCY: '1', EVAL_SEARCH_MODE: 'llm',
      PLANNER_SEARCH_MODE: 'llm', EVAL_ONLY: 'an_sh01', EVAL_OUTPUT_DIR: output })) vi.stubEnv(name, value);
    try {
      await runner.main();
      const report = JSON.parse(readFileSync(join(output, readdirSync(output)[0]!, 'report.json'), 'utf8'));
      expect(report).toMatchObject({ set: 'answers', readAnswers: true, labels: { file: 'cases-answers.json' },
        catalogSha256: createHash('sha256').update(JSON.stringify(catalog)).digest('hex') });
      expect(report.responses.answers).toMatchObject({ count: 0 });
    } finally { vi.unstubAllEnvs(); }
  });
});
