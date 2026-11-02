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
  return <><span>{formatRunTime(run.dueAt)} · </span>{run.convId ? <a className="underline text-[#FF5701]" href={`/c/${run.convId}`} onClick={event => { if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(`/c/${run.convId}`); }}>{runLabel(run)}</a> : <span>{runLabel(run)}</span>}{sheetsDelivery && <span className="text-xs text-[#6B7280]"> ({sheetsDelivery.spreadsheetTitle} → {sheetsDelivery.targetLabel ?? sheetsDelivery.targetId})</span>}{run.error && <span className="block text-xs text-[#6B7280]">{run.error}</span>}</>;
}
function ScheduleRow({ schedule, navigate, reload, onChanged }: { schedule: ScheduleView; navigate: (path: string) => void; reload: () => Promise<void>; onChanged: (schedule: ScheduleView) => void }) {
  const [open, setOpen] = useState(false), [runs, setRuns] = useState<ScheduleRunView[]>([]), [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let current = true;
    apiClient.getScheduleRuns(schedule.id, 10).then(data => { if (current) { setRuns(data.runs); setError(''); } }).catch(() => { if (current) setError('Không tải được các lượt chạy.'); });
    return () => { current = false; };
  }, [open, schedule]);
  return <article className="bg-white rounded-2xl border border-[#E7E7E2] p-4 sm:p-5 v3-space-y-3 min-w-0">
    <h3 className="text-base font-semibold text-[#111827] [overflow-wrap:anywhere] flex flex-wrap items-center gap-2">
      <span>{schedule.name}</span>
      {(schedule.kind === 'calendar_digest' || schedule.kind === 'github_digest' || schedule.kind === 'sheets_digest') && (
        <span data-schedule-kind={schedule.kind} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          Tự gửi
        </span>
      )}
    </h3>
    {schedule.kind === 'telegram_digest' && (
      <p data-schedule-kind={schedule.kind} className="text-xs font-semibold text-[#0369A1]">
        Tự gửi Telegram{schedule.digest && 'chatTitle' in schedule.digest && schedule.digest.chatTitle ? ` · ${schedule.digest.chatTitle}` : ''}
      </p>
    )}
    <p className="text-sm text-[#4B5563]">{describeRecurrence(schedule.recurrence)}</p><p className="text-xs text-[#6B7280]">{scheduleLabel(schedule)}</p>
    {schedule.services && schedule.services.length > 0 && (
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
    {open && <div className="text-sm text-[#4B5563] v3-space-y-2">{error && <p role="alert">{error}</p>}{!error && !runs.length && <p>Chưa có lượt chạy.</p>}{runs.map(run => <div key={run.id}><RunLink run={run} navigate={navigate} /></div>)}</div>}
  </article>;
}
// PBI-05: chỉ mô tả đúng luồng có thật — lịch được lưu khi người dùng bấm "Xác nhận" trên đề xuất
// lịch chạy (ScheduleMoment → POST /conversations/:convId/schedule-proposals/:messageId/confirm).
function ScheduleEmptyState({ navigate }: { navigate: (path: string) => void }) {
  return <div data-schedule-empty className="p-5 sm:p-6 rounded-2xl bg-white border border-[#E7E7E2] shadow-soft flex flex-col sm:flex-row sm:items-start gap-4 min-w-0">
    <div aria-hidden="true" className="w-10 h-10 rounded-xl bg-neutral-100 border border-[#E7E7E2] flex items-center justify-center flex-shrink-0 text-[#4B5563]">
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    </div>
    <div className="v3-space-y-2 min-w-0 flex-1">
      <h3 className="text-base font-semibold text-[#111827]">Chưa có lịch chạy nào</h3>
      <p className="text-sm text-[#4B5563] leading-relaxed [overflow-wrap:anywhere]">
        Lịch chạy được tạo trong Không gian làm việc: mô tả việc cần lặp lại kèm thời điểm, ví dụ “Mỗi sáng 08:00, gửi lịch họp hôm nay lên Slack”.
        Khi ATI đưa ra đề xuất lịch chạy, lịch chỉ được lưu sau khi bạn bấm Xác nhận trên đề xuất đó.
      </p>
      <a href="/" onClick={event => { if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate('/'); }}
        className="inline-flex items-center gap-1.5 mt-1 px-4 py-2 rounded-xl text-sm font-semibold bg-[#111827] text-white hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:ring-offset-2">
        Mở Không gian làm việc
      </a>
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
  return <section aria-labelledby="schedule-section-title" className="v3-space-y-4"><h2 id="schedule-section-title" className="font-display text-2xl font-bold text-[#111827]">Lịch chạy</h2>{!loaded && <p role="status" className="text-xs text-[#6B7280]">Đang tải lịch chạy…</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{loaded && !error && !schedules.length && <ScheduleEmptyState navigate={navigate} />}{schedules.map(schedule => <ScheduleRow key={schedule.id} schedule={schedule} navigate={navigate} reload={reload} onChanged={changed => setSchedules(rows => rows.map(row => row.id === changed.id ? changed : row))} />)}</section>;
}
