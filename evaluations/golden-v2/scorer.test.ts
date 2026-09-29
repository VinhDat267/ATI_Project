import { describe, it, expect } from 'vitest';
import type { PlannerResponse } from '@wap/tool-schemas';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { scoreCase, aggregateRuns, type GoldenCase, type CaseRun } from './scorer.js';

const plan = (...steps: Array<{ id: string; tool: string; args: Record<string, unknown>; dependsOn?: string[] }>): PlannerResponse => ({
  kind: 'plan', thinking: 't', summary: 's', warnings: [],
  steps: steps.map((step) => ({ description: 'd', dependsOn: [], ...step })) as any,
});

const demoCase: GoldenCase = {
  id: 'cs_demo', category: 'cross_service', language: 'vi', prompt: 'demo',
  expect: {
    kind: 'plan',
    // Minh may be assigned on the new card itself or by a separate add_member step.
    anyOf: [
      [
        { tool: 'trello.create_card', args: { listId: { equals: 'list_fe_todo' }, title: { includesAny: ['homepage'] }, due: { startsWith: '2026-10-02' }, idMembers: { contains: 'member_minh' } } },
        { tool: 'slack.send_message', args: { channel: { equals: 'C_FE' }, text: { refTo: 'trello.create_card' } } },
      ],
      [
        { tool: 'trello.create_card', args: { listId: { equals: 'list_fe_todo' }, title: { includesAny: ['homepage'] }, due: { startsWith: '2026-10-02' } } },
        { tool: 'trello.add_member', args: { memberId: { equals: 'member_minh' }, cardId: { refTo: 'trello.create_card' } } },
        { tool: 'slack.send_message', args: { channel: { equals: 'C_FE' }, text: { refTo: 'trello.create_card' } } },
      ],
    ],
  },
};

const goodDemo = plan(
  { id: 'card', tool: 'trello.create_card', args: { listId: 'list_fe_todo', title: 'Cập nhật Homepage', due: '2026-10-02T17:00:00+07:00', idMembers: ['member_minh'] } },
  { id: 'note', tool: 'slack.send_message', args: { channel: 'C_FE', text: { $template: 'Card: ${card.output.url}' } }, dependsOn: ['card'] },
);

