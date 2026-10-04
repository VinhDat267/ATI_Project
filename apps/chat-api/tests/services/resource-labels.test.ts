import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { ChatService } from '../../src/services/chat-service.js';
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
  await service.handleUserMessage({ conversationId: 'c1', userId: 'u1', content: 'Tạo thẻ' });
  const event = await preview;
  expect(event.resourceLabels).toEqual({ L1: 'Cần làm (board Frontend)' });
  expect(plans[0].resourceLabels).toEqual(event.resourceLabels);
  expect(stored.find(row => row.metadata?.type === 'plan').metadata.resourceLabels).toEqual(event.resourceLabels);
  expect(plans[0].planJson).toEqual(plan);
  expect(plans[0].planText).toBe(JSON.stringify(plan));
  expect(plans[0].planHash).toBe(createHash('sha256').update(JSON.stringify(plan)).digest('hex'));
});
