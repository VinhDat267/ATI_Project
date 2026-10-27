// FE-12: câu yêu cầu rời thanh trên và nằm ngay trên tiêu đề của khoảnh khắc, để đối chiếu khi duyệt.
// Không có trong bản mẫu. Cắt ở 2 dòng chỉ là hiển thị; toàn văn vẫn trong DOM và trong title.
import { useChatStore } from '../../store/chat-store';
import { runOrigin } from '../../services/schedule-text';
import { useSchedulesEnabled } from '../../hooks/use-schedules';
export function useScheduledOrigin() {
  const enabled = useSchedulesEnabled();
  const latestUser = useChatStore(state => [...state.messages].reverse().find(message => message.role === 'user'));
  const metadata = latestUser?.metadata;
  return enabled && metadata?.type === 'schedule_run' && metadata.name && metadata.dueAt ? runOrigin(metadata.name, metadata.dueAt) : null;
}
export function RequestEcho({ request }: { request?: string }) {
  const origin = useScheduledOrigin();
  if (origin) return <p data-schedule-origin className="text-xs text-[#6B7280] leading-relaxed [overflow-wrap:anywhere]">{origin}</p>;
  if (!request?.trim()) return null;
  return (
    <p data-request-echo title={request} className="text-xs text-[#6B7280] leading-relaxed line-clamp-2 break-words">
      Bạn nhờ: “<span className="text-[#111827] font-medium">{request}</span>”
    </p>
  );
}
