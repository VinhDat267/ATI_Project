import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ScheduleView } from '@wap/tool-schemas';
import { apiClient } from '../../services/api-client';
import { schedulesChanged } from '../../hooks/use-schedules';
import { useDialogFocus } from './useDialogFocus';
import { runConversation } from '../../services/schedule-run';

export const scheduleButton =
  'inline-flex items-center justify-center px-4 py-2 rounded-xl border border-[var(--planora-divider)] bg-[var(--planora-paper)] text-sm font-semibold text-[var(--planora-text)] hover:bg-[var(--planora-surface-inset)] disabled:opacity-50 disabled:cursor-wait transition-colors cursor-pointer';

export const primaryScheduleButton =
  'inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[var(--planora-primary)] text-[var(--planora-on-primary)] text-sm font-semibold hover:bg-[var(--planora-primary-hover)] disabled:opacity-50 disabled:cursor-wait transition-colors cursor-pointer';

function CancelDialog({
  name,
  busy,
  onClose,
  onConfirm,
}: {
  name: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose, '');
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cancel-schedule-title"
        tabIndex={-1}
        className="w-full max-w-md min-w-0 rounded-3xl bg-[var(--planora-paper)] border border-[var(--planora-divider)] p-6 text-[var(--planora-text)] shadow-2xl"
      >
        <h2 id="cancel-schedule-title" className="font-serif text-xl font-bold [overflow-wrap:anywhere]">
          Hủy lịch "{name}"?
        </h2>
        <p className="text-sm text-[var(--planora-muted)] mt-3">Lịch đã hủy không bật lại được.</p>
        <div className="flex flex-wrap gap-2 mt-5">
          <button type="button" className={scheduleButton} onClick={onClose} disabled={busy}>
            Giữ lịch
          </button>
          <button type="button" disabled={busy} className={primaryScheduleButton} onClick={onConfirm}>
            Xác nhận hủy lịch
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ScheduleActions({
  schedule,
  navigate,
  onChanged,
  onConflict,
}: {
  schedule: ScheduleView;
  navigate: (path: string) => void;
  onChanged: (schedule: ScheduleView) => void;
  onConflict: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => () => operation.current?.abort(), []);

  const action = async (kind: 'pause' | 'resume' | 'cancel' | 'run-now') => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      if (kind === 'run-now') {
        const { run } = await apiClient.runScheduleNow(schedule.id);
        const convId = await runConversation(run, controller.signal);
        schedulesChanged();
        navigate(`/c/${encodeURIComponent(convId)}`);
      } else {
        const result = await apiClient.changeSchedule(schedule.id, kind, schedule.version);
        if (!controller.signal.aborted) {
          onChanged(result.schedule);
          schedulesChanged();
          setCancel(false);
        }
      }
    } catch (reason: any) {
      if (controller.signal.aborted) return;
      setCancel(false);
      setError(reason.message || 'Không thể cập nhật lịch.');
      if (reason.status === 409) await onConflict().catch(() => {});
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const closed = schedule.status === 'cancelled' || schedule.status === 'completed';

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {!closed && (
          <>
            <button
              type="button"
              className={scheduleButton}
              disabled={busy}
              onClick={() => void action(schedule.status === 'paused' ? 'resume' : 'pause')}
            >
              {schedule.status === 'paused' ? 'Chạy tiếp' : 'Tạm dừng'}
            </button>
            <button type="button" className={scheduleButton} disabled={busy} onClick={() => void action('run-now')}>
              Chạy lượt này ngay
            </button>
            <button type="button" className={scheduleButton} disabled={busy} onClick={() => setCancel(true)}>
              Hủy lịch
            </button>
          </>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-[var(--planora-error-text)] mt-3">{error}</p>}
      {cancel && (
        <CancelDialog
          name={schedule.name}
          busy={busy}
          onClose={() => setCancel(false)}
          onConfirm={() => void action('cancel')}
        />
      )}
    </>
  );
}
