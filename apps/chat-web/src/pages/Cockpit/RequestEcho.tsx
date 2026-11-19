// FE-12: câu yêu cầu rời thanh trên và nằm ngay trên tiêu đề của khoảnh khắc, để đối chiếu khi duyệt.
import { ChevronDown } from 'lucide-react';
import { useChatStore } from '../../store/chat-store';
import { runOrigin } from '../../services/schedule-text';
import { useSchedulesEnabled } from '../../hooks/use-schedules';
export function useScheduledOrigin() {
  const enabled = useSchedulesEnabled();
  const latestUser = useChatStore(state => [...state.messages].reverse().find(message => message.role === 'user'));
  const metadata = latestUser?.metadata;
  return enabled && metadata?.type === 'schedule_run' && metadata.name && metadata.dueAt ? runOrigin(metadata.name, metadata.dueAt) : null;
}
export function RequestEcho({ request, expandable = false }: { request?: string; expandable?: boolean }) {
  const origin = useScheduledOrigin();
  if (origin) return <p data-schedule-origin className="text-xs text-[#6A5F56] leading-relaxed [overflow-wrap:anywhere]">{origin}</p>;
  if (!request?.trim()) return null;
  const text = <>Bạn nhờ: “<span className="text-[#1a0e08] font-medium">{request}</span>”</>;
  if (expandable) {
    return (
      <details className="request-echo-disclosure group min-w-0">
        <summary className="flex cursor-pointer list-none items-start gap-1.5 rounded-sm text-[13px] leading-relaxed text-[var(--ps-faint)] [&::-webkit-details-marker]:hidden">
          <span data-request-echo title={request} className="min-w-0 line-clamp-2 group-open:line-clamp-none whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</span>
          <ChevronDown aria-hidden="true" size={16} className="mt-0.5 shrink-0 group-open:rotate-180" />
        </summary>
      </details>
    );
  }
  return (
    <p data-request-echo title={request} className="text-xs text-[#6A5F56] leading-relaxed line-clamp-2 break-words">
      {text}
    </p>
  );
}
