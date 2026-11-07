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
  const [run, setRun] = useState<ScheduleRunView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => () => operation.current?.abort(), []);

  useEffect(() => {
    let current = true;
    const convId = useChatStore.getState().conversationId;
    const owns = () => current && useChatStore.getState().conversationId === convId;
    const store = useChatStore.getState();
    if (store.messages.at(-1)?.id === message.id) {
      store.setIsPlanning(true, convId);
      if (convId) store.confirmPlanningRequest(convId, undefined, message.id);
    }
    let inFlight = false;
    let lastRead = 0;
    let lastState: string | undefined;

    const refresh = async () => {
      if (!message.metadata?.scheduleId || inFlight || !owns()) return;
      inFlight = true;
      try {
        const data = await apiClient.getScheduleRuns(message.metadata.scheduleId, 50);
        if (!owns()) return;
        const value = data.runs.find(row => row.id === message.metadata?.runId) ?? null;
        const changed = value?.state !== lastState;
        lastState = value?.state;
        lastRead = Date.now();
        setRun(value);
        setError('');
        const state = useChatStore.getState();
        if (
          value &&
          value.state !== 'planning' &&
          convId &&
          (state.messages.at(-1)?.id === message.id || state.planningByConversation[convId]?.messageId === message.id)
        ) {
          state.setIsPlanning(false, convId);
          await loadConversationHistory(convId, owns, useChatStore.getState());
        }
        if (owns() && changed) schedulesChanged();
      } catch {
        if (owns()) setError('Không tải được trạng thái lượt chạy.');
      } finally {
        inFlight = false;
      }
    };

    void refresh();
    const heartbeat = () => {
      if (!lastState || lastState === 'planning' || Date.now() - lastRead >= 30_000) void refresh();
    };
    const timer = window.setInterval(heartbeat, 1000);
    window.addEventListener('focus', refresh);
    window.addEventListener('schedules:changed', refresh);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('schedules:changed', refresh);
    };
  }, [message.id, message.metadata?.scheduleId, message.metadata?.runId]);

  const replan = async () => {
    if (!run || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      const result = await apiClient.replanScheduleRun(run.id);
      const convId = await runConversation(result.run, controller.signal);
      schedulesChanged();
      navigate(`/c/${encodeURIComponent(convId)}`);
    } catch (reason: any) {
      if (!controller.signal.aborted) setError(reason.message || 'Không thể lập lại kế hoạch.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 v3-space-y-2">
      {run && run.state === 'digest_sent' && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-[var(--planora-success-bg)] text-[var(--planora-success-text)] border border-[var(--planora-success-border)] text-sm font-medium flex items-center gap-2"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
          <span>{runLabel(run)}</span>
        </div>
      )}

      {run && run.state === 'needs_attention' && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border border-[var(--planora-pending-border)] text-sm v3-space-y-1.5"
        >
          <div className="flex items-center gap-2 font-semibold">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{runLabel(run)}</span>
          </div>
          <p className="text-xs leading-relaxed opacity-90">
            Tình trạng gửi bản tin chưa được xác nhận. Vui lòng kiểm tra kênh hoặc nhóm đích trước khi thao tác tiếp; hệ thống không tự động gửi lại hoặc lập lại kế hoạch cho lượt này.
          </p>
        </div>
      )}

      {run && ['expired', 'planning_failed', 'interrupted', 'digest_failed'].includes(run.state) && (
        <div className="p-3.5 rounded-xl bg-[var(--planora-surface-inset)] text-[var(--planora-text)] border border-[var(--planora-divider)] text-sm v3-space-y-3">
          <div className="flex items-center gap-2 text-[var(--planora-muted)]">
            <svg className="w-4 h-4 flex-shrink-0 text-[var(--planora-error-text)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{runLabel(run)}</span>
          </div>
          <div>
            <button type="button" className={primaryScheduleButton} disabled={busy} onClick={() => void replan()}>
              Lập lại kế hoạch
            </button>
          </div>
        </div>
      )}

      {run && run.state === 'discarded' && (
        <div role="status" className="p-3.5 rounded-xl bg-[var(--planora-surface-inset)] text-[var(--planora-muted)] border border-[var(--planora-divider)] text-sm flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span>{runLabel(run)}</span>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-[var(--planora-error-text)]">{error}</p>}
    </div>
  );
}
