import type { ChatStoreState } from '../store/chat-store';
import type { ExecutionSnapshot } from '../types';
export type CockpitMoment = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 'refusal' | 'unsuccessful';
export type MomentState = Pick<ChatStoreState, 'planStatus' | 'stepStatuses' | 'activeClarification' | 'messages' | 'isPlanning'>;
/** Ordered by the approved section 5 table; persisted and live failures both matter. */
export function selectMoment(state: MomentState, snapshot: ExecutionSnapshot | null): CockpitMoment {
  const latest = state.messages.at(-1);
  const refusal = latest?.metadata?.type === 'refusal' || latest?.content.startsWith('Từ chối yêu cầu:');
  const unsafeSaved = snapshot && !['stopped','failed','rejected'].includes(snapshot.execution.status) && (snapshot.execution.status==='reconciliation_required' || snapshot.steps.some(step=>step.status==='unknown' || step.status==='failed'));
  if (!unsafeSaved && state.planStatus === 'rejected' && refusal) return 'refusal';
  if (!unsafeSaved && ['stopped','rejected','failed'].includes(state.planStatus)) return state.isPlanning ? 2 : 'unsuccessful';
  // Durable reads mark uncertainty as reconciliation_required even without a restart.
  // The saved plan is still partial in that case; startup reconciliation changes it.
  if (snapshot?.plan.status === 'partial' && snapshot.steps.some(step=>step.status==='unknown')) return 8;
  if (snapshot?.execution.status === 'reconciliation_required' || state.planStatus === 'reconciliation_required') return 9;
  if (state.isPlanning && snapshot?.execution.status === 'stopped') return 2;
  const oldTerminal = snapshot && ['completed','stopped','failed','rejected'].includes(snapshot.execution.status);
  const statuses = [...(['preview','approving'].includes(state.planStatus) && oldTerminal ? [] : Object.values(state.stepStatuses)), ...(!snapshot || ['stopped','failed','rejected'].includes(snapshot.execution.status) || (['preview','approving'].includes(state.planStatus) && oldTerminal) ? [] : snapshot.steps.map(step => step.status))];
  if (statuses.includes('unknown')) return 8;
  if (statuses.includes('failed')) return 7;
  const status = state.planStatus;
  if (status === 'completed') return 6;
  if (status === 'approving' || status === 'executing') return 5;
  if (status === 'preview') return 4;
  if (state.activeClarification) return 3;
  if (latest?.metadata?.type === 'refusal' || latest?.content.startsWith('Từ chối yêu cầu:')) return 'refusal';
  if (state.isPlanning) return 2;
  if (['stopped', 'rejected', 'failed'].includes(status)) return 'unsuccessful';
  return 1;
}