describe('scoreCase', () => {
  it('passes a plan whose tools and labelled arguments all match', () => {
    const score = scoreCase(demoCase, goodDemo, ALL_TOOLS);
    expect(score).toMatchObject({ kindOk: true, toolsOk: true, argsOk: true, passed: true });
    expect(score.matchers).toEqual({ passed: 6, total: 6 });
  });

  it('accepts the alternative way of assigning a member', () => {
    const score = scoreCase(demoCase, plan(
      { id: 'card', tool: 'trello.create_card', args: { listId: 'list_fe_todo', title: 'homepage', due: '2026-10-02T17:00:00+07:00' } },
      { id: 'assign', tool: 'trello.add_member', args: { cardId: { $ref: 'card.output.id' }, memberId: 'member_minh' }, dependsOn: ['card'] },
      { id: 'note', tool: 'slack.send_message', args: { channel: 'C_FE', text: { $template: '${card.output.url}' } }, dependsOn: ['card'] },
    ), ALL_TOOLS);
    expect(score.passed).toBe(true);
  });

  it('keeps correct tools but fails arguments that miss a label', () => {
    const score = scoreCase(demoCase, plan(
      { id: 'card', tool: 'trello.create_card', args: { listId: 'list_fe_todo', title: 'homepage', desc: 'Deadline thứ 6', idMembers: ['member_minh'] } },
      { id: 'note', tool: 'slack.send_message', args: { channel: 'C_FE', text: 'Đã tạo card' } },
    ), ALL_TOOLS);
    expect(score).toMatchObject({ toolsOk: true, argsOk: false, passed: false });
    expect(score.matchers).toEqual({ passed: 4, total: 6 });
    expect(score.failures.join('\n')).toMatch(/due/);
    expect(score.failures.join('\n')).toMatch(/text/);
  });

  it('fails tool selection on a missing tool or an unexpected write tool', () => {
    expect(scoreCase(demoCase, plan(
      { id: 'card', tool: 'trello.create_card', args: { listId: 'list_fe_todo', title: 'homepage' } },
    ), ALL_TOOLS).toolsOk).toBe(false);
    expect(scoreCase(demoCase, plan(
      { id: 'card', tool: 'trello.create_card', args: { listId: 'list_fe_todo', title: 'homepage', idMembers: ['member_minh'] } },
      { id: 'issue', tool: 'github.create_issue', args: { repo: 'acme/web', title: 'x' } },
      { id: 'note', tool: 'slack.send_message', args: { channel: 'C_FE', text: { $template: '${card.output.url}' } } },
    ), ALL_TOOLS).toolsOk).toBe(false);
  });

  it('ignores extra read-only steps', () => {
    const withLookup = plan(
      { id: 'look', tool: 'trello.search_cards', args: { query: 'homepage' } },
      ...(goodDemo as any).steps,
    );
    expect(scoreCase(demoCase, withLookup, ALL_TOOLS).passed).toBe(true);
  });

  it('matches repeated tools one-to-one', () => {
    const twoCards: GoldenCase = { ...demoCase, expect: { kind: 'plan', steps: [
      { tool: 'trello.create_card', args: { title: { includesAny: ['ảnh'] } } },
      { tool: 'trello.create_card', args: { title: { includesAny: ['lazy'] } } },
    ] } };
    const one = plan({ id: 'a', tool: 'trello.create_card', args: { listId: 'l', title: 'Tối ưu ảnh, lazy load' } });
    expect(scoreCase(twoCards, one, ALL_TOOLS).toolsOk).toBe(false);
    const two = plan(
      { id: 'a', tool: 'trello.create_card', args: { listId: 'l', title: 'Thêm lazy load' } },
      { id: 'b', tool: 'trello.create_card', args: { listId: 'l', title: 'Tối ưu ảnh' } },
    );
    expect(scoreCase(twoCards, two, ALL_TOOLS).passed).toBe(true);
  });

  it('requires every tool named by a refTo list and supports absent, minItems and endsWith', () => {
    const linked: GoldenCase = { ...demoCase, expect: { kind: 'plan', steps: [
      { tool: 'github.create_issue', args: { repo: { equals: 'acme/web' }, labels: { absent: true } } },
      { tool: 'trello.add_checklist', args: { items: { minItems: 3 }, cardId: { equals: 'card_1' } } },
      { tool: 'slack.send_message', args: { text: { refTo: ['github.create_issue', 'trello.add_checklist'] }, channel: { endsWith: 'FE' } } },
    ] } };
    const response = plan(
      { id: 'i', tool: 'github.create_issue', args: { repo: 'acme/web', title: 'x' } },
      { id: 'c', tool: 'trello.add_checklist', args: { cardId: 'card_1', title: 'QA', items: ['a', 'b', 'c'] } },
      { id: 's', tool: 'slack.send_message', args: { channel: 'C_FE', text: { $template: '${i.output.url} ${c.output.id}' } } },
    );
    expect(scoreCase(linked, response, ALL_TOOLS).passed).toBe(true);
    const onlyIssue = plan(
      { id: 'i', tool: 'github.create_issue', args: { repo: 'acme/web', title: 'x', labels: ['bug'] } },
      { id: 'c', tool: 'trello.add_checklist', args: { cardId: 'card_1', title: 'QA', items: ['a'] } },
      { id: 's', tool: 'slack.send_message', args: { channel: 'C_FE', text: { $template: '${i.output.url}' } } },
    );
    expect(scoreCase(linked, onlyIssue, ALL_TOOLS).matchers).toEqual({ passed: 3, total: 6 });
  });

  it('accepts any of several argument matchers', () => {
    const either: GoldenCase = { ...demoCase, expect: { kind: 'plan', steps: [
      { tool: 'trello.update_card', args: { cardId: { equals: 'card_1' } } },
      { tool: 'trello.add_checklist', args: { cardId: { anyOf: [{ equals: 'card_1' }, { refTo: 'trello.update_card' }] } } },
    ] } };
    const byRef = plan(
      { id: 'u', tool: 'trello.update_card', args: { cardId: 'card_1', title: 'x' } },
      { id: 'c', tool: 'trello.add_checklist', args: { cardId: { $ref: 'u.output.id' }, title: 'QA' } },
    );
    expect(scoreCase(either, byRef, ALL_TOOLS).passed).toBe(true);
    const wrong = plan(
      { id: 'u', tool: 'trello.update_card', args: { cardId: 'card_1', title: 'x' } },
      { id: 'c', tool: 'trello.add_checklist', args: { cardId: 'card_2', title: 'QA' } },
    );
    expect(scoreCase(either, wrong, ALL_TOOLS).passed).toBe(false);
  });

  it('scores clarification and refusal cases by kind only', () => {
    const ask: GoldenCase = { id: 'cl', category: 'clarification', language: 'en', prompt: 'x', expect: { kind: 'clarification' } };
    expect(scoreCase(ask, { kind: 'clarification', question: 'Which list?', context: '' }, ALL_TOOLS))
      .toMatchObject({ kindOk: true, toolsOk: null, argsOk: null, passed: true });
    expect(scoreCase(ask, goodDemo, ALL_TOOLS)).toMatchObject({ kindOk: false, passed: false });
    expect(scoreCase(ask, undefined, ALL_TOOLS)).toMatchObject({ kindOk: false, passed: false });
  });
});

