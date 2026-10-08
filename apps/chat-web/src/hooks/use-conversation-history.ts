import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/api-client';
import { refreshExecutionSnapshot } from '../services/execution-snapshot';
import { userErrorMessage } from '../services/user-error';
import { useChatStore } from '../store/chat-store';

export async function loadConversationHistory(id: string, isCurrent: () => boolean) {
  const store = useChatStore.getState();
  const data = await apiClient.getConversation(id);
  if (!isCurrent()) return;
  const hydrateResponse = useChatStore.getState().messages === store.messages &&
    useChatStore.getState().planRevision === store.planRevision;
  const pending = useChatStore.getState().planningByConversation[id];
  if (pending) {
    const acceptedId = pending.messageId ?? data.messages?.find(message => message.role === 'user' &&
      pending.requestId && message.metadata?.requestId === pending.requestId)?.id;
    if (acceptedId && data.messages?.some(message =>
      ['plan', 'clarification', 'refusal', 'planning_error'].includes(message.metadata?.type ?? '') &&
      message.metadata?.replyToMessageId === acceptedId)) store.setIsPlanning(false, id, pending.requestId);
  }
  for (const message of data.messages || []) {
    if (message.metadata?.type === 'working_memory' && !message.content) continue;
    store.addMessage({ ...message, role: message.role || 'user', content: message.content || '', timestamp: message.created_at || message.timestamp });
  }
  const latest = data.messages?.filter(message => message.metadata?.type !== 'working_memory').at(-1);
  if (hydrateResponse && !useChatStore.getState().isPlanning) {
    const refusal = latest?.metadata?.type === 'refusal' || latest?.content.startsWith('Từ chối yêu cầu:');
    if (refusal || ['clarification', 'planning_error'].includes(latest?.metadata?.type ?? '')) {
      // A snapshot started by SSE onopen may arrive before history. Restore the
      // latest response's owner too; the saved snapshot still governs unsafe work.
      store.setActivePlan(null); store.setPlanStatus(refusal ? 'rejected' : 'idle');
      store.setClarification(null);
    }
    if (latest?.metadata?.type === 'clarification') {
      store.setClarification({ question: latest.content, options: Array.isArray(latest.metadata.options) ? latest.metadata.options.filter(option => typeof option === 'string' && option.trim()) : [], context: typeof latest.metadata.context === 'string' ? latest.metadata.context : undefined });
    }
  }
  try {
    const revision = useChatStore.getState().planRevision;
    const activePlan = await apiClient.getActivePlan(id);
    if (!isCurrent()) return;
    const current = useChatStore.getState();
    const alreadyExecuted = activePlan?.id && (current.executionSnapshot?.plan.id === activePlan.id ||
      (current.activePlan?.id === activePlan.id && ['executing', 'partial', 'reconciliation_required', 'completed', 'stopped', 'failed'].includes(current.planStatus)));
    if (activePlan && current.planRevision === revision && !alreadyExecuted && !current.isPlanning) {
      store.setActivePlan(activePlan);
      const status = activePlan.status;
      store.setPlanStatus(!status || status === 'pending' ? 'preview' : status === 'approved' ? 'executing' : status);
    }
  } catch { /* A missing pending plan still permits loading durable execution evidence. */ }
  if (isCurrent()) {
    try { await refreshExecutionSnapshot(id); }
    catch { /* Optional snapshot errors use the helper's error state/revision guards; keep loaded detail and preview. */ }
  }
}

export function useConversationHistory(id: string | null) {
  const previousRoute = useRef<string | null>(null);
  const loadingId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let current = true;
    setError(null);
    const store = useChatStore.getState();
    if (!id) {
      if (previousRoute.current) store.reset({ preservePlanning: true });
      previousRoute.current = null; setLoading(false);
      return;
    }
    previousRoute.current = id;
    // Conversations created in this session are already initialized, including optimistic messages.
    if (store.conversationId === id && loadingId.current !== id) { setLoading(false); return; }
    loadingId.current = id;
    if (store.conversationId !== id) { store.reset({ preservePlanning: true }); store.setConversationId(id); }
    setLoading(true);
    const isCurrent = () => current && useChatStore.getState().conversationId === id;
    void loadConversationHistory(id, isCurrent).catch(reason => {
      if (!isCurrent()) return;
      store.reset({ preservePlanning: true });
      setError(reason?.status === 404 ? 'Không tìm thấy hội thoại.' : userErrorMessage(reason));
    }).finally(() => { if (current) { loadingId.current = null; setLoading(false); } });
    return () => { current = false; };
  }, [id]);
  return { error, loading };
}
