import type { ChatStoreState } from '../store/chat-store';
import type { ExecutionSnapshot } from '../types';
export type CockpitMoment = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 'refusal' | 'unsuccessful';
export type MomentState = Pick<ChatStoreState, 'planStatus' | 'stepStatuses' | 'activeClarification' | 'messages' | 'isPlanning'>;
/** Ordered by the approved section 5 table; persisted and live failures both matter. */
export function selectMoment(state: MomentState, snapshot: ExecutionSnapshot | null): CockpitMoment {
  if (snapshot?.execution.status === 'reconciliation_required' || state.planStatus === 'reconciliation_required') return 9;
  const statuses = [...Object.values(state.stepStatuses), ...(snapshot?.steps.map(step => step.status) ?? [])];
  if (statuses.includes('unknown')) return 8;
  if (statuses.includes('failed')) return 7;
  const status = state.planStatus;
  if (status === 'completed') return 6;
  if (status === 'approving' || status === 'executing') return 5;
  if (status === 'preview') return 4;
  if (state.activeClarification) return 3;
  const latest = state.messages.at(-1);
  if (latest?.metadata?.type === 'refusal' || latest?.content.startsWith('Từ chối yêu cầu:')) return 'refusal';
  if (state.isPlanning) return 2;
  if (['stopped', 'rejected', 'failed'].includes(status)) return 'unsuccessful';
  return 1;
}
