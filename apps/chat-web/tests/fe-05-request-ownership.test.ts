import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatStore } from '../src/store/chat-store';
import { apiClient } from '../src/services/api-client';
import { refreshExecutionSnapshot } from '../src/services/execution-snapshot';
import { handleSSEEvent, resetSSEState } from '../src/hooks/use-sse';
import { selectMoment } from '../src/services/cockpit-moment';
import type { ExecutionSnapshot } from '../src/types';
const old: ExecutionSnapshot = {
  plan: { id: 'old', convId: 'c1', status: 'completed', summary: 'OLD receipt', steps: [{ id: 'step_1', tool: 'github.create_issue', description: 'OLD write', args: { repo: 'ati/test', title: 'Old issue' } }] },
  execution: { status: 'completed' }, steps: [{ stepId: 'step_1', tool: 'github.create_issue', status: 'succeeded', output: { url: 'https://github.com/ati/test/issues/42' } }], recoveryActions: [],
};
beforeEach(() => { useChatStore.getState().reset(); resetSSEState(); useChatStore.getState().setConversationId('c1'); useChatStore.getState().setExecutionSnapshot(old); });
afterEach(() => { vi.restoreAllMocks(); useChatStore.getState().reset(); });
function deferRead() {
  let finish!: (snapshot: ExecutionSnapshot) => void;
  vi.spyOn(apiClient, 'getLatestExecutionSnapshot').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  return { pending: refreshExecutionSnapshot('c1'), finish: (snapshot = old) => finish(snapshot) };
}
it('a pre-dispatch delayed old snapshot cannot restore the retired owner', async () => {
  const read = deferRead(); useChatStore.getState().beginPlanning('c1', 'new'); read.finish(); await read.pending;
  expect(selectMoment(useChatStore.getState(), useChatStore.getState().executionSnapshot)).toBe(2);
  expect(useChatStore.getState().activePlan).toBeNull();
});
it.each(['clarification', 'error'])('a reconnect snapshot read begun during new planning cannot overtake its terminal %s', async event => {
  useChatStore.getState().beginPlanning('c1', 'new'); const read = deferRead();
  handleSSEEvent(event, JSON.stringify({ requestId: 'new', question: 'NEW clarification', message: 'NEW planning error' }), undefined, 'c1');
  const expected = event === 'clarification' ? 3 : 1;
  expect(selectMoment(useChatStore.getState(), useChatStore.getState().executionSnapshot)).toBe(expected);
  read.finish(); await read.pending;
  expect(selectMoment(useChatStore.getState(), useChatStore.getState().executionSnapshot)).toBe(expected);
  expect(useChatStore.getState().activePlan).toBeNull();
});
it.each(['clarification','error'])('a reconnect read begun after current %s settled cannot reacquire the retired safe plan',async event=>{
  useChatStore.getState().beginPlanning('c1','new');
  handleSSEEvent(event,JSON.stringify({requestId:'new',question:'Current question',message:'Current error'}),undefined,'c1');
  expect(useChatStore.getState().isPlanning).toBe(false);
  const read=deferRead(); read.finish(); await read.pending;
  expect(selectMoment(useChatStore.getState(),useChatStore.getState().executionSnapshot)).toBe(event==='clarification'?3:1);
  expect(useChatStore.getState().activePlan).toBeNull();
  expect(useChatStore.getState().executionSnapshot?.plan.id).toBe('old');
});
it('a delayed old snapshot cannot overtake the new SSE preview with reused step IDs', async () => {
  useChatStore.getState().beginPlanning('c1', 'new'); const read = deferRead();
  handleSSEEvent('plan_preview', JSON.stringify({ requestId: 'new', planId: 'new-plan', summary: 'NEW preview', steps: [{ id: 'step_1', tool: 'slack.send_message', description: 'NEW write', args: { channel: '#general', text: 'New message' } }] }), undefined, 'c1');
  read.finish(); await read.pending;
  expect(useChatStore.getState().activePlan?.id).toBe('new-plan'); expect(useChatStore.getState().planStatus).toBe('preview');
});
it.each(['unknown', 'failed'])('retiring safe owners preserves saved %s evidence even with a new preview', status => {
  useChatStore.getState().setExecutionSnapshot({ ...old, execution: { status: 'partial' }, steps: [{ ...old.steps[0], status: status as 'unknown' | 'failed' }] });
  useChatStore.getState().setActivePlan({ id: 'new-plan', summary: 'NEW preview', steps: [] }); useChatStore.getState().setPlanStatus('preview');
  useChatStore.getState().beginPlanning('c1', 'new');
  expect(selectMoment(useChatStore.getState(), useChatStore.getState().executionSnapshot)).toBe(status === 'unknown' ? 8 : 7);
  expect(useChatStore.getState().activePlan?.id).toBe('new-plan'); expect(useChatStore.getState().executionSnapshot?.plan.id).toBe('old');
});
it('beginPlanning for a background conversation does not retire the selected safe owner', () => {
  useChatStore.getState().beginPlanning('c2', 'background');
  expect(useChatStore.getState().activePlan?.id).toBe('old'); expect(useChatStore.getState().isPlanning).toBe(false);
  expect(useChatStore.getState().planningByConversation.c2?.requestId).toBe('background');
});
it('settling a background request does not invalidate the selected conversation read owner',()=>{
  const store=useChatStore.getState(); store.beginPlanning('c2','background');
  const before=useChatStore.getState().executionRevision;
  handleSSEEvent('error',JSON.stringify({requestId:'background',message:'Background error'}),undefined,'c2');
  expect(useChatStore.getState().executionRevision).toBe(before);
  expect(useChatStore.getState().activePlan?.id).toBe('old');
  expect(useChatStore.getState().planningByConversation.c2).toBeUndefined();
});
it('a stale terminal request cannot invalidate or settle the current planning owner',()=>{
  useChatStore.getState().beginPlanning('c1','new');
  const before=useChatStore.getState().executionRevision;
  handleSSEEvent('clarification',JSON.stringify({requestId:'stale',question:'Stale question'}),undefined,'c1');
  expect(useChatStore.getState().executionRevision).toBe(before);
  expect(useChatStore.getState().isPlanning).toBe(true);
  expect(useChatStore.getState().activeClarification).toBeNull();
});
it('settling new planning retains already saved reconciliation evidence',()=>{
  useChatStore.getState().setExecutionSnapshot({...old,execution:{status:'reconciliation_required'},recoveryActions:['stop']});
  useChatStore.getState().beginPlanning('c1','new');
  handleSSEEvent('error',JSON.stringify({requestId:'new',message:'New planning error'}),undefined,'c1');
  expect(selectMoment(useChatStore.getState(),useChatStore.getState().executionSnapshot)).toBe(9);
  expect(useChatStore.getState().executionSnapshot?.plan.id).toBe('old');
});
it.each(['unknown','failed','reconciliation_required'] as const)('a fresh read of retired history still admits authoritative %s evidence',async status=>{
  useChatStore.getState().beginPlanning('c1','new');
  handleSSEEvent('clarification',JSON.stringify({requestId:'new',question:'Current question'}),undefined,'c1');
  const read=deferRead();
  read.finish({...old,execution:{status:status==='reconciliation_required'?status:'partial'},steps:status==='reconciliation_required'?old.steps:[{...old.steps[0],status}]}); await read.pending;
  expect(selectMoment(useChatStore.getState(),useChatStore.getState().executionSnapshot)).toBe(status==='unknown'?8:status==='failed'?7:9);
});
it('resetting selection clears retired-plan ownership for the next conversation',()=>{
  useChatStore.getState().beginPlanning('c1','new');
  expect(useChatStore.getState().retiredExecutionPlanId).toBe('old');
  useChatStore.getState().reset(); useChatStore.getState().setConversationId('c2');
  expect(useChatStore.getState().retiredExecutionPlanId).toBeNull();
});
