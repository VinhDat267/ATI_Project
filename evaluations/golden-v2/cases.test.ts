import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { AIPlanner, MockLLMProvider, WorkingMemory } from '@wap/planner';
import { ALL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import type { GoldenCase, StepSpec } from './scorer.js';
import { buildMemory, fixtureSearch, knownResourceValues } from './fixtures.js';

const cases: GoldenCase[] = JSON.parse(readFileSync(resolve(process.cwd(), 'evaluations', 'golden-v2', 'cases.json'), 'utf8')).cases;
const toolByName = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));
const optionsOf = (c: GoldenCase): StepSpec[][] => c.expect.anyOf ?? [c.expect.steps ?? []];
const planCases = cases.filter((c) => c.expect.kind === 'plan');

describe('golden set v2 composition', () => {
  it('has 50 uniquely named cases across the five spec categories', () => {
    expect(cases).toHaveLength(50);
    expect(new Set(cases.map((c) => c.id)).size).toBe(50);
    const count = (category: string) => cases.filter((c) => c.category === category).length;
    expect({
      single_step: count('single_step'), multi_step: count('multi_step'), cross_service: count('cross_service'),
      clarification: count('clarification'), refusal: count('refusal'),
    }).toEqual({ single_step: 10, multi_step: 10, cross_service: 15, clarification: 9, refusal: 6 });
  });

  it('expects the response kind implied by each category', () => {
    for (const c of cases) {
      const kind = c.category === 'clarification' || c.category === 'refusal' ? c.category : 'plan';
      expect(c.expect.kind, c.id).toBe(kind);
    }
  });

  it('covers both languages, GitHub, and at least two services in every cross-service alternative', () => {
    expect(cases.filter((c) => c.language === 'en').length).toBeGreaterThanOrEqual(15);
    expect(cases.filter((c) => c.language === 'vi').length).toBeGreaterThanOrEqual(15);
    expect(planCases.filter((c) => optionsOf(c).flat().some((s) => s.tool.startsWith('github.'))).length).toBeGreaterThanOrEqual(8);
    for (const c of cases.filter((c) => c.category === 'cross_service')) {
      for (const option of optionsOf(c)) expect(new Set(option.map((s) => s.tool.split('.')[0])).size, c.id).toBeGreaterThanOrEqual(2);
    }
    // A member may be assigned on the new card itself, so only one alternative needs several steps.
    for (const c of cases.filter((c) => c.category === 'multi_step')) {
      expect(Math.max(...optionsOf(c).map((option) => option.length)), c.id).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('golden set v2 labels', () => {
  it('label only arguments the tool schema accepts, with at least one label per step', () => {
    for (const c of planCases) {
      for (const spec of optionsOf(c).flat()) {
        const tool = toolByName.get(spec.tool);
        expect(tool, `${c.id} ${spec.tool}`).toBeDefined();
        expect(Object.keys(spec.args ?? {}).length, `${c.id} ${spec.tool}`).toBeGreaterThan(0);
        for (const [name, matcher] of Object.entries(spec.args ?? {})) {
          expect(tool!.inputSchema.properties, `${c.id} ${spec.tool}.${name}`).toHaveProperty(name);
          for (const target of [matcher.refTo ?? []].flat()) {
            expect(optionsOf(c).some((o) => o.some((s) => s.tool === target)), `${c.id} refTo ${target}`).toBe(true);
          }
        }
      }
    }
  });

  it('label resource IDs that exist in the fixture workspace or were typed by the user', () => {
    for (const c of planCases) {
      for (const spec of optionsOf(c).flat()) {
        const properties = toolByName.get(spec.tool)!.inputSchema.properties;
        for (const [name, matcher] of Object.entries(spec.args ?? {})) {
          const resource = properties[name]['x-resource'];
          const value = matcher.equals ?? matcher.contains;
          if (!resource || value === undefined) continue;
          const known = knownResourceValues(resource, properties[name]['x-resource-field']);
          expect(known.has(String(value)) || c.prompt.includes(String(value)), `${c.id} ${spec.tool}.${name}=${value}`).toBe(true);
        }
      }
    }
  });

  it('use calendar dates relative to the Tuesday 2026-09-29 clock', () => {
    for (const c of planCases) {
      for (const spec of optionsOf(c).flat()) {
        const due = spec.args?.due?.startsWith;
        if (due) expect(due, c.id).toMatch(/^2026-(09-30|10-0[1-6])$/);
      }
    }
  });
});

describe('golden set v2 answerability', () => {
  // Plan cases must reach the model with every labelled resource already known,
  // so scores measure planning rather than the regex gather rules.
  it.each(planCases.map((c) => [c.id, c] as const))('%s reaches the model with its labelled resources resolved', async (_id, c) => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'refusal', reason: 'offline answerability check' }]);
    const planner = new AIPlanner({ provider, toolCatalog: ALL_TOOLS, gatherSearch: fixtureSearch, serviceRegistry: SERVICE_REGISTRY });
    const memory = new WorkingMemory();
    memory.fromJSON(buildMemory(c.memory));
    const response = await planner.processMessage({ userMessage: c.prompt, memory });
    expect(response.kind === 'clarification' ? response.question : 'reached model').toBe('reached model');

    const context = JSON.stringify(provider.getLastInput()!.workingMemory);
    const tools = new Set(provider.getLastInput()!.toolCatalog.map((tool) => tool.name));
    const option = optionsOf(c)[0]!;
    for (const spec of option) {
      expect(tools.has(spec.tool), `${spec.tool} routed`).toBe(true);
      const properties = toolByName.get(spec.tool)!.inputSchema.properties;
      for (const [name, matcher] of Object.entries(spec.args ?? {})) {
        const value = matcher.equals ?? matcher.contains;
        if (!properties[name]['x-resource'] || value === undefined) continue;
        expect(context.includes(JSON.stringify(String(value))) || c.prompt.includes(String(value)), `${spec.tool}.${name}=${value} known`).toBe(true);
      }
    }
  });

  it('refers to fixtures that exist for every case memory', () => {
    for (const c of cases) expect(() => buildMemory(c.memory), c.id).not.toThrow();
  });
});
