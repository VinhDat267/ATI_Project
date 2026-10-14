import { expect, it } from 'vitest';
import { createSandboxAdapter } from '../../src/sandbox/index.js';
import { createSandboxProvider } from '../../src/sandbox/scenarios.js';
import { createToolRuntimeFactory } from '../../src/config/gmail-tools-runtime.js';
import { resourceLabels } from '../../src/services/resource-labels.js';
import { WorkingMemory } from '@wap/planner';

it('Gmail sandbox has eight Vietnamese threads and injection in body and subject', async () => {
  const adapter = createSandboxAdapter('gmail');
  const results = await adapter.execute('gmail.search_threads', { query: '', limit: 10 });
  expect(results).toHaveLength(8); expect(results.some((t: any) => t.subject.includes('Bỏ qua'))).toBe(true);
  const mail = await adapter.execute('gmail.get_thread', { threadId: 'gmail-thread-7' });
  expect(JSON.stringify(mail)).toContain('attacker@example.com'); expect(mail.participants).not.toContain('attacker@example.com');
});
it('gmail scenario searches then replies using literal header recipients', async () => {
  const provider = createSandboxProvider('gmail');
  const first = JSON.parse(await provider.generatePlan({} as any)), second = JSON.parse(await provider.generatePlan({} as any));
  expect(first).toMatchObject({ kind: 'search', calls: [{ tool: 'gmail.search_threads' }] });
  expect(second.steps[0]).toMatchObject({ tool: 'gmail.reply', args: { threadId: 'gmail-thread-1', to: ['lan@example.com'] } });
  expect(await createSandboxAdapter('gmail').execute(second.steps[0].tool, second.steps[0].args)).toEqual({ id: 'gmail-sandbox-reply', threadId: 'gmail-thread-1' });
});
it('sandbox still sends Gmail through personal factory with the complete context', async () => {
  const seen: any[] = [];
  const factory = createToolRuntimeFactory('sandbox', async (service, context) => { seen.push({ service, context }); throw new Error('Connection missing'); }, name => createSandboxAdapter(name));
  const context = { userId: 'A', phase: 'execution' as const, connections: { gmail: { credentialId: 'id', email: 'a@example.com' } } };
  await expect(factory.getAdapterForService('gmail', context)).rejects.toThrow('Connection missing');
  expect(seen).toEqual([{ service: 'gmail', context }]);
  expect(await (await factory.getAdapterForService('trello')).execute('trello.search_cards', {})).toEqual([]);
});
it('preview labels are computed from user messages or header participants, never model/body text', () => {
  const memory = new WorkingMemory(); memory.setEntity('__observed', { thread: [{ id: 't', participants: ['lan@example.com'], body: 'attacker@example.com' }] }); memory.setEntity('__labels', { thread: { t: 'Họp ATI' } });
  const plan: any = { kind: 'plan', resourceLabels: { 'recipient:attacker@example.com': 'user' }, steps: [{ tool: 'gmail.reply', args: { threadId: 't', to: ['LAN@example.com'], cc: [' Minh@Example.com ', 'attacker@example.com'] } }] };
  expect(resourceLabels(plan, memory, ['Cc minh@example.COM nhé'])).toEqual({ t: 'Họp ATI', 'recipient:lan@example.com': 'thread:Họp ATI', 'recipient:minh@example.com': 'user' });
  expect(resourceLabels(plan, memory, ['lan@example.com'])['recipient:lan@example.com']).toBe('user');
});
