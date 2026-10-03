import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../store/chat-store';
import { apiClient } from '../services/api-client';
import { refreshExecutionSnapshot } from '../services/execution-snapshot';
import { userErrorMessage } from '../services/user-error';

export function useExecutionRecovery() {
  const { conversationId, activePlan, executionSnapshot, stepStatuses } = useChatStore();
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const pending = useRef(false);
  useEffect(() => { setRecoveryError(null); }, [conversationId, executionSnapshot?.plan.id]);
  const recover = async (action: 'retry' | 'skip' | 'stop' | 'continue', stepId?: string) => {
    const planId = executionSnapshot?.plan.id || activePlan?.id;
    const convId = conversationId;
    if (!planId || !convId || pending.current) return;
    if (executionSnapshot && !executionSnapshot.recoveryActions.includes(action)) return;
    if (action === 'retry' && stepId && stepStatuses[stepId] === 'unknown') return;
    pending.current = true; setRecoveryBusy(true); setRecoveryError(null);
    try {
      if (action === 'stop') await apiClient.stopExecution(planId);
      else if (action === 'continue') await apiClient.continueExecution(planId);
      else if (stepId) {
        if (action === 'retry') await apiClient.retryStep(planId, stepId);
        else await apiClient.skipStep(planId, stepId);
      }
      if (useChatStore.getState().conversationId === convId) await refreshExecutionSnapshot(convId, planId);
    } catch (reason) {
      if (useChatStore.getState().conversationId === convId) setRecoveryError(userErrorMessage(reason, 'Không thể cập nhật quy trình. Hãy tải lại trạng thái trước khi quyết định.'));
    } finally { pending.current = false; setRecoveryBusy(false); }
  };
  return { recover, recoveryBusy, recoveryError };
}
