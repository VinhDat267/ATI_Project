import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ALL_TOOLS, type PlannerResponse, type PlanStep } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider, WorkingMemory, validatePlan } from '@wap/planner';
import { buildMemory, fixtureSearch, knownResourceValues } from './fixtures.js';
import * as runner from './run.js';
import { scoreCase, type GoldenCase, type Matcher, type StepSpec } from './scorer.js';

const file = JSON.parse(readFileSync(new URL('./cases-multiturn.json', import.meta.url), 'utf8'));
const cases = file.cases as GoldenCase[];
const specs = (c: GoldenCase): StepSpec[] => c.expect.anyOf?.flat() ?? c.expect.steps ?? [];
const matchers = (matcher: Matcher): Matcher[] => [matcher, ...(matcher.anyOf ?? []).flatMap(matchers)];
const lastAssistant = (c: GoldenCase) => c.turns!.at(-1)!.content;
const isPlan = (content: unknown): content is { steps: PlanStep[] } => typeof content === 'object' && content !== null;
const resource = (tool: string, name: string) => ALL_TOOLS.find(t => t.name === tool)!.inputSchema.properties[name] as Record<string, string>;

// Final plans, scored directly: a good plan changes what was asked and keeps the rest;
// each bad one gets the asked-for change right but breaks one other field.
type Step = { id: string; tool: string; args: Record<string, unknown>; dependsOn?: string[] };
const plan = (...steps: Step[]): PlannerResponse => ({ kind: 'plan', thinking: 't', summary: 's', warnings: [],
  steps: steps.map(step => ({ description: 'd', dependsOn: [], ...step })) as PlanStep[] });
