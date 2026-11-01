import { useEffect, useRef, useState } from 'react';
import type { ScheduleRunView } from '@wap/tool-schemas';
import type { ChatMessage } from '../../types';
import { apiClient } from '../../services/api-client';
import { primaryScheduleButton } from './ScheduleActions';
import { schedulesChanged } from '../../hooks/use-schedules';
import { runLabel } from '../../services/schedule-text';
import { runConversation } from '../../services/schedule-run';
import { useChatStore } from '../../store/chat-store';
import { loadConversationHistory } from '../../hooks/use-conversation-history';

export function ScheduleRunRecovery({ message, navigate }: { message: ChatMessage; navigate: (path: string) => void }) {
  const [run, setRun] = useState<ScheduleRunView | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    let current = true;
    const convId = useChatStore.getState().conversationId;
    const owns = () => current && useChatStore.getState().conversationId === convId;
    const store = useChatStore.getState();
    if (store.messages.at(-1)?.id === message.id) { store.setIsPlanning(true, convId); if (convId) store.confirmPlanningRequest(convId, undefined, message.id); }
    let inFlight = false, lastRead = 0, lastState: string | undefined;
    const refresh = async () => {
      if (!message.metadata?.scheduleId || inFlight || !owns()) return;
      inFlight = true;
      try {
        const data = await apiClient.getScheduleRuns(message.metadata.scheduleId, 50);
        if (!owns()) return;
        const value = data.runs.find(row => row.id === message.metadata?.runId) ?? null;
        const changed = value?.state !== lastState; lastState = value?.state; lastRead = Date.now();
        setRun(value); setError('');
        const state = useChatStore.getState();
        if (value && value.state !== 'planning' && convId && (state.messages.at(-1)?.id === message.id || state.planningByConversation[convId]?.messageId === message.id)) {
          state.setIsPlanning(false, convId);
          await loadConversationHistory(convId, owns, useChatStore.getState());
        }
        if (owns() && changed) schedulesChanged();
      } catch { if (owns()) setError('Không tải được trạng thái lượt chạy.'); }
      finally { inFlight = false; }
    };
    void refresh(); const heartbeat = () => { if (!lastState || lastState === 'planning' || Date.now() - lastRead >= 30_000) void refresh(); };
    const timer = window.setInterval(heartbeat, 1000); window.addEventListener('focus', refresh); window.addEventListener('schedules:changed', refresh);
    return () => { current = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('schedules:changed', refresh); };
  }, [message.id, message.metadata?.scheduleId, message.metadata?.runId]);
  const replan = async () => {
    if (!run || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    const controller = new AbortController(); operation.current = controller;
    try { const result = await apiClient.replanScheduleRun(run.id); const convId = await runConversation(result.run, controller.signal); schedulesChanged(); navigate(`/c/${encodeURIComponent(convId)}`); }
    catch (reason: any) { if (!controller.signal.aborted) setError(reason.message || 'Không thể lập lại kế hoạch.'); }
    finally { locked.current = false; setBusy(false); }
  };
  return <div className="mb-5 v3-space-y-2">{run && ['expired', 'planning_failed', 'interrupted', 'digest_failed'].includes(run.state) && <><p className="text-sm text-[#6B7280]">{runLabel(run)}</p><button type="button" className={primaryScheduleButton} disabled={busy} onClick={() => void replan()}>Lập lại kế hoạch</button></>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div>;
}
