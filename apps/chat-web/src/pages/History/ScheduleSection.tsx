import { useEffect, useState } from 'react';
import type { ScheduleRunView, ScheduleView } from '@wap/tool-schemas';
import type { User } from '../../types';
import { apiClient } from '../../services/api-client';
import { useSchedulesEnabled } from '../../hooks/use-schedules';
import { describeRecurrence, formatRunTime, runLabel, scheduleLabel } from '../../services/schedule-text';
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
export function ScheduleSection({ user, navigate }: { user: User | null; navigate: (path: string) => void }) {
  const enabled = useSchedulesEnabled();
  const [schedules, setSchedules] = useState<ScheduleView[]>([]), [error, setError] = useState('');
  useEffect(() => {
    setSchedules([]);
    if (!enabled || !user) return;
    let current = true, request = 0;
    const refresh = async () => { const sequence = ++request; try { const data = await apiClient.getSchedules(); if (current && sequence === request) { setSchedules(data.schedules); setError(''); } } catch { if (current && sequence === request) setError('Không tải được lịch chạy.'); } };
    void refresh(); const listener = () => { void refresh(); };
    window.addEventListener('focus', listener); window.addEventListener('schedules:changed', listener);
    const timer = window.setInterval(listener, 30_000);
    return () => { current = false; window.clearInterval(timer); window.removeEventListener('focus', listener); window.removeEventListener('schedules:changed', listener); };
  }, [enabled, user?.id]);
  const reload = async () => { const data = await apiClient.getSchedules(); setSchedules(data.schedules); };
  if (!enabled || !user || (!schedules.length && !error)) return null;
  return <section aria-labelledby="schedule-section-title" className="v3-space-y-4"><h2 id="schedule-section-title" className="font-display text-2xl font-bold text-[#111827]">Lịch chạy</h2>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{schedules.map(schedule => <ScheduleRow key={schedule.id} schedule={schedule} navigate={navigate} reload={reload} onChanged={changed => setSchedules(rows => rows.map(row => row.id === changed.id ? changed : row))} />)}</section>;
}
