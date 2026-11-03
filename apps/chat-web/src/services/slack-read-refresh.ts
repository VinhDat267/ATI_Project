import { apiClient } from './api-client';
import { slackSessionOwner } from './slack-connection';
import { normalizeConversationMessages } from './conversation-messages';
import { captureConversationRead, invalidateConversationReads } from './conversation-read-guard';
import { useChatStore } from '../store/chat-store';

interface PendingRead { promise: Promise<void>; current: () => boolean; controller: AbortController }
const pending = new Map<string, PendingRead>();
/** Coalesce polling, expire stalled reads, and drop cached payloads immediately on invalidation. */
export function refreshSlackConversation(convId: string, clear = false, timeoutMs = 8000): Promise<void> {
  if (useChatStore.getState().conversationId !== convId) return Promise.resolve();
  const previous = pending.get(convId);
  if (!clear && previous?.current()) return previous.promise;
  invalidateConversationReads(convId);
  previous?.controller.abort();
  const owns = slackSessionOwner();
  if (clear) clearCachedSource(convId);
  const ownsRead = captureConversationRead(convId);
  const before = useChatStore.getState();
  const current = () => owns() && ownsRead() && useChatStore.getState().conversationId === convId &&
    useChatStore.getState().executionRevision === before.executionRevision && useChatStore.getState().planRevision === before.planRevision &&
    useChatStore.getState().messages === before.messages;
  const controller = new AbortController();
  const entry: PendingRead = { current, controller, promise: Promise.resolve() };
  entry.promise = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const expired = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('SLACK_RELOAD_EXPIRED'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(timeoutMs, 8000)));
      });
      const [conversation, plan, snapshot] = await Promise.race([
        Promise.all([apiClient.getConversation(convId, controller.signal), apiClient.getActivePlan(convId, controller.signal), apiClient.getLatestExecutionSnapshot(convId, controller.signal)]), expired,
      ]);
      if (!current()) return;
      const state = useChatStore.getState();
      useChatStore.setState(value => ({ messages: normalizeConversationMessages(conversation.messages || []),
        conversations: value.conversations.map(row => row.id === convId ? { ...row, ...conversation.conversation } : row) }));
      state.setActivePlan(plan);
      state.setPlanStatus(plan ? (!plan.status || plan.status === 'pending' ? 'preview' : plan.status === 'approved' ? 'executing' : plan.status) : 'idle');
      state.setExecutionSnapshot(snapshot);
      state.setExecutionLoadError(null);
    } catch {
      if (current()) {
        clearCachedSource(convId);
        useChatStore.getState().setExecutionLoadError('Không xác nhận được quyền đọc Slack. Hãy tải lại hội thoại.');
      }
    } finally {
      clearTimeout(timer);
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      controller.abort();
      if (pending.get(convId) === entry) pending.delete(convId);
    }
  })();
  pending.set(convId, entry);
  return entry.promise;
}
function clearCachedSource(convId: string): void {
  invalidateConversationReads(convId);
  const state = useChatStore.getState();
  state.setExecutionSnapshot(null); state.setActivePlan(null); state.setPlanStatus('idle');
  useChatStore.setState(current => ({ messages: [], activeClarification: null, streamingText: '', isStreaming: false, gatherState: null,
    conversations: current.conversations.map(row => row.id === convId ? { ...row, title: 'Cuộc hội thoại' } : row) }));
}
