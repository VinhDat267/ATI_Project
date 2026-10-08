import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../store/chat-store';
import { apiClient } from '../services/api-client';
import { refreshExecutionSnapshot } from '../services/execution-snapshot';
import { userErrorMessage } from '../services/user-error';

export function useExecutionRecovery() {
  const { conversationId, activePlan, executionSnapshot, stepStatuses } = useChatStore();
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const pending = useRef<symbol | null>(null);
  const owner = `${conversationId}:${executionSnapshot?.plan.id}:${activePlan?.id}`;
  const context = useRef({ owner, generation: 0 });
  if (context.current.owner !== owner) { context.current = { owner, generation: context.current.generation + 1 }; }
  useEffect(() => { setRecoveryError(null); }, [conversationId, executionSnapshot?.plan.id]);
  const recover = async (action: 'retry' | 'skip' | 'stop' | 'continue', stepId?: string): Promise<boolean> => {
    const planId = executionSnapshot?.plan.id || activePlan?.id;
    const convId = conversationId;
    if (!planId || !convId || pending.current) return false;
    if (!executionSnapshot || !executionSnapshot.recoveryActions.includes(action)) return false;
    const unknown = executionSnapshot.steps.some(step => step.status === 'unknown') || Object.values(stepStatuses).includes('unknown');
    if (unknown && (action === 'retry' || action === 'continue')) return false;
    if (['retry','skip'].includes(action) && (!stepId || stepId !== executionSnapshot.execution.pausedStepId)) return false;
    const generation = context.current.generation;
    const revision = useChatStore.getState().executionRevision;
    const planRevision = useChatStore.getState().planRevision;
    const owns = () => context.current.generation === generation && useChatStore.getState().conversationId === convId && useChatStore.getState().planRevision === planRevision;
    const token = Symbol(); pending.current = token; setRecoveryBusy(true); setRecoveryError(null);
    try {
      if (action === 'stop') await apiClient.stopExecution(planId);
      else if (action === 'continue') await apiClient.continueExecution(planId);
      else if (stepId) {
        if (action === 'retry') await apiClient.retryStep(planId, stepId);
        else await apiClient.skipStep(planId, stepId);
      }
      const currentSnapshot=useChatStore.getState().executionSnapshot;
      const ownStopped=action==='stop' && currentSnapshot?.plan.id===planId && currentSnapshot.execution.status==='stopped';
      if (!owns() || (useChatStore.getState().executionRevision !== revision && !ownStopped)) return false;
      await refreshExecutionSnapshot(convId, planId);
      return owns() && useChatStore.getState().executionSnapshot?.plan.id === planId && !useChatStore.getState().executionLoadError;
    } catch (reason) {
      if (owns()) setRecoveryError(userErrorMessage(reason, 'Không thể cập nhật quy trình. Hãy tải lại trạng thái trước khi quyết định.'));
      return false;
    } finally { if (pending.current === token) { pending.current = null; setRecoveryBusy(false); } }
  };
  return { recover, recoveryBusy, recoveryError };
}
