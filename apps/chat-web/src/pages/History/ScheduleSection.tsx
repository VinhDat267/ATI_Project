import { useEffect, useState } from 'react';
import type { ScheduleRunView, ScheduleView } from '@wap/tool-schemas';
import type { User } from '../../types';
import { apiClient } from '../../services/api-client';
import { useSchedulesEnabled } from '../../hooks/use-schedules';
import { describeRecurrence, formatRunTime, runLabel, scheduleLabel } from '../../services/schedule-text';
import { getActiveWorkspaceId, subscribeWorkspace } from '../../services/workspace-storage';
import { ScheduleActions } from '../Cockpit/ScheduleActions';
import { WorkflowFlowCanvas } from '../../components/WorkflowFlowCanvas';

function RunLink({ run, navigate }: { run: ScheduleRunView; navigate: (path: string) => void }) {
  const sheetsDelivery = run.delivery && 'spreadsheetTitle' in run.delivery ? run.delivery : null;
  const githubDest =
    run.delivery && 'counts' in run.delivery
      ? run.delivery.telegramChatTitle || run.delivery.telegramChatId
        ? `Telegram: ${run.delivery.telegramChatTitle ?? run.delivery.telegramChatId}`
        : run.delivery.channelName
          ? `#${run.delivery.channelName.replace(/^#/, '')}`
          : null
      : null;

  return (
    <>
      <span>{formatRunTime(run.dueAt)} · </span>
      {run.convId ? (
        <a
          className="underline text-[var(--planora-primary)] hover:text-[var(--planora-primary-hover)] transition-colors cursor-pointer"
          href={`/c/${run.convId}`}
          onClick={event => {
            if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigate(`/c/${run.convId}`);
          }}
        >
          {runLabel(run)}
        </a>
      ) : (
        <span>{runLabel(run)}</span>
      )}
      {sheetsDelivery && (
        <span className="text-xs text-[var(--planora-muted)]">
          {' '}
          ({sheetsDelivery.spreadsheetTitle} → {sheetsDelivery.targetLabel ?? sheetsDelivery.targetId})
        </span>
      )}
      {githubDest && <span className="text-xs text-[var(--planora-muted)]"> ({githubDest})</span>}
      {run.error && <span className="block text-xs text-[var(--planora-error-text)]">{run.error}</span>}
    </>
  );
}

