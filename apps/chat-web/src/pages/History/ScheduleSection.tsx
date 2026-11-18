import { useEffect, useState } from 'react';
import type { ScheduleRunView, ScheduleView } from '@wap/tool-schemas';
import type { User } from '../../types';
import { apiClient } from '../../services/api-client';
import { schedulesChanged, useSchedulesEnabled } from '../../hooks/use-schedules';
import { describeRecurrence, formatRunTime, runLabel, scheduleLabel } from '../../services/schedule-text';
import { getActiveWorkspaceId, subscribeWorkspace } from '../../services/workspace-storage';
import { ScheduleActions } from '../Cockpit/ScheduleActions';
import {
  SheetsDeliveryRecoveryControl,
  getEffectiveDeliveryResolution,
  isUncertainSheetsDeliveryRun,
} from '../Cockpit/ScheduleRunRecovery';
import { WorkflowFlowCanvas } from '../../components/WorkflowFlowCanvas';
import { ServiceLogo } from '../../components/ServiceLogo';

import { SCHEDULE_EVENT_TEMPLATES, type ScheduleEventTemplate } from '../../services/job-readiness';

export { SCHEDULE_EVENT_TEMPLATES, type ScheduleEventTemplate };

function triggerScheduleTemplate(prompt: string, navigate: (path: string) => void) {
  try {
    sessionStorage.setItem('ati_prefill_prompt', prompt);
  } catch {
    // Ignore storage quota errors
  }
  navigate('/');
}

