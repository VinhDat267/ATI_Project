import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider, WorkingMemory } from '@wap/planner';
import { buildMemory, fixtureSearch, knownResourceValues } from './fixtures.js';
import type { GoldenCase, StepSpec } from './scorer.js';

const file = JSON.parse(readFileSync(new URL('./cases-services.json', import.meta.url), 'utf8'));
const cases = file.cases as GoldenCase[];
const newServices = ['sheets', 'calendar', 'notion', 'telegram', 'jira'];
const specs = (c: GoldenCase): StepSpec[] => [...(c.expect.anyOf?.flat() ?? c.expect.steps ?? []), ...c.expect.searches ?? []];
const resourceMatchers = (matcher: any): any[] => [matcher, ...(matcher.anyOf ?? []).flatMap(resourceMatchers)];

describe('preregistered service evaluation labels', () => {
  it('covers eight cases per new service, both languages and the required capabilities', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
    expect(file.clock).toBe('2026-09-29T10:00:00+07:00');
    for (const service of newServices) {
      const rows = cases.filter(c => c.primaryService === service);
      expect(rows.length, service).toBeGreaterThanOrEqual(8);
      expect(new Set(rows.map(c => c.language)), service).toEqual(new Set(['en', 'vi']));
      for (const category of ['read_only', 'single_step', 'cross_service', 'clarification', 'refusal']) {
        expect(rows.some(c => c.category === category), `${service}:${category}`).toBe(true);
      }
      expect(rows.filter(c => c.category === 'cross_service').every(c => specs(c).some(s => Object.values(s.args ?? {}).some(m => m.refTo))), service).toBe(true);
    }
    expect(cases.filter(c => c.ambiguity).length).toBeGreaterThanOrEqual(12);
    const large = cases.filter(c => c.category === 'cross_service' && new Set(c.expect.steps?.map(s => s.tool.split('.')[0])).size >= 4);
    expect(large.length).toBeGreaterThanOrEqual(4);
    for (const c of large) expect(new Set(c.expect.steps!.map(s => s.tool.split('.')[0]).filter(s => newServices.includes(s!))).size, c.id).toBeGreaterThanOrEqual(2);
  });
  it('binds real catalog arguments, fixture resources, data dependencies and routing labels', () => {
    for (const c of cases) {
      expect(c.prompt.trim().length, c.id).toBeGreaterThan(10);
      expect(c.services!.every(s => SERVICE_REGISTRY.some(item => item.id === s)), c.id).toBe(true);
      expect(c.routing, c.id).toBeDefined();
      expect(() => buildMemory(c.memory), c.id).not.toThrow();
      if (c.category === 'read_only') {
        expect(c.expect.kind, c.id).toBe('clarification');
        expect(c.expect.searches!.length, c.id).toBeGreaterThan(0);
      }
      for (const spec of specs(c)) {
        const tool = ALL_TOOLS.find(t => t.name === spec.tool);
        expect(tool, `${c.id}:${spec.tool}`).toBeDefined();
        expect(Object.keys(spec.args ?? {}).length, c.id).toBeGreaterThan(0);
        for (const [name, matcher] of Object.entries(spec.args ?? {})) {
          const property = tool!.inputSchema.properties[name];
          expect(property, `${c.id}:${spec.tool}.${name}`).toBeDefined();
          for (const match of resourceMatchers(matcher)) {
            if (match.refTo) for (const target of [match.refTo].flat()) expect(c.expect.steps?.some(s => s.tool === target), `${c.id}:${target}`).toBe(true);
            if (property['x-resource'] && match.equals !== undefined) {
              expect(knownResourceValues(property['x-resource'], property['x-resource-field']).has(String(match.equals)), `${c.id}:${name}`).toBe(true);
            }
          }
        }
      }
    }
  });
  it.each(cases.filter(c => c.expect.kind === 'plan').map(c => [c.id, c] as const))('%s routes every labelled write tool to the model without provider calls', async (_id, c) => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'refusal', reason: 'offline catalog reachability only' }]);
    const planner = new AIPlanner({ provider, toolCatalog: ALL_TOOLS, gatherSearch: fixtureSearch, searchMode: 'llm' });
    await planner.processMessage({ userMessage: c.prompt, memory: new WorkingMemory() });
    const tools = new Set(provider.getLastInput()!.toolCatalog.map(t => t.name));
    for (const spec of c.expect.steps ?? []) expect(tools.has(spec.tool), `${c.id}:${spec.tool}`).toBe(true);
  });
});
