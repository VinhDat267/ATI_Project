import { describe, expect, it } from 'vitest';
import { MockLLMProvider } from '@wap/planner';
import { ALL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import { casePrompts, evalCatalog, historyOf, parseEvalOptions, publicEvidenceResponse, runCase, type GoldenFile } from './run.js';
import type { GoldenCase } from './scorer.js';

const file: GoldenFile = { version: 1, clock: '2026-09-29T10:00:00+07:00', timeZone: 'Asia/Ho_Chi_Minh', cases: [] };
const plan = { kind: 'plan', thinking: 't', summary: 'Tạo card', warnings: [], steps: [{ id: 'card', tool: 'trello.create_card', description: 'Tạo card',
  args: { listId: 'list_fe_todo', title: 'Sửa lỗi đăng nhập' }, dependsOn: [] }] };
const edit: GoldenCase = { id: 'mt_demo', category: 'turn_edit', language: 'vi', prompt: 'Điều chỉnh kế hoạch: đổi tiêu đề thành "Sửa lỗi Safari".',
  memory: { list: 'list_fe_todo' },
  turns: [{ role: 'user', content: 'Tạo card "Sửa lỗi đăng nhập" trong list To Do của board Frontend.' }, { role: 'assistant', content: plan }],
  expect: { kind: 'plan', steps: [{ tool: 'trello.create_card', args: { listId: { equals: 'list_fe_todo' }, title: { includesAll: ['Safari'] } } }] } };

describe('multi-turn evaluation cases', () => {
  it('rebuilds the history chat-service sends: earlier user text, a saved plan as its JSON, a question as text', () => {
    expect(historyOf(edit)).toEqual([
      { role: 'user', content: 'Tạo card "Sửa lỗi đăng nhập" trong list To Do của board Frontend.' },
      { role: 'assistant', content: JSON.stringify(plan) },
    ]);
    expect(historyOf({ ...edit, turns: [{ role: 'user', content: 'Báo Slack.' }, { role: 'assistant', content: 'Kênh nào?' }] }))
      .toEqual([{ role: 'user', content: 'Báo Slack.' }, { role: 'assistant', content: 'Kênh nào?' }]);
    expect(historyOf({ ...edit, turns: undefined })).toEqual([]);
  });
  it('sends the earlier turns before the final message and scores only the final response', async () => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ ...plan, steps: [{ ...plan.steps[0]!, args: { listId: 'list_fe_todo', title: 'Sửa lỗi Safari' } }] }]);
    const row = await runCase(edit, file, false, 'llm', { provider });
    expect(provider.getLastInput()!.conversationHistory).toEqual([...historyOf(edit), { role: 'user', content: edit.prompt }]);
    expect(row.score.passed).toBe(true);
  });
  it('leaves a case without turns as before', async () => {
    const provider = new MockLLMProvider();
    provider.setPlanResponses([{ kind: 'refusal', reason: 'r' }]);
    await runCase({ ...edit, turns: undefined }, file, false, 'llm', { provider });
    expect(provider.getLastInput()!.conversationHistory).toEqual([{ role: 'user', content: edit.prompt }]);
  });
  it('redacts every user turn, not only the final prompt, from public evidence', () => {
    expect(casePrompts(edit)).toEqual([edit.prompt, edit.turns![0]!.content]);
    const echoed = { kind: 'plan' as const, thinking: '', summary: `${edit.turns![0]!.content} / ${edit.prompt}`, warnings: [], steps: [] };
    expect(JSON.stringify(publicEvidenceResponse(echoed, casePrompts(edit)))).not.toMatch(/Sửa lỗi đăng nhập|Điều chỉnh kế hoạch/);
    expect(publicEvidenceResponse(echoed, edit.prompt)?.kind).toBe('plan');
  });
  it('runs the multiturn set with the shared catalog', () => {
    expect(parseEvalOptions({ EVAL_SET: 'multiturn' })).toMatchObject({ set: 'multiturn', readAnswers: false });
    expect(evalCatalog('multiturn')).toEqual({ tools: ALL_TOOLS, services: SERVICE_REGISTRY });
  });
});