const card = (listId: string, title: string, extra: Record<string, unknown> = {}): Step => ({ id: 'card', tool: 'trello.create_card', args: { listId, title, ...extra } });
const slack = (channel: string, text: unknown, dependsOn: string[] = []): Step => ({ id: 'notify', tool: 'slack.send_message', args: { channel, text }, dependsOn });
const issue = (repo: string, title: string): Step => ({ id: 'issue', tool: 'github.create_issue', args: { repo, title } });
const link = (step: string) => ({ $template: `Link: \${${step}.output.url}` });
const examples: Record<string, { good: Step[][]; bad: Record<string, Step[]> }> = {
  mt_edit01: { good: [[card('list_fe_todo', 'Sửa lỗi đăng nhập trên Safari')]],
    bad: { 'title cut to the new word': [card('list_fe_todo', 'Safari')], 'list changed': [card('list_fe_doing', 'Sửa lỗi đăng nhập trên Safari')] } },
  mt_edit02: { good: [[card('list_fe_todo', 'Viết release notes'), slack('C_RELEASE', link('card'), ['card'])]],
    bad: { 'kept title changed': [card('list_fe_todo', 'Không viết release notes'), slack('C_RELEASE', link('card'), ['card'])],
      'channel not changed': [card('list_fe_todo', 'Viết release notes'), slack('C_FE', link('card'), ['card'])],
      'card link dropped': [card('list_fe_todo', 'Viết release notes'), slack('C_RELEASE', 'Đã tạo card.')] } },
  mt_edit03: { good: [[card('list_fe_doing', 'Thiết kế trang hồ sơ', { idMembers: ['member_lan'] })],
    [card('list_fe_doing', 'Thiết kế trang hồ sơ'), { id: 'assign', tool: 'trello.add_member', args: { cardId: { $ref: 'card.output.id' }, memberId: 'member_lan' }, dependsOn: ['card'] }]],
    bad: { 'kept title changed': [card('list_fe_doing', 'Xóa hồ sơ', { idMembers: ['member_lan'] })],
      'someone else assigned': [card('list_fe_doing', 'Thiết kế trang hồ sơ', { idMembers: ['member_minh'] })] } },
  mt_edit04: { good: [[issue('acme/web', 'Footer overlaps'), slack('C_FE', link('issue'), ['issue'])]],
    bad: { 'kept issue title shortened': [issue('acme/web', 'Footer'), slack('C_FE', link('issue'), ['issue'])],
      'dropped card kept': [issue('acme/web', 'Footer overlaps'), card('list_fe_todo', 'Footer overlaps'), slack('C_FE', link('issue'), ['issue'])],
      'channel changed': [issue('acme/web', 'Footer overlaps'), slack('C_GEN', link('issue'), ['issue'])] } },
  mt_edit05: { good: [[card('list_be_backlog', 'Retry webhook')]],
    bad: { 'kept title changed': [card('list_be_backlog', 'Cancel Retry webhook')], 'list not changed': [card('list_be_todo', 'Retry webhook')] } },
  mt_edit06: { good: [[card('list_fe_todo', 'Chuẩn bị demo', { due: '2026-10-05T17:00:00+07:00' })]],
    bad: { 'kept title changed': [card('list_fe_todo', 'Không Chuẩn bị demo', { due: '2026-10-05T17:00:00+07:00' })],
      'deadline not moved': [card('list_fe_todo', 'Chuẩn bị demo', { due: '2026-10-02T17:00:00+07:00' })] } },
  mt_reply01: { good: [[card('list_fe_todo', 'Kiểm tra form đăng ký')]],
    bad: { 'another list': [card('list_fe_done', 'Kiểm tra form đăng ký')], 'title of the request changed': [card('list_fe_todo', 'Kiểm tra')] } },
  mt_reply02: { good: [[slack('C_FE', "Tonight's build failed.")]],
    bad: { 'meaning of the request flipped': [slack('C_FE', "Tonight's build succeeded.")], 'another channel': [slack('C_GEN', "Tonight's build failed.")] } },
  mt_reply03: { good: [[issue('acme/web', 'Footer covers the last form field')]],
    bad: { 'another repo': [issue('acme/api', 'Footer covers the last form field')], 'unrelated title': [issue('acme/web', 'Login bug')] } },
  mt_new01: { good: [[slack('C_GEN', 'Họp nhóm lúc 3 giờ chiều nay.')]],
    bad: { 'old step carried over': [card('list_fe_todo', 'Sửa lỗi đăng nhập'), slack('C_GEN', 'Họp nhóm lúc 3 giờ chiều nay.')],
      'wrong time': [slack('C_GEN', 'Họp nhóm lúc 9 giờ sáng nay.')] } },
  mt_new02: { good: [[issue('acme/api', 'Webhook retries drop events')]],
    bad: { 'old step carried over': [slack('C_RELEASE', 'Bản 1.2 đã phát hành.'), issue('acme/api', 'Webhook retries drop events')],
      'title the user gave changed': [issue('acme/api', 'Webhook')] } },
  mt_new03: { good: [[card('list_be_backlog', 'Write the API docs')]],
    bad: { 'old step carried over': [issue('acme/web', 'Footer overlaps on small screens'), card('list_be_backlog', 'Write the API docs')],
      'title the user gave changed': [card('list_be_backlog', 'API docs draft')] } },
};

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
  it.each(Object.entries(examples))('%s passes a plan that keeps every other field and fails one that changes any of them', (id, { good, bad }) => {
    const c = cases.find(item => item.id === id)!;
    for (const [index, steps] of good.entries()) expect(scoreCase(c, plan(...steps), ALL_TOOLS).passed, `${id} good ${index}`).toBe(true);
    for (const [why, steps] of Object.entries(bad)) expect(scoreCase(c, plan(...steps), ALL_TOOLS).passed, `${id}: ${why}`).toBe(false);
  });
  it('covers every case in the examples and matches titles that must stay or that the user wrote out exactly', () => {
    expect(Object.keys(examples).sort()).toEqual(cases.map(c => c.id).sort());
    for (const c of cases.filter(item => item.category !== 'turn_reply' || item.id === 'mt_reply01'))
      for (const spec of specs(c)) if (spec.args?.title) expect(Object.keys(spec.args.title), `${c.id}:${spec.tool}`).toEqual(['equals']);
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
