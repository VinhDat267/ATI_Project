import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import {
  TRELLO_OAUTH_TOOLS,
  TRELLO_TOOLS,
  getServiceDefinition,
  getToolDefinition,
  validateTrelloToolArgs,
} from '../src/index.js';

const ajv = new Ajv({ strict: false });
const valid = (tool: string, args: Record<string, unknown>) => ajv.compile(getToolDefinition(tool)!.inputSchema)(args);

describe('Trello schema bounds', () => {
  it('compiles every Trello input and output schema', () => {
    for (const tool of [...TRELLO_TOOLS, ...TRELLO_OAUTH_TOOLS]) {
      ajv.compile(tool.inputSchema);
      ajv.compile(tool.outputSchema);
    }
  });

  it('bounds card title, description and due', () => {
    expect(valid('trello.create_card', { listId: 'L1', title: 'x'.repeat(512), desc: 'd'.repeat(16384) })).toBe(true);
    expect(valid('trello.create_card', { listId: 'L1', title: 'x'.repeat(513) })).toBe(false);
    expect(valid('trello.create_card', { listId: 'L1', title: '' })).toBe(false);
    expect(valid('trello.create_card', { listId: 'L1', title: 't', desc: 'd'.repeat(16385) })).toBe(false);
    expect(valid('trello.update_card', { cardId: 'C1', title: 'x'.repeat(513) })).toBe(false);
    expect(valid('trello.update_card', { cardId: 'C1', desc: 'd'.repeat(16385) })).toBe(false);
    for (const due of ['2026-10-02T17:00:00+07:00', '2026-10-02T10:00:00Z', '2026-10-02T10:00:00.000Z', '2026-10-02T10:00Z']) {
      expect(valid('trello.create_card', { listId: 'L1', title: 't', due })).toBe(true);
      expect(valid('trello.update_card', { cardId: 'C1', due })).toBe(true);
    }
    for (const due of ['tomorrow', '2026-10-02', '2026-10-02T17:00:00', '02/10/2026']) {
      expect(valid('trello.create_card', { listId: 'L1', title: 't', due })).toBe(false);
      expect(valid('trello.update_card', { cardId: 'C1', due })).toBe(false);
    }
  });

  it('bounds comments, list names and checklists', () => {
    expect(valid('trello.add_comment', { cardId: 'C1', text: 'x'.repeat(16384) })).toBe(true);
    expect(valid('trello.add_comment', { cardId: 'C1', text: 'x'.repeat(16385) })).toBe(false);
    expect(valid('trello.add_comment', { cardId: 'C1', text: '' })).toBe(false);
    expect(valid('trello.create_list', { boardId: 'B1', name: 'x'.repeat(513) })).toBe(false);
    const items = (n: number, len = 3) => Array.from({ length: n }, () => 'x'.repeat(len));
    expect(valid('trello.add_checklist', { cardId: 'C1', title: 'c', items: items(100, 512) })).toBe(true);
    expect(valid('trello.add_checklist', { cardId: 'C1', title: 'c', items: items(101) })).toBe(false);
    expect(valid('trello.add_checklist', { cardId: 'C1', title: 'c', items: items(1, 513) })).toBe(false);
    expect(valid('trello.add_checklist', { cardId: 'C1', title: 'x'.repeat(513) })).toBe(false);
  });

  it('caps search_cards.limit at 50, the same bound the adapter applies', () => {
    expect(getToolDefinition('trello.search_cards')!.inputSchema.properties.limit.maximum).toBe(50);
    expect(valid('trello.search_cards', { query: '', limit: 50 })).toBe(true);
    expect(valid('trello.search_cards', { query: '', limit: 51 })).toBe(false);
  });

  it('marks every Trello write as medium risk and says closed:true archives', () => {
    for (const tool of [...TRELLO_TOOLS, ...TRELLO_OAUTH_TOOLS].filter((t) => t.sideEffect === 'write')) {
      expect(tool.riskLevel).toBe('medium');
    }
    const updateCard = getToolDefinition('trello.update_card')!;
    expect(updateCard.description).toMatch(/closed: true.*archive/);
    expect(updateCard.inputSchema.properties.closed.description).toMatch(/archive/);
  });
});

describe('Trello label tools', () => {
  it('declares search_labels as a scoped, listable label discovery read', () => {
    const tool = getToolDefinition('trello.search_labels')!;
    expect(tool).toMatchObject({ sideEffect: 'read', riskLevel: 'low', discovers: 'trello_label', listable: true });
    expect(tool.inputSchema.required).toEqual(['boardId']);
    expect(tool.inputSchema.properties.boardId['x-resource']).toBe('board');
    expect(tool.inputSchema.properties.limit.maximum).toBeLessThanOrEqual(10);
    expect(valid('trello.search_labels', { boardId: 'B1', query: 'bug' })).toBe(true);
    expect(valid('trello.search_labels', { query: 'bug' })).toBe(false);
  });

  it('declares add_label/remove_label writes grounded on card and label', () => {
    for (const name of ['trello.add_label', 'trello.remove_label']) {
      const tool = getToolDefinition(name)!;
      expect(tool).toMatchObject({ sideEffect: 'write', riskLevel: 'medium' });
      expect(tool.inputSchema.required).toEqual(['cardId', 'labelId']);
      expect(tool.inputSchema.properties.cardId['x-resource']).toBe('card');
      expect(tool.inputSchema.properties.labelId['x-resource']).toBe('trello_label');
      expect(valid(name, { cardId: 'C1', labelId: 'L/../x' })).toBe(false);
      expect(validateTrelloToolArgs(name, { cardId: 'C1', labelId: '../x' })).toBe('Invalid Trello resource ID for labelId');
      expect(validateTrelloToolArgs(name, { cardId: 'C1', labelId: 'LB1' })).toBeNull();
    }
  });

  it('lets create_card take bounded, validated idLabels', () => {
    expect(valid('trello.create_card', { listId: 'L1', title: 't', idLabels: ['LB1'] })).toBe(true);
    expect(valid('trello.create_card', { listId: 'L1', title: 't', idLabels: Array.from({ length: 21 }, (_, i) => `l${i}`) })).toBe(false);
    expect(getToolDefinition('trello.create_card')!.inputSchema.properties.idLabels['x-resource']).toBe('trello_label');
    expect(validateTrelloToolArgs('trello.create_card', { listId: 'L1', idLabels: ['ok', 'bad/id'] })).toBe(
      'Invalid Trello resource ID for idLabels[1]'
    );
  });

  it('gathers "nhãn X cho thẻ" via search_labels behind a board, but not a bare Gmail-style label', () => {
    const trello = getServiceDefinition('trello')!;
    const rule = trello.gatherRules!.find((r) => r.entityKey === 'trello_label')!;
    expect(rule).toMatchObject({ tool: 'trello.search_labels', requires: { entityKey: 'board', argument: 'boardId' } });
    expect('gắn nhãn Bug cho thẻ "Sửa CSS"'.match(rule.pattern)?.[1]).toBe('Bug');
    expect('gắn nhãn Ưu tiên cho thẻ "Sửa CSS"'.match(rule.pattern)?.[1]).toBe('Ưu tiên');
    expect('add label urgent to card "Fix CSS"'.match(rule.pattern)?.[1]).toBe('urgent');
    expect(rule.pattern.test('gắn nhãn Quan trọng cho email của Lan')).toBe(false);
    expect(trello.intentKeywords).not.toContain('label');
    expect(trello.fallbackIntentKeywords).toEqual(expect.arrayContaining(['label', 'labels', 'nhãn']));
  });
});
