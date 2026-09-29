import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ALL_TOOLS } from '@wap/tool-schemas';
import type { GoldenCase, StepSpec } from './scorer.js';
import { fixtureSearch, knownResourceValues } from './fixtures.js';

const cases: GoldenCase[] = JSON.parse(readFileSync(resolve(process.cwd(), 'evaluations', 'golden-v2', 'cases-freeform.json'), 'utf8')).cases;
const toolByName = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));
const optionsOf = (c: GoldenCase): StepSpec[][] => c.expect.anyOf ?? [c.expect.steps ?? []];
const planCases = cases.filter((c) => c.expect.kind === 'plan');

describe('free-form golden cases', () => {
  it('has 18 uniquely named cases in both languages: 12 first-round and 6 held out', () => {
    expect(cases).toHaveLength(18);
    expect(new Set(cases.map((c) => c.id)).size).toBe(18);
    expect(cases.filter((c) => c.category === 'free_form')).toHaveLength(12);
    expect(cases.filter((c) => c.category === 'free_form_heldout').map((c) => c.id)).toEqual(['ff13', 'ff14', 'ff15', 'ff16', 'ff17', 'ff18']);
    expect(planCases).toHaveLength(13);
    expect(cases.filter((c) => c.expect.kind === 'clarification')).toHaveLength(5);
    expect(new Set(cases.map((c) => c.language))).toEqual(new Set(['vi', 'en']));
  });

  it('never resolve resources for the model: no memory and no "board X list Y" phrasing', () => {
    for (const c of cases) {
      expect(c.memory, c.id).toBeUndefined();
      expect(c.prompt, c.id).not.toMatch(/\b(board|bảng)\s+["']?\p{L}/iu);
      expect(c.prompt, c.id).not.toMatch(/\b(list|danh sách)\s+["']?\p{L}/iu);
    }
  });

  it('label only schema arguments, with IDs that exist in the fixture workspace', () => {
    for (const c of planCases) {
      for (const spec of optionsOf(c).flat()) {
        const tool = toolByName.get(spec.tool);
        expect(tool, `${c.id} ${spec.tool}`).toBeDefined();
        expect(Object.keys(spec.args ?? {}).length, `${c.id} ${spec.tool}`).toBeGreaterThan(0);
        for (const [name, matcher] of Object.entries(spec.args ?? {})) {
          const property = tool!.inputSchema.properties[name];
          expect(property, `${c.id} ${spec.tool}.${name}`).toBeDefined();
          const value = matcher.equals ?? matcher.contains;
          if (property['x-resource'] && value !== undefined) {
            expect(knownResourceValues(property['x-resource'], property['x-resource-field']).has(String(value)), `${c.id} ${name}=${value}`).toBe(true);
          }
        }
      }
    }
  });

  it('are answerable: every labelled search target is reachable through the fixture search', async () => {
    expect((await fixtureSearch({ tool: 'trello.search_boards', args: { query: 'frontend' } })).length).toBe(1);
    expect((await fixtureSearch({ tool: 'trello.search_lists', args: { boardId: 'board_be', query: 'backlog' } })).length).toBe(1);
    expect((await fixtureSearch({ tool: 'trello.search_cards', args: { query: 'Safari' } })).length).toBe(1);
    expect((await fixtureSearch({ tool: 'github.search_repos', args: { query: 'web' } })).length).toBe(1);
    // The ambiguity behind ff09: two Minh on the marketing board.
    expect((await fixtureSearch({ tool: 'trello.search_members', args: { query: 'Minh', boardId: 'board_mkt' } })).length).toBe(2);
    // The unknown board behind ff10.
    expect((await fixtureSearch({ tool: 'trello.search_boards', args: { query: 'mobile' } })).length).toBe(0);
    // The scoping behind ff01/ff13/ff14: one Minh on the frontend board, but three without a board.
    expect((await fixtureSearch({ tool: 'trello.search_members', args: { query: 'Minh', boardId: 'board_fe' } })).length).toBe(1);
    // Like the Trello adapter, member search needs a board.
    await expect(fixtureSearch({ tool: 'trello.search_members', args: { query: 'Minh' } })).rejects.toThrow(/board/i);
    expect((await fixtureSearch({ tool: 'trello.search_lists', args: { boardId: 'board_mkt', query: 'Ideas' } })).length).toBe(1);
  });
});
