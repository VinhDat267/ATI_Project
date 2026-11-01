import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/api-client';
import { refreshExecutionSnapshot } from '../services/execution-snapshot';
import { userErrorMessage } from '../services/user-error';
import { useChatStore, type ChatStoreState } from '../store/chat-store';
import type { ChatMessage } from '../types';
import { normalizeConversationMessages } from '../services/conversation-messages';
import { captureConversationRead } from '../services/conversation-read-guard';

// SSE plan/answer ids can differ from the persisted message id. Correlation
// identifies the same response without moving replayed history behind new work.
const messageKey = (message: ChatMessage) => message.metadata?.type === 'plan' && message.metadata.planId
  ? `plan:${message.metadata.planId}`
  : message.metadata?.replyToMessageId ? `${message.metadata.type}:${message.metadata.replyToMessageId}` : message.id;

export async function loadConversationHistory(id: string, isCurrent: () => boolean, expected?: Pick<ChatStoreState, 'messages' | 'planRevision'>) {
  const ownsRead = captureConversationRead(id);
  const store = useChatStore.getState();
  const data = await apiClient.getConversation(id).catch(error => {
    if (!isCurrent() || !ownsRead()) return null;
    throw error;
  });
  if (!data) return;
  if (!isCurrent() || !ownsRead()) return;
  if (expected && (useChatStore.getState().messages !== expected.messages || useChatStore.getState().planRevision !== expected.planRevision)) return;
  const hydrateResponse = useChatStore.getState().messages === store.messages &&
    useChatStore.getState().planRevision === store.planRevision;
  const pending = useChatStore.getState().planningByConversation[id];
  if (pending) {
    const acceptedId = pending.messageId ?? data.messages?.find(message => message.role === 'user' &&
      pending.requestId && message.metadata?.requestId === pending.requestId)?.id;
    if (acceptedId && data.messages?.some(message =>
      ['plan', 'clarification', 'refusal', 'answer', 'planning_error', 'schedule_proposal', 'schedule_discarded'].includes(message.metadata?.type ?? '') &&
      message.metadata?.replyToMessageId === acceptedId)) store.setIsPlanning(false, id, pending.requestId);
  }
  const saved = normalizeConversationMessages(data.messages || []);
  const savedKeys = new Set(saved.map(messageKey));
  useChatStore.setState(current => ({ messages: [...saved, ...current.messages.filter(message => !savedKeys.has(messageKey(message)))] }));
  const latest = data.messages?.filter(message => message.metadata?.type !== 'working_memory').at(-1);
  if (hydrateResponse && !useChatStore.getState().isPlanning) {
    const refusal = latest?.metadata?.type === 'refusal' || latest?.content.startsWith('Từ chối yêu cầu:');
    if (refusal || ['clarification', 'answer', 'planning_error', 'schedule_proposal', 'schedule_state', 'schedule_discarded'].includes(latest?.metadata?.type ?? '')) {
      // A snapshot started by SSE onopen may arrive before history. Restore the
      // latest response's owner too; the saved snapshot still governs unsafe work.
      store.setActivePlan(null); store.setPlanStatus(refusal ? 'rejected' : 'idle');
      store.setClarification(null);
    }
    if (latest?.metadata?.type === 'clarification') {
      store.setClarification({ question: latest.content, options: Array.isArray(latest.metadata.options) ? latest.metadata.options.filter(option => typeof option === 'string' && option.trim()) : [], context: typeof latest.metadata.context === 'string' ? latest.metadata.context : undefined,
        reason: latest.metadata.reason === 'read_only' || latest.metadata.reason === 'destination' ? latest.metadata.reason : undefined });
    }
  }
  try {
    const revision = useChatStore.getState().planRevision;
    const activePlan = await apiClient.getActivePlan(id);
    if (!isCurrent() || !ownsRead()) return;
    const current = useChatStore.getState();
    const alreadyExecuted = activePlan?.id && (current.executionSnapshot?.plan.id === activePlan.id ||
      (current.activePlan?.id === activePlan.id && ['executing', 'partial', 'reconciliation_required', 'completed', 'stopped', 'failed'].includes(current.planStatus)));
    if (activePlan && !['answer', 'schedule_proposal', 'schedule_state', 'schedule_discarded'].includes(latest?.metadata?.type ?? '') && current.planRevision === revision && !alreadyExecuted && !current.isPlanning) {
      store.setActivePlan(activePlan);
      const status = activePlan.status;
      store.setPlanStatus(!status || status === 'pending' ? 'preview' : status === 'approved' ? 'executing' : status);
    }
  } catch { /* A missing pending plan still permits loading durable execution evidence. */ }
  if (isCurrent() && ownsRead()) {
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
