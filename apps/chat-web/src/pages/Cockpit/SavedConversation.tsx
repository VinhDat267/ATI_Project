// PBI-03: một hội thoại đã lưu nhưng không còn gì chờ xử lý (kế hoạch hết hạn duyệt hoặc đã huỷ,
// chưa có lượt chạy) rơi về khoảnh khắc 1. Trước đây sân khấu khi đó giống hệt hội thoại mới và
// tin nhắn đã lưu không có lối xem. Thẻ này đưa yêu cầu gần nhất và kết cục của nó lên sân khấu.
import type { ChatMessage } from '../../types';

/** Yêu cầu đã được máy chủ nhận gần nhất (không tính tin đang gửi/gửi lỗi và lượt chạy theo lịch). */
export function latestSavedRequest(messages: ChatMessage[]): ChatMessage | undefined {
  return [...messages].reverse().find(message => message.role === 'user' && message.status !== 'sending' &&
    message.status !== 'failed' && message.metadata?.type !== 'schedule_run' && message.content.trim() !== '');
}

function outcome(messages: ChatMessage[], request: ChatMessage): string {
  const after = messages.slice(messages.indexOf(request) + 1);
  const plan = [...after].reverse().find(message => message.metadata?.type === 'plan');
  if (plan) {
    const summary = plan.metadata?.plan?.summary ?? plan.content.replace(/^Kế hoạch:\s*/, '');
    const count = plan.metadata?.plan?.steps?.length;
    return `Kế hoạch “${summary}”${count ? ` (${count} việc)` : ''} không còn chờ duyệt: kế hoạch đã hết hạn duyệt hoặc đã bị huỷ. Gửi lại yêu cầu nếu bạn vẫn muốn ATI lập kế hoạch mới.`;
  }
  return 'Yêu cầu này không có kế hoạch nào đang chờ duyệt. Gửi lại yêu cầu nếu bạn vẫn muốn ATI xử lý.';
}

export function SavedConversation({ messages, request, onOpenConversation, onResend }: {
  messages: ChatMessage[]; request: ChatMessage; onOpenConversation: () => void; onResend: (text: string) => void;
}) {
  const timestamp = request.timestamp ?? request.created_at;
  const validTime = !!timestamp && Number.isFinite(Date.parse(timestamp));
  return (
    <section aria-labelledby="saved-conversation-title" data-saved-conversation
      className="p-4 sm:p-5 rounded-2xl bg-white border border-[#E7E7E2] shadow-sm v3-space-y-3 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="saved-conversation-title" className="text-xs font-semibold uppercase tracking-wider text-[#4B5563]">Hội thoại đã lưu</h2>
        {validTime && <span className="text-xs text-[#6B7280]">Yêu cầu lúc <time dateTime={timestamp}>{new Date(timestamp!).toLocaleString('vi-VN', { hour12: false })}</time></span>}
      </div>
      <blockquote className="border-l-2 border-[#E7E7E2] pl-3 text-base text-[#111827] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{request.content}</blockquote>
      <p role="status" className="text-sm leading-relaxed rounded-xl bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 [overflow-wrap:anywhere]">{outcome(messages, request)}</p>
      <div className="flex flex-col min-[420px]:flex-row gap-2">
        <button type="button" onClick={() => onResend(request.content)}
          className="inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-semibold bg-[#111827] text-white hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:ring-offset-2">
          Dùng lại yêu cầu này
        </button>
        <button type="button" onClick={onOpenConversation}
          className="inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-medium bg-white border border-[#E7E7E2] text-[#111827] hover:bg-neutral-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:ring-offset-2">
          Xem toàn bộ hội thoại ({messages.length} tin nhắn)
        </button>
      </div>
    </section>
  );
}
