import { apiClient } from './api-client';
import { useChatStore } from '../store/chat-store';

let latestRequest = 0;

/** Read-only reconciliation. A late response must never overwrite newer SSE/selection state. */
export async function refreshExecutionSnapshot(convId: string, expectedPlanId?: string): Promise<void> {
  const requestId = ++latestRequest;
  const revision = useChatStore.getState().executionRevision;
  try {
    const snapshot = await apiClient.getLatestExecutionSnapshot(convId);
    const state = useChatStore.getState();
    if (state.conversationId !== convId || state.executionRevision !== revision || requestId !== latestRequest) return;
    if (expectedPlanId && snapshot?.plan.id !== expectedPlanId) return;
    state.setExecutionSnapshot(snapshot);
    state.setExecutionLoadError(null);
  } catch (error) {
    const state = useChatStore.getState();
    if (state.conversationId === convId && state.executionRevision === revision && requestId === latestRequest) {
      state.setExecutionLoadError(error instanceof Error ? error.message : 'Không tải được trạng thái thực thi.');
    }
    throw error;
  }
}