function ScheduleRow({
  schedule,
  navigate,
  reload,
  onChanged,
}: {
  schedule: ScheduleView;
  navigate: (path: string) => void;
  reload: () => Promise<void>;
  onChanged: (schedule: ScheduleView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<ScheduleRunView[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let current = true;
    apiClient
      .getScheduleRuns(schedule.id, 10)
      .then(data => {
        if (current) {
          setRuns(data.runs);
          setError('');
        }
      })
      .catch(() => {
        if (current) setError('Không tải được các lượt chạy.');
      });
    return () => {
      current = false;
    };
  }, [open, schedule]);

  return (
    <article className="bg-[var(--planora-paper)] rounded-2xl border border-[var(--planora-divider)] p-4 sm:p-5 v3-space-y-3 min-w-0 shadow-sm">
      <h3 className="font-serif text-base font-semibold text-[var(--planora-text)] [overflow-wrap:anywhere] flex flex-wrap items-center gap-2">
        <span>{schedule.name}</span>
        {(schedule.kind === 'calendar_digest' || schedule.kind === 'github_digest' || schedule.kind === 'sheets_digest') && (
          <span
            data-schedule-kind={schedule.kind}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--planora-success-bg)] text-[var(--planora-success-text)] border border-[var(--planora-success-border)]"
          >
            Tự gửi
          </span>
        )}
      </h3>
      {schedule.kind === 'telegram_digest' && (
        <p data-schedule-kind={schedule.kind} className="text-xs font-semibold text-[var(--planora-primary)]">
          Tự gửi Telegram{schedule.digest && 'chatTitle' in schedule.digest && schedule.digest.chatTitle ? ` · ${schedule.digest.chatTitle}` : ''}
        </p>
      )}
      {schedule.status === 'paused' && schedule.pauseReason && (
        <div className="p-3 rounded-xl bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border border-[var(--planora-pending-border)] text-xs v3-space-y-0.5">
          <p className="font-semibold">Lịch đang tạm dừng:</p>
          <p>{schedule.pauseReason}</p>
        </div>
      )}
      <p className="text-sm text-[var(--planora-muted)]">{describeRecurrence(schedule.recurrence)}</p>
      <p className="text-xs text-[var(--planora-muted)]">{scheduleLabel(schedule)}</p>
      {schedule.services && schedule.services.length > 0 && (
        <WorkflowFlowCanvas
          variant="planora"
          mode="schedule"
          services={schedule.services}
          isAutoDigest={schedule.kind !== 'plan'}
          compact
          className="mt-3"
        />
      )}
      {schedule.lastRun && (
        <p className="text-xs text-[var(--planora-muted)]">
          Lần trước: <RunLink run={schedule.lastRun} navigate={navigate} />
        </p>
      )}
      <ScheduleActions schedule={schedule} navigate={navigate} onChanged={onChanged} onConflict={reload} />
      <button
        type="button"
        className="text-xs font-semibold underline text-[var(--planora-muted)] hover:text-[var(--planora-text)] transition-colors cursor-pointer"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Ẩn các lượt gần nhất' : 'Xem 10 lượt gần nhất'}
      </button>
      {open && (
        <div className="text-sm text-[var(--planora-muted)] v3-space-y-2">
          {error && <p role="alert" className="text-[var(--planora-error-text)]">{error}</p>}
          {!error && !runs.length && <p>Chưa có lượt chạy.</p>}
          {runs.map(run => (
            <div key={run.id}>
              <RunLink run={run} navigate={navigate} />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

// PBI-05: chỉ mô tả đúng luồng có thật — lịch được lưu khi người dùng bấm "Xác nhận" trên đề xuất
// lịch chạy (ScheduleMoment → POST /conversations/:convId/schedule-proposals/:messageId/confirm).
function ScheduleEmptyState({ navigate }: { navigate: (path: string) => void }) {
  return (
    <div
      data-schedule-empty
      className="p-5 sm:p-6 rounded-2xl bg-[var(--planora-paper)] border border-[var(--planora-divider)] shadow-sm flex flex-col sm:flex-row sm:items-start gap-4 min-w-0"
    >
      <div
        aria-hidden="true"
        className="w-10 h-10 rounded-xl bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] flex items-center justify-center flex-shrink-0 text-[var(--planora-muted)]"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div className="v3-space-y-2 min-w-0 flex-1">
        <h3 className="font-serif text-base font-semibold text-[var(--planora-text)]">Chưa có lịch chạy nào</h3>
        <p className="text-sm text-[var(--planora-muted)] leading-relaxed [overflow-wrap:anywhere]">
          Lịch chạy được tạo trong Không gian làm việc: mô tả việc cần lặp lại kèm thời điểm, ví dụ “Mỗi sáng 08:00, gửi lịch họp hôm nay lên Slack”.
          Khi Planora đưa ra đề xuất lịch chạy, lịch chỉ được lưu sau khi bạn bấm Xác nhận trên đề xuất đó.
        </p>
        <a
          href="/"
          onClick={event => {
            if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigate('/');
          }}
          className="inline-flex items-center gap-1.5 mt-1 px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--planora-primary)] focus-visible:ring-offset-2 cursor-pointer"
        >
          Mở Không gian làm việc
        </a>
      </div>
    </div>
  );
}

export function ScheduleSection({ user, navigate }: { user: User | null; navigate: (path: string) => void }) {
  const enabled = useSchedulesEnabled();
  const [workspaceId, setWorkspaceId] = useState(getActiveWorkspaceId());
  const [schedules, setSchedules] = useState<ScheduleView[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => subscribeWorkspace(() => setWorkspaceId(getActiveWorkspaceId())), []);

  useEffect(() => {
    setSchedules([]);
    setLoaded(false);
    setError('');
    if (!enabled || !user) return;
    let current = true;
    let request = 0;
    const refresh = async () => {
      const sequence = ++request;
      try {
        const data = await apiClient.getSchedules();
        if (current && sequence === request) {
          setSchedules(data.schedules);
          setError('');
          setLoaded(true);
        }
      } catch {
        if (current && sequence === request) {
          setError('Không tải được lịch chạy.');
          setLoaded(true);
        }
      }
    };
    void refresh();
    const listener = () => {
      void refresh();
    };
    window.addEventListener('focus', listener);
    window.addEventListener('schedules:changed', listener);
    const timer = window.setInterval(listener, 30_000);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', listener);
      window.removeEventListener('schedules:changed', listener);
    };
  }, [enabled, user?.id, workspaceId]);

  const reload = async () => {
    const data = await apiClient.getSchedules();
    setSchedules(data.schedules);
  };

  if (!enabled || !user) return null;

  return (
    <section aria-labelledby="schedule-section-title" className="v3-space-y-4">
      <h2 id="schedule-section-title" className="font-serif text-2xl font-bold text-[var(--planora-text)]">
        Lịch chạy
      </h2>
      {!loaded && <p role="status" className="text-xs text-[var(--planora-muted)]">Đang tải lịch chạy…</p>}
      {error && <p role="alert" className="text-sm text-[var(--planora-error-text)]">{error}</p>}
      {loaded && !error && !schedules.length && <ScheduleEmptyState navigate={navigate} />}
      {schedules.map(schedule => (
        <ScheduleRow
          key={schedule.id}
          schedule={schedule}
          navigate={navigate}
          reload={reload}
          onChanged={changed => setSchedules(rows => rows.map(row => (row.id === changed.id ? changed : row)))}
        />
      ))}
    </section>
  );
}
