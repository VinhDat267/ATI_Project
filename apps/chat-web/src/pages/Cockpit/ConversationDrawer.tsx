// Source: AppStagePage.tsx chat-drawer. Messages and scroll behavior use the current conversation.
import { useLayoutEffect,useRef,type ReactNode } from 'react';
import type { ChatMessage } from '../../types';
import { useDialogFocus } from './useDialogFocus';
import { runOrigin } from '../../services/schedule-text';
import { useSchedulesEnabled } from '../../hooks/use-schedules';
function summary(message:ChatMessage,enabled:boolean) {if(enabled && message.metadata?.type==='schedule_run')return runOrigin(message.metadata.name ?? '',message.metadata.dueAt ?? '');const plan=message.metadata?.plan;if(message.metadata?.type==='plan')return plan ? `Kế hoạch ${plan.steps.length} việc đã sẵn sàng: ${plan.summary}` : 'Kế hoạch đã sẵn sàng trên sân khấu chính.';
 if(['receipt','execution','execution_result','exec_done'].includes(message.metadata?.type ?? ''))return 'Biên nhận công việc đã có trên sân khấu chính.';
 return message.content;}
function ConversationLog({messages,streamingText,isStreaming}:{messages:ChatMessage[];streamingText?:string;isStreaming:boolean}) {
 const enabled=useSchedulesEnabled();
 const area=useRef<HTMLDivElement>(null),nearBottom=useRef(true);
 useLayoutEffect(()=>{if(area.current){if(!messages.length){area.current.scrollTop=0;nearBottom.current=true;}else if(nearBottom.current)area.current.scrollTop=area.current.scrollHeight;}},[messages.length,streamingText]);
 return <div ref={area} id="chat-messages-container" role="log" aria-live="polite" aria-label="Hội thoại" onScroll={event=>{const box=event.currentTarget;nearBottom.current=box.scrollHeight-box.clientHeight-box.scrollTop<120;}} className="flex-1 overflow-y-auto p-5 v3-space-y-4 text-xs sm:text-sm">
 {messages.map(message=>{const user=message.role==='user' && !(enabled && message.metadata?.type==='schedule_run'),highlight=['plan','receipt','execution','execution_result','exec_done'].includes(message.metadata?.type ?? ''),timestamp=message.timestamp ?? message.created_at;return <div key={message.id} className={`flex flex-col ${user ? 'items-end' : 'items-start'} v3-space-y-1`}>
 <span className="text-[11px] text-brand-muted">{user ? 'Bạn' : 'Planora'}{timestamp && Number.isFinite(Date.parse(timestamp)) && <> · <time dateTime={timestamp}>{new Date(timestamp).toLocaleString('vi-VN',{hour12:false})}</time></>}</span>
 <div className={user ? 'p-3 bg-[#111827] text-white rounded-2xl rounded-tr-none max-w-[85%] leading-relaxed' : highlight ? 'p-3 bg-[#FFF6EE] border border-[#F7D7BE] text-[#111827] rounded-2xl rounded-tl-none max-w-[88%] v3-space-y-2 leading-relaxed' : 'p-3 bg-[#F8F8F6] border border-[#EAEAE4] text-[#111827] rounded-2xl rounded-tl-none max-w-[88%] v3-space-y-2 leading-relaxed'}><p className={highlight ? 'font-semibold text-[#B43E00] [overflow-wrap:anywhere]' : 'whitespace-pre-wrap [overflow-wrap:anywhere]'}>{summary(message,enabled)}</p></div>
 {message.status==='sending' && <span className="text-[11px] text-brand-muted">Đang gửi…</span>}{message.status==='failed' && <span className="text-[11px] text-brand-danger">Gửi thất bại</span>}
 </div>;})}
 {isStreaming && <div className="flex flex-col items-start v3-space-y-1"><span className="text-[11px] text-brand-muted">Planora</span><div className="p-3 bg-[#F8F8F6] border border-[#EAEAE4] text-[#111827] rounded-2xl rounded-tl-none max-w-[88%] v3-space-y-2 leading-relaxed whitespace-pre-wrap">{streamingText || 'Đang xử lý…'}</div></div>}
 {!messages.length && !isStreaming && <p className="text-xs text-brand-muted">Chưa có tin nhắn nào</p>}
 </div>;
}
export function ConversationDrawer({messages,streamingText,isStreaming,composer,onClose}:{messages:ChatMessage[];streamingText?:string;isStreaming:boolean;composer:ReactNode;onClose:()=>void}){const dialog=useRef<HTMLElement>(null);useDialogFocus(dialog,onClose,'btn-open-chat');return (<aside ref={dialog} tabIndex={-1} aria-label="Nhật ký hội thoại" id="chat-drawer" className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-white border-l border-[#E5E5E0] shadow-2xl v3-transform transition-transform duration-300 ease-in-out flex flex-col`} role="dialog" aria-modal="true" aria-labelledby="chat-drawer-title">
        <div className="px-5 py-3.5 border-b border-[#EAEAE4] flex items-center justify-between bg-[#F8F8F6]">
          <div className="flex items-center gap-2">
            <h2 id="chat-drawer-title" className="font-sans font-semibold text-base text-[#111827]">
              Nhật ký hội thoại
            </h2>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#111827] hover:bg-neutral-200/70 transition-colors" aria-label="Đóng Nhật ký hội thoại">
            {' '}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            {' '}
          </button>
        </div>
        <ConversationLog messages={messages} streamingText={streamingText} isStreaming={isStreaming}/>
        {composer}
      </aside>);}