function RunLink({ run, navigate }: { run: ScheduleRunView; navigate: (path: string) => void }) {
  const sheetsDelivery = run.delivery && 'spreadsheetTitle' in run.delivery ? run.delivery : null;
  const githubDest = run.delivery && 'counts' in run.delivery
    ? (run.delivery.telegramChatTitle || run.delivery.telegramChatId
        ? `Telegram: ${run.delivery.telegramChatTitle ?? run.delivery.telegramChatId}`
        : run.delivery.channelName
          ? `#${run.delivery.channelName.replace(/^#/, '')}`
          : null)
    : null;
  const telegramDest =
    run.delivery &&
    'chatTitle' in run.delivery &&
    !('spreadsheetTitle' in run.delivery) &&
    !('counts' in run.delivery)
      ? `Telegram: ${run.delivery.chatTitle}${
          Array.isArray(run.delivery.sources) && run.delivery.sources.length > 0
            ? ` · ${run.delivery.sources.length} nguồn`
            : ''
        }`
      : null;
  const slackMultiDest =
    run.delivery &&
    'destinationService' in run.delivery &&
    run.delivery.destinationService === 'slack' &&
    'sources' in run.delivery &&
    !('counts' in run.delivery)
      ? `Slack #${run.delivery.channelName.replace(/^#/, '')}${
          Array.isArray(run.delivery.sources) && run.delivery.sources.length > 0
            ? ` · ${run.delivery.sources.length} nguồn`
            : ''
        }`
      : null;
  return <><span>{formatRunTime(run.dueAt)} · </span>{run.convId ? <a className="underline text-[#B43E00]" href={`/c/${run.convId}`} onClick={event => { if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(`/c/${run.convId}`); }}>{runLabel(run)}</a> : <span>{runLabel(run)}</span>}{sheetsDelivery && <span className="text-xs text-[#6A5F56]"> ({sheetsDelivery.spreadsheetTitle} → {sheetsDelivery.targetLabel ?? sheetsDelivery.targetId})</span>}{githubDest && <span className="text-xs text-[#6A5F56]"> ({githubDest})</span>}{telegramDest && <span className="text-xs text-[#6A5F56]"> ({telegramDest})</span>}{slackMultiDest && <span className="text-xs text-[#6A5F56]"> ({slackMultiDest})</span>}{run.error && <span className="block text-xs text-[#6A5F56]">{run.error}</span>}</>;
}
function ScheduleRow({ schedule, navigate, reload, onChanged }: { schedule: ScheduleView; navigate: (path: string) => void; reload: () => Promise<void>; onChanged: (schedule: ScheduleView) => void }) {
  const [open, setOpen] = useState(false), [runs, setRuns] = useState<ScheduleRunView[]>([]), [error, setError] = useState('');
  const [latestResolvedRun, setLatestResolvedRun] = useState<ScheduleRunView | null>(null);
  useEffect(() => {
    if (!open) return;
    let current = true;
    apiClient.getScheduleRuns(schedule.id, 10).then(data => { if (current) { setRuns(data.runs); setError(''); } }).catch(() => { if (current) setError('Không tải được các lượt chạy.'); });
    return () => { current = false; };
  }, [open, schedule]);
  const effectiveLastRun =
    latestResolvedRun && schedule.lastRun?.id === latestResolvedRun.id
      ? latestResolvedRun
      : schedule.lastRun;
  const primaryRecoveryRun =
    effectiveLastRun &&
    (getEffectiveDeliveryResolution(effectiveLastRun) != null ||
      isUncertainSheetsDeliveryRun(effectiveLastRun))
      ? effectiveLastRun
      : latestResolvedRun;
  return <article className="ps-panel p-4 sm:p-5 v3-space-y-3 min-w-0">
    <h3 className="font-sans text-base font-semibold text-[#1a0e08] [overflow-wrap:anywhere] flex flex-wrap items-center gap-2">
      <span>{schedule.name}</span>
      {schedule.kind === 'plan' ? (
        <span data-schedule-kind="plan" data-schedule-mode="manual" className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
          Mỗi lượt cần bạn duyệt
        </span>
      ) : schedule.kind !== 'telegram_digest' && schedule.kind !== 'slack_digest' ? (
        <span data-schedule-kind={schedule.kind} data-schedule-mode="auto_digest" className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          Tự gửi
        </span>
      ) : null}
    </h3>
    {schedule.kind === 'telegram_digest' && (
      <p data-schedule-kind={schedule.kind} className="text-xs font-semibold text-[#0369A1]">
        Tự gửi Telegram{schedule.digest && 'chatTitle' in schedule.digest && schedule.digest.chatTitle ? ` · ${schedule.digest.chatTitle}` : ''}
      </p>
    )}
    {schedule.kind === 'slack_digest' && (
      <p data-schedule-kind={schedule.kind} className="text-xs font-semibold text-emerald-700">
        Tự gửi Slack{schedule.digest && 'channelName' in schedule.digest && schedule.digest.channelName ? ` · #${schedule.digest.channelName.replace(/^#/, '')}` : ''}
      </p>
    )}
    {schedule.kind !== 'plan' && schedule.kind !== 'telegram_digest' && schedule.kind !== 'slack_digest' && (
      <p className="text-xs font-semibold text-emerald-700">
        Gửi định kỳ theo phạm vi đã xác nhận
      </p>
    )}
    <p className="text-sm text-[#51463E]">{describeRecurrence(schedule.recurrence)}</p><p className="text-xs text-[#6A5F56]">{scheduleLabel(schedule)}</p>
    {schedule.lastRun?.state === 'needs_attention' && (
      <div role="alert" className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 v3-space-y-1">
        <p className="font-semibold">Lượt chạy cần bạn xem:</p>
        <p>{schedule.lastRun.error || 'Chưa xác định kết quả gửi. Để tránh gửi trùng, lượt này không tự động gửi lại.'}</p>
      </div>
    )}
    {primaryRecoveryRun && (
      <SheetsDeliveryRecoveryControl
        run={primaryRecoveryRun}
        isSheetsSchedule={schedule.kind === 'sheets_digest'}
        scheduleStatus={schedule.status}
        onResolved={res => {
          setLatestResolvedRun(res.run);
          setRuns(prev => prev.map(row => (row.id === res.run.id ? res.run : row)));
          onChanged(res.schedule);
          schedulesChanged();
        }}
      />
    )}
    {schedule.lastRun?.state === 'awaiting_approval' && (
      <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 v3-space-y-1">
        <p className="font-semibold">Lượt chạy chờ duyệt:</p>
        <p>Kế hoạch đã sẵn sàng, cần bạn xem và xác nhận trước khi gửi.</p>
      </div>
    )}
    {schedule.services && schedule.services.length >= 2 && (
      <WorkflowFlowCanvas
        services={schedule.services}
        isAutoDigest={schedule.kind !== 'plan'}
        mode="schedule"
        compact
      />
    )}
    {schedule.lastRun && <p className="text-xs text-[#51463E]">Lần trước: <RunLink run={schedule.lastRun} navigate={navigate} /></p>}
    <ScheduleActions schedule={schedule} navigate={navigate} onChanged={onChanged} onConflict={reload} />
    <button type="button" className="text-xs font-semibold underline text-[#51463E]" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Ẩn các lượt gần nhất' : 'Xem 10 lượt gần nhất'}</button>
    {open && <div className="text-sm text-[#51463E] v3-space-y-2">{error && <p role="alert">{error}</p>}{!error && !runs.length && <p>Chưa có lượt chạy.</p>}{runs.map(run => <div key={run.id} className="v3-space-y-1.5"><RunLink run={run} navigate={navigate} />{run.id !== primaryRecoveryRun?.id && <SheetsDeliveryRecoveryControl run={run} isSheetsSchedule={schedule.kind === 'sheets_digest'} scheduleStatus={schedule.status} onResolved={res => { setLatestResolvedRun(res.run); setRuns(prev => prev.map(row => (row.id === res.run.id ? res.run : row))); onChanged(res.schedule); schedulesChanged(); }} />}</div>)}</div>}
  </article>;
}
// PBI-05: chỉ mô tả đúng luồng có thật — lịch được lưu khi người dùng bấm "Xác nhận" trên đề xuất
// lịch chạy (ScheduleMoment → POST /conversations/:convId/schedule-proposals/:messageId/confirm).
function ScheduleEmptyState({ navigate }: { navigate: (path: string) => void }) {
  // Bước 5b: một bảng phẳng — câu hướng dẫn và nút chính ở trên, các mẫu gợi ý là hàng bên dưới (không còn lưới thẻ có nhãn màu).
  return <div data-schedule-empty className="ps-panel min-w-0">
    <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
      <div className="v3-space-y-1.5 min-w-0">
        <h3 className="font-sans text-base font-semibold text-[#1a0e08] dark:text-white">Chưa có lịch chạy nào</h3>
        <p className="ps-note [overflow-wrap:anywhere]">
          Trong Không gian làm việc, gõ việc cần lặp lại kèm giờ, ví dụ “Mỗi sáng 08:00, gửi lịch họp hôm nay lên Slack”.
          Lịch chỉ được lưu sau khi bạn bấm Xác nhận trên đề xuất đó.
        </p>
      </div>
      <a href="/" onClick={event => { if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate('/'); }}
        className="ps-btn flex-shrink-0 self-start md:self-auto">
        Mở Không gian làm việc
      </a>
    </div>
    <div className="border-t border-[#E3DACE] dark:border-[#2A231E]">
      <h4 className="px-4 sm:px-5 pt-4 pb-1 text-sm font-semibold text-[#1a0e08] dark:text-white">Mẫu gợi ý</h4>
      <ul className="ps-rows" data-testid="schedule-event-templates">
        {SCHEDULE_EVENT_TEMPLATES.map(tpl => (
          <li key={tpl.id} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0">
            <div className="flex items-center gap-1.5 flex-shrink-0 sm:w-16" aria-hidden="true">
              {tpl.services.map(svc => (
                <ServiceLogo key={svc} service={svc} className="w-4 h-4" />
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#1a0e08] dark:text-white">{tpl.title}</p>
              <p className="text-[13px] leading-relaxed text-[#51463E] dark:text-[#D7CEC4]">{tpl.description}</p>
            </div>
            <span className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A] tabular-nums whitespace-nowrap sm:w-40 sm:text-right flex-shrink-0">{tpl.cadenceLabel}</span>
            <button
              type="button"
              data-testid={`btn-schedule-template-${tpl.id}`}
              aria-label={`Dùng mẫu ${tpl.title}`}
              onClick={() => triggerScheduleTemplate(tpl.prompt, navigate)}
              className="ps-btn-quiet flex-shrink-0 self-start sm:self-auto"
            >
              Dùng mẫu
            </button>
          </li>
        ))}
      </ul>
    </div>
  </div>;
}
export function ScheduleSection({ user, navigate }: { user: User | null; navigate: (path: string) => void }) {
  const enabled = useSchedulesEnabled();
  const [workspaceId, setWorkspaceId] = useState(getActiveWorkspaceId());
  const [schedules, setSchedules] = useState<ScheduleView[]>([]), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  useEffect(() => subscribeWorkspace(() => setWorkspaceId(getActiveWorkspaceId())), []);
  useEffect(() => {
    setSchedules([]); setLoaded(false); setError('');
    if (!enabled || !user) return;
    let current = true, request = 0;
    const refresh = async () => { const sequence = ++request; try { const data = await apiClient.getSchedules(); if (current && sequence === request) { setSchedules(data.schedules); setError(''); setLoaded(true); } } catch { if (current && sequence === request) { setError('Không tải được lịch chạy.'); setLoaded(true); } } };
    void refresh(); const listener = () => { void refresh(); };
    window.addEventListener('focus', listener); window.addEventListener('schedules:changed', listener);
    const timer = window.setInterval(listener, 30_000);
    return () => { current = false; window.clearInterval(timer); window.removeEventListener('focus', listener); window.removeEventListener('schedules:changed', listener); };
  }, [enabled, user?.id, workspaceId]);
  const reload = async () => { const data = await apiClient.getSchedules(); setSchedules(data.schedules); };
  if (!enabled || !user) return null;
  return <section aria-labelledby="schedule-section-title" className="v3-space-y-4"><div className="ps-sectionhead"><h2 id="schedule-section-title">Lịch chạy</h2></div>{!loaded && <p role="status" className="ps-note">Đang tải lịch chạy…</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{loaded && !error && !schedules.length && <ScheduleEmptyState navigate={navigate} />}{schedules.map(schedule => <ScheduleRow key={schedule.id} schedule={schedule} navigate={navigate} reload={reload} onChanged={changed => setSchedules(rows => rows.map(row => row.id === changed.id ? changed : row))} />)}</section>;
}
