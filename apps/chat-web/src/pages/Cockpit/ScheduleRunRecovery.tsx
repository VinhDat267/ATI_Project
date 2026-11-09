import { useEffect, useRef, useState } from 'react';
import type { ScheduleRunView, ScheduleView } from '@wap/tool-schemas';
import type { ChatMessage } from '../../types';
import { apiClient } from '../../services/api-client';
import { primaryScheduleButton, scheduleButton } from './ScheduleActions';
import { schedulesChanged } from '../../hooks/use-schedules';
import { formatRunTime, runLabel } from '../../services/schedule-text';
import { runConversation } from '../../services/schedule-run';
import { useChatStore } from '../../store/chat-store';
import { loadConversationHistory } from '../../hooks/use-conversation-history';

export function getEffectiveDeliveryResolution(
  run: ScheduleRunView | null | undefined
): 'confirmed_sent' | 'retried_new_run' | null {
  if (!run) return null;
  if (run.deliveryResolution === 'confirmed_sent' || run.deliveryResolution === 'retried_new_run') {
    return run.deliveryResolution;
  }
  if (
    run.delivery &&
    typeof run.delivery === 'object' &&
    'manualResolution' in run.delivery &&
    run.delivery.manualResolution?.status === 'confirmed_sent'
  ) {
    return 'confirmed_sent';
  }
  return null;
}

export function isUncertainSheetsDeliveryRun(
  run: ScheduleRunView | null | undefined
): boolean {
  if (!run) return false;
  return (
    run.state === 'needs_attention' &&
    getEffectiveDeliveryResolution(run) == null &&
    Boolean(run.deliveryStartedAt) &&
    typeof run.error === 'string' &&
    run.error.includes('SHEETS_DELIVERY_UNKNOWN')
  );
}

export function SheetsDeliveryRecoveryControl({
  run,
  onResolved,
}: {
  run: ScheduleRunView;
  isSheetsSchedule?: boolean;
  onResolved: (res: {
    run: ScheduleRunView;
    followUpRun: ScheduleRunView | null;
    schedule: ScheduleView;
  }) => void;
}) {
  const [confirmDuplicateRisk, setConfirmDuplicateRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const locked = useRef(false);

  useEffect(() => {
    setConfirmDuplicateRisk(false);
    setResolveError('');
  }, [run.id, run.deliveryResolution]);

  const resolution = getEffectiveDeliveryResolution(run);
  if (resolution) {
    const resolvedAtRaw =
      run.deliveryResolvedAt ??
      (run.delivery && typeof run.delivery === 'object' && 'manualResolution' in run.delivery
        ? run.delivery.manualResolution?.resolvedAt
        : null);
    return (
      <div
        data-testid="delivery-resolution-badge"
        data-resolution={resolution}
        data-followup-run-id={run.deliveryFollowupRunId ?? undefined}
        data-resolved-at={resolvedAtRaw ?? undefined}
        className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 v3-space-y-1"
      >
        <p className="font-semibold">
          {resolution === 'confirmed_sent'
            ? 'Đã xác nhận thủ công là đã gửi'
            : 'Đã tạo lượt gửi bù mới'}
        </p>
        {resolution === 'retried_new_run' && run.deliveryFollowupRunId && (
          <p>Mã lượt chạy bù: {run.deliveryFollowupRunId}</p>
        )}
        {resolvedAtRaw && <p className="text-emerald-800">Lúc: {formatRunTime(resolvedAtRaw)}</p>}
      </div>
    );
  }

  if (!isUncertainSheetsDeliveryRun(run)) return null;

  const handleResolve = async (mode: 'mark_sent' | 'retry_new_run') => {
    if (locked.current) return;
    if (mode === 'retry_new_run' && !confirmDuplicateRisk) return;
    locked.current = true;
    setBusy(true);
    setResolveError('');
    try {
      const res = await apiClient.resolveScheduleRunDelivery(
        run.id,
        mode === 'retry_new_run'
          ? { resolution: 'retry_new_run', confirmDuplicateRisk: true }
          : { resolution: 'mark_sent' }
      );
      onResolved(res);
    } catch (err: any) {
      setResolveError(err?.message || 'Không thể xử lý trạng thái gửi của lượt chạy.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="sheets-delivery-recovery-panel"
      className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-[#111827] v3-space-y-3"
    >
      <p className="text-amber-950 font-medium">
        Trạng thái gửi báo cáo chưa xác định. Hệ thống đã khóa tự động thử lại để tránh gửi trùng báo cáo tới kênh đích.
      </p>
      <div className="v3-space-y-1.5">
        <button
          type="button"
          data-testid="btn-resolve-mark-sent"
          disabled={busy}
          className={scheduleButton}
          onClick={() => void handleResolve('mark_sent')}
        >
          Xác nhận đã nhận báo cáo
        </button>
        <p className="text-[#4B5563]">Xác nhận báo cáo đã tới kênh đích (không gửi lại).</p>
      </div>
      <div className="pt-2 border-t border-amber-200/80 v3-space-y-2">
        <label className="flex items-start gap-2 cursor-pointer text-[#111827]">
          <input
            type="checkbox"
            data-testid="checkbox-confirm-duplicate-risk"
            checked={confirmDuplicateRisk}
            disabled={busy}
            onChange={e => setConfirmDuplicateRisk(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Tôi đã kiểm tra kênh đích và chấp nhận rủi ro gửi trùng nếu báo cáo trước đó thực tế đã tới đích.
          </span>
        </label>
        <div className="v3-space-y-1">
          <button
            type="button"
            data-testid="btn-resolve-retry-new-run"
            disabled={busy || !confirmDuplicateRisk}
            className={primaryScheduleButton}
            onClick={() => void handleResolve('retry_new_run')}
          >
            Tạo lượt gửi bù mới
          </button>
          <p className="text-[#4B5563]">Tạo một lượt chạy mới độc lập để gửi bù báo cáo.</p>
        </div>
      </div>
      {resolveError && (
        <p role="alert" className="text-sm text-red-700">
          {resolveError}
        </p>
      )}
    </div>
  );
}

export function ScheduleRunRecovery({ message, navigate }: { message: ChatMessage; navigate: (path: string) => void }) {
  const [run, setRun] = useState<ScheduleRunView | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const resolvedRunRef = useRef<ScheduleRunView | null>(null);
  const locked = useRef(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    resolvedRunRef.current = null;
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
        const fetched = data.runs.find(row => row.id === message.metadata?.runId) ?? null;
        const value =
          fetched &&
          resolvedRunRef.current?.id === fetched.id &&
          !getEffectiveDeliveryResolution(fetched)
            ? resolvedRunRef.current
            : fetched;
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
  const canReplan = Boolean(
    run &&
      ['expired', 'planning_failed', 'interrupted', 'digest_failed'].includes(run.state) &&
      !getEffectiveDeliveryResolution(run) &&
      !(typeof run.error === 'string' && run.error.includes('SHEETS_DELIVERY_UNKNOWN'))
  );
  return <div className="mb-5 v3-space-y-2">{run && ['digest_sent', 'needs_attention'].includes(run.state) && <p role="status" className="text-sm font-medium text-[#111827]">{runLabel(run)}</p>}{run && <SheetsDeliveryRecoveryControl run={run} onResolved={res => { resolvedRunRef.current = res.run; setRun(res.run); schedulesChanged(); }} />}{canReplan && run && <><p className="text-sm text-[#6B7280]">{runLabel(run)}</p><button type="button" className={primaryScheduleButton} disabled={busy} onClick={() => void replan()}>Lập lại kế hoạch</button></>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div>;
}
