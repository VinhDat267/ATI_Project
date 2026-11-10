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
  return <><span>{formatRunTime(run.dueAt)} · </span>{run.convId ? <a className="underline text-[#B43E00]" href={`/c/${run.convId}`} onClick={event => { if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(`/c/${run.convId}`); }}>{runLabel(run)}</a> : <span>{runLabel(run)}</span>}{sheetsDelivery && <span className="text-xs text-[#6B7280]"> ({sheetsDelivery.spreadsheetTitle} → {sheetsDelivery.targetLabel ?? sheetsDelivery.targetId})</span>}{githubDest && <span className="text-xs text-[#6B7280]"> ({githubDest})</span>}{telegramDest && <span className="text-xs text-[#6B7280]"> ({telegramDest})</span>}{run.error && <span className="block text-xs text-[#6B7280]">{run.error}</span>}</>;
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
  return <article className="bg-white rounded-2xl border border-[#E5E5E0] p-4 sm:p-5 v3-space-y-3 min-w-0 shadow-2xs">
    <h3 className="font-sans text-base font-semibold text-[#111827] [overflow-wrap:anywhere] flex flex-wrap items-center gap-2">
      <span>{schedule.name}</span>
      {schedule.kind === 'plan' ? (
        <span data-schedule-kind="plan" data-schedule-mode="manual" className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
          Mỗi lượt cần bạn duyệt
        </span>
      ) : schedule.kind !== 'telegram_digest' ? (
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
    {schedule.kind !== 'plan' && schedule.kind !== 'telegram_digest' && (
      <p className="text-xs font-semibold text-emerald-700">
        Gửi định kỳ theo phạm vi đã xác nhận
      </p>
    )}
    <p className="text-sm text-[#4B5563]">{describeRecurrence(schedule.recurrence)}</p><p className="text-xs text-[#6B7280]">{scheduleLabel(schedule)}</p>
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
    {schedule.lastRun && <p className="text-xs text-[#4B5563]">Lần trước: <RunLink run={schedule.lastRun} navigate={navigate} /></p>}
    <ScheduleActions schedule={schedule} navigate={navigate} onChanged={onChanged} onConflict={reload} />
    <button type="button" className="text-xs font-semibold underline text-[#4B5563]" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Ẩn các lượt gần nhất' : 'Xem 10 lượt gần nhất'}</button>
    {open && <div className="text-sm text-[#4B5563] v3-space-y-2">{error && <p role="alert">{error}</p>}{!error && !runs.length && <p>Chưa có lượt chạy.</p>}{runs.map(run => <div key={run.id} className="v3-space-y-1.5"><RunLink run={run} navigate={navigate} />{run.id !== primaryRecoveryRun?.id && <SheetsDeliveryRecoveryControl run={run} isSheetsSchedule={schedule.kind === 'sheets_digest'} scheduleStatus={schedule.status} onResolved={res => { setLatestResolvedRun(res.run); setRuns(prev => prev.map(row => (row.id === res.run.id ? res.run : row))); onChanged(res.schedule); schedulesChanged(); }} />}</div>)}</div>}
  </article>;
}
// PBI-05: chỉ mô tả đúng luồng có thật — lịch được lưu khi người dùng bấm "Xác nhận" trên đề xuất
// lịch chạy (ScheduleMoment → POST /conversations/:convId/schedule-proposals/:messageId/confirm).
function ScheduleEmptyState({ navigate }: { navigate: (path: string) => void }) {
  return <div data-schedule-empty className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E5E5E0] dark:border-[#374151] shadow-2xs v3-space-y-4 min-w-0">
    <div className="flex flex-col sm:flex-row sm:items-start gap-4 min-w-0">
      <div aria-hidden="true" className="w-10 h-10 rounded-xl bg-[#F8F8F6] dark:bg-neutral-800 border border-[#E5E5E0] dark:border-[#374151] flex items-center justify-center flex-shrink-0 text-[#4B5563] dark:text-[#D1D5DB]">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      </div>
      <div className="v3-space-y-2 min-w-0 flex-1">
        <h3 className="font-sans text-base font-semibold text-[#111827] dark:text-white">Chưa có lịch chạy nào</h3>
        <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed [overflow-wrap:anywhere]">
          Lịch chạy được tạo trong Không gian làm việc: mô tả việc cần lặp lại kèm thời điểm, ví dụ “Mỗi sáng 08:00, gửi lịch họp hôm nay lên Slack”.
          Khi Planora đưa ra đề xuất lịch chạy, lịch chỉ được lưu sau khi bạn bấm Xác nhận trên đề xuất đó.
        </p>
        <a href="/" onClick={event => { if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate('/'); }}
          className="inline-flex items-center gap-1.5 mt-1 px-4 py-2 rounded-xl text-sm font-semibold bg-[#111827] dark:bg-[#C84300] text-white hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C84300] focus-visible:ring-offset-2">
          Mở Không gian làm việc
        </a>
      </div>
    </div>
    <div className="pt-3 border-t border-[#E5E5E0] dark:border-[#374151] v3-space-y-2.5">
      <p className="text-xs font-semibold text-[#6B7280] dark:text-[#9CA3AF]">
        Kích hoạt nhanh mẫu sự kiện &amp; bản tin tự động phổ biến:
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="schedule-event-templates">
        {SCHEDULE_EVENT_TEMPLATES.map(tpl => (
          <div key={tpl.id} className="p-3.5 rounded-xl border border-[#E5E5E0] dark:border-[#374151] bg-[#F8F8F6] dark:bg-[#111827] flex flex-col justify-between gap-2.5">
            <div className="v3-space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {tpl.services.map(svc => (
                    <ServiceLogo key={svc} service={svc} className="w-4 h-4" />
                  ))}
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                  {tpl.cadenceLabel}
                </span>
              </div>
              <p className="text-sm font-semibold text-[#111827] dark:text-white">{tpl.title}</p>
              <p className="text-xs text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">{tpl.description}</p>
            </div>
            <div className="pt-1">
              <button
                type="button"
                data-testid={`btn-schedule-template-${tpl.id}`}
                onClick={() => triggerScheduleTemplate(tpl.prompt, navigate)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#B43E00] hover:text-[#9A3400] transition-colors"
              >
                <span>Thiết lập lịch sự kiện này →</span>
              </button>
            </div>
          </div>
        ))}
      </div>
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
  return <section aria-labelledby="schedule-section-title" className="v3-space-y-3"><h2 id="schedule-section-title" className="font-sans text-lg font-semibold tracking-tight text-[#111827]">Lịch chạy</h2>{!loaded && <p role="status" className="text-xs text-[#6B7280]">Đang tải lịch chạy…</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{loaded && !error && !schedules.length && <ScheduleEmptyState navigate={navigate} />}{schedules.map(schedule => <ScheduleRow key={schedule.id} schedule={schedule} navigate={navigate} reload={reload} onChanged={changed => setSchedules(rows => rows.map(row => row.id === changed.id ? changed : row))} />)}</section>;
}