describe('aggregateRuns', () => {
  const planCase = demoCase;
  const askCase: GoldenCase = { id: 'cl', category: 'clarification', language: 'en', prompt: 'x', expect: { kind: 'clarification' } };
  const run = (planResponse: PlannerResponse | undefined, latencyMs: number): CaseRun[] => [
    { case: planCase, response: planResponse, latencyMs, llmCalls: 1, score: scoreCase(planCase, planResponse, ALL_TOOLS) },
    { case: askCase, response: { kind: 'clarification', question: 'q', context: '' }, latencyMs: 5, llmCalls: 0,
      score: scoreCase(askCase, { kind: 'clarification', question: 'q', context: '' }, ALL_TOOLS) },
  ];

  it('reports spec metrics per run, their mean and per-case stability', () => {
    const wrongArgs = plan(
      { id: 'card', tool: 'trello.create_card', args: { listId: 'list_fe_todo', title: 'homepage', idMembers: ['member_minh'] } },
      { id: 'note', tool: 'slack.send_message', args: { channel: 'C_FE', text: { $template: '${card.output.url}' } } },
    );
    const report = aggregateRuns([run(goodDemo, 8000), run(wrongArgs, 12000), run(undefined, 30000)]);
    expect(report.runs.map((r) => r.toolSelectionAccuracy)).toEqual([1, 1, 0]);
    expect(report.runs.map((r) => r.argumentQuality)).toEqual([1, 0, null]);
    expect(report.runs.map((r) => r.strictPassRate)).toEqual([1, 0.5, 0.5]);
    expect(report.mean.toolSelectionAccuracy).toBeCloseTo(2 / 3);
    expect(report.mean.argumentQuality).toBeCloseTo(0.5);
    expect(report.byCategory.cross_service.strictPassRate).toBeCloseTo(1 / 3);
    expect(report.byCategory.clarification.strictPassRate).toBe(1);
    expect(report.stability).toEqual({ cs_demo: '1/3', cl: '3/3' });
    expect(report.latencyMs.p50).toBe(5);
    expect(report.latencyMs.max).toBe(30000);
    expect(report.usablePlanRate).toBeNull();
  });
});
