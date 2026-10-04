import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { ChatService } from '../../src/services/chat-service.js';
import { resourceLabels } from '../../src/services/resource-labels.js';
import { WorkingMemory } from '@wap/planner';
it.each([true, false])('scopes duplicate issue numbers to the actual parent, with a known repo=%s', knownRepo => {
  const memory = new WorkingMemory();
  memory.setEntity('__observed', { issue: [
    { id: 'a42', number: 42, title: 'Issue A', repo: 'a/repo' },
    { id: 'b42', number: 42, title: 'Issue B', repo: 'b/repo' },
  ] });
  const plan = { kind: 'plan', summary: 'Đọc issue', warnings: [], steps: [{ id: 's1', tool: 'github.get_issue', args: { repo: knownRepo ? 'b/repo' : { $ref: 'prior.output.fullName' }, issueNumber: 42 } }] } as any;
  const labels = resourceLabels(plan, memory);
  if (knownRepo) expect(labels['42']).toBe('Issue B');
  else expect(Object.hasOwn(labels, '42')).toBe(false);
});
it('omits duplicate issue numbers when the lookup did not retain their parent scope', () => {
  const memory = new WorkingMemory();
  memory.setEntity('issue', [{ id: 'a42', number: 42, title: 'Issue A' }, { id: 'b42', number: 42, title: 'Issue B' }]);
  const plan = { kind: 'plan', summary: 'Đọc issue', warnings: [], steps: [{ id: 's1', tool: 'github.get_issue', args: { repo: 'b/repo', issueNumber: 42 } }] } as any;
  expect(Object.hasOwn(resourceLabels(plan, memory), '42')).toBe(false);
});
it('keeps a conflicting raw identifier unlabeled rather than choosing another resource name', () => {
  const memory = new WorkingMemory();
  memory.setEntity('list', { id: 'same', name: 'Cần làm' }); memory.setEntity('member', { id: 'same', name: 'Minh' });
  const plan = { kind: 'plan', thinking: 'Đã tra cứu', summary: 'Tạo và gán', warnings: [], steps: [
    { id: 's1', tool: 'trello.create_card', description: 'Tạo', dependsOn: [], args: { listId: 'same', title: 'Task' } },
    { id: 's2', tool: 'trello.add_member', description: 'Gán', dependsOn: [], args: { cardId: { $ref: 's1.output.id' }, memberId: 'same' } },
  ] } as any;
  expect(resourceLabels(plan, memory)).toEqual({});
});
it('uses schema resource fields and omits unknown names and unresolved parents', () => {
  const memory = new WorkingMemory();
  memory.setEntity('repository', { id: 'opaque', fullName: 'owner/repo' });
  memory.setEntity('issue', { id: 'issue-id', number: 42, title: 'Sửa lỗi' });
  memory.setEntity('list', { id: 'L1', name: 'Cần làm', boardId: 'unknown-parent' });
  const plan = { kind: 'plan', thinking: 'Đã tra cứu', summary: 'Đọc', warnings: [], steps: [
    { id: 's1', tool: 'github.get_issue', description: 'Đọc', dependsOn: [], args: { repo: 'owner/repo', issueNumber: 42 } },
    { id: 's2', tool: 'trello.create_card', description: 'Tạo', dependsOn: [], args: { listId: 'L1', title: 'issue-id' } },
  ] } as any;
  expect(resourceLabels(plan, memory)).toEqual({ 'owner/repo': 'owner/repo', 42: 'Sửa lỗi', L1: 'Cần làm' });
});
it('emits and saves only grounded x-resource labels outside the executable JSON and hash', async () => {
  const events = new EventEmitter();
  const stored: any[] = [];
  const plans: any[] = [];
  const plan = { kind: 'plan', thinking: '', summary: 'Tạo thẻ', warnings: [], steps: [{ id: 's1', tool: 'trello.create_card', description: 'Tạo thẻ', dependsOn: [], args: { listId: 'L1', title: 'B1' } }, { id: 's2', tool: 'slack.send_message', description: 'Gửi', dependsOn: [], args: { channel: 'not-observed', text: 'B1' } }] };
  const service = new ChatService({
    msgRepo: { createMessage: async (_c: string, role: string, content: string, metadata: any) => { const row = { id: String(stored.length), role, content, metadata }; stored.push(row); return row; }, listMessages: async () => stored } as any,
    planRepo: { createPlan: async (data: any) => { plans.push(data); return { id: 'p1' }; } } as any,
    planner: { processMessage: async ({ memory }: any) => { memory.setEntity('__observed', { board: [{ id: 'B1', name: 'Frontend' }], list: [{ id: 'L1', name: 'Cần làm', boardId: 'B1' }], channel: [{ id: 'C1', name: 'general' }] }); return plan; } } as any,
    eventEmitter: { emit: (event, payload) => events.emit(event, payload) },
  });
  const preview = new Promise<any>(resolve => events.once('plan_preview', resolve));
  await service.handleUserMessage({ conversationId: 'c1', userId: 'u1', content: 'Tạo thẻ', requestId: 'request-fe03' });
  const event = await preview;
  expect(event.resourceLabels).toEqual({ L1: 'Cần làm (board Frontend)' });
  expect(plans[0].resourceLabels).toEqual(event.resourceLabels);
  expect(stored.find(row => row.metadata?.type === 'plan').metadata.resourceLabels).toEqual(event.resourceLabels);
  expect(stored[0].metadata).toEqual({ requestId: 'request-fe03' });
  expect(stored.find(row => row.metadata?.type === 'plan').metadata).toMatchObject({ replyToMessageId: stored[0].id, requestId: 'request-fe03' });
  expect(event).toMatchObject({ replyToMessageId: stored[0].id, requestId: 'request-fe03' });
  expect(plans[0].planJson).toEqual(plan);
  expect(plans[0].planText).toBe(JSON.stringify(plan));
  expect(plans[0].planHash).toBe(createHash('sha256').update(JSON.stringify(plan)).digest('hex'));
});
