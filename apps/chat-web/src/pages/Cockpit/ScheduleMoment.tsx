import { useEffect, useRef, useState } from 'react';
import type { ScheduleView } from '@wap/tool-schemas';
import type { ChatMessage } from '../../types';
import { apiClient } from '../../services/api-client';
import { describeRecurrence, formatRunTime, scheduleLabel } from '../../services/schedule-text';
import { schedulesChanged } from '../../hooks/use-schedules';
import { useChatStore } from '../../store/chat-store';
import { serviceName, servicePalette } from './presentation';
import { ScheduleActions, scheduleButton, primaryScheduleButton } from './ScheduleActions';
import { ServiceLogo } from '../../components/ServiceLogo';

export async function reloadScheduleConversation(id: string) {
  const before = useChatStore.getState();
  const { messages } = await apiClient.getConversation(id);
  const current = useChatStore.getState();
  if (current.conversationId === id && current.messages === before.messages && current.planRevision === before.planRevision) useChatStore.setState({ messages });
}
export function ScheduleMoment({ message, convId, navigate, onEdit }: { message: ChatMessage; convId: string; navigate: (path: string) => void; onEdit: () => void }) {
  const [ignored, setIgnored] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<ScheduleView | null>(null);
  const locked = useRef(false);
  const currentMessage = useRef(message.id); currentMessage.current = message.id;
  useEffect(() => { setIgnored(false); setConfirmed(null); }, [message.id]);
  const metadata = message.metadata!;
  const schedule = confirmed ?? metadata.schedule;
  const proposal = metadata.proposal;
  const previous = metadata.previous;
  const confirm = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await apiClient.confirmSchedule(convId, message.id);
      if (currentMessage.current === message.id) setConfirmed(result.schedule); schedulesChanged();
    } catch (reason: any) {
      setError(reason.message || 'Không thể xác nhận lịch.');
      if (reason.status === 409) await reloadScheduleConversation(convId).catch(() => {});
    } finally { locked.current = false; setBusy(false); }
  };
  if (ignored) return <p role="status" className="text-sm text-[#6B7280]">Đã bỏ qua đề xuất trong phiên này.</p>;
  const change = (label: string, old: string | undefined, value: string | undefined) => value && <div className="v3-space-y-1"><p className="text-xs font-semibold text-[#6B7280]">{label}</p>{proposal?.action === 'update' && old !== undefined && old !== value && <del className="block text-sm text-[#6B7280] [overflow-wrap:anywhere]">{old}</del>}<p className="text-sm font-medium text-[#111827] whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</p></div>;
  const manage = proposal && ['pause', 'resume', 'cancel'].includes(proposal.action);
  const title = schedule?.name ?? (manage ? `${proposal.action === 'pause' ? 'Tạm dừng' : proposal.action === 'resume' ? 'Chạy tiếp' : 'Hủy'} lịch "${previous?.name ?? ''}"?` : proposal?.name);
  return <section data-moment="schedule" className="w-full min-w-0 max-w-3xl mx-auto v3-space-y-5">
    <p className="text-xs uppercase tracking-wider text-[#6B7280]">ATI · Lịch chạy workflow</p>
    <h1 tabIndex={-1} className="font-display text-3xl sm:text-4xl font-bold text-[#111827] [overflow-wrap:anywhere]">{title}</h1>
    <div className="bg-white border border-[#E7E7E2] rounded-2xl shadow-soft-card p-5 sm:p-6 v3-space-y-5 min-w-0">
      {schedule ? <><p role="status" className="text-sm font-semibold text-[#111827]">{scheduleLabel(schedule)}</p><p className="text-sm text-[#4B5563]">{describeRecurrence(schedule.recurrence)}</p><p className="text-sm text-[#4B5563] [overflow-wrap:anywhere]">{schedule.request}</p>
        <ScheduleActions schedule={schedule} navigate={navigate} onChanged={setConfirmed} onConflict={() => reloadScheduleConversation(convId)} /></>
        : proposal && <>{manage ? <p className="text-sm text-[#4B5563]">{proposal.action === 'cancel' ? 'Lịch đã hủy không bật lại được.' : proposal.summary}</p> : <>
          {proposal.action === 'update' && previous?.name !== proposal.name && change('Tên lịch', previous?.name, proposal.name)}
          {change('Thời gian', previous ? describeRecurrence(previous.recurrence) : undefined, proposal.recurrence ? describeRecurrence(proposal.recurrence) : undefined)}
          {change('Việc sẽ làm', previous?.request, proposal.request)}
          <div className="flex flex-wrap gap-2">{metadata.services?.map(id => <span key={id} className="inline-flex items-center gap-2 text-xs text-[#4B5563]"><span aria-hidden="true" className={`w-6 h-6 rounded-lg border flex items-center justify-center ${servicePalette(id).icon}`}><ServiceLogo service={id} className="w-3.5 h-3.5" /></span>{serviceName(id, [])}</span>)}</div>
          {!!metadata.nextRuns?.length && <div className="text-xs text-[#4B5563] v3-space-y-1"><p className="font-semibold">Lần chạy tới:</p>{metadata.nextRuns.map(time => <p key={time}>{formatRunTime(time)}</p>)}</div>}
          <p className="text-sm text-[#4B5563] leading-relaxed">Tới giờ, ATI lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.</p>
        </>}
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={primaryScheduleButton} onClick={() => void confirm()}>Xác nhận</button><button type="button" disabled={busy} className={scheduleButton} onClick={onEdit}>Sửa</button><button type="button" disabled={busy} className={scheduleButton} onClick={() => setIgnored(true)}>Bỏ qua</button></div>
      </>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  </section>;
}
