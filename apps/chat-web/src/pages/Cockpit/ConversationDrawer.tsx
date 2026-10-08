// Source: AppStagePage.tsx chat-drawer. Messages and scroll behavior use the current conversation.
import { useLayoutEffect,useRef,type ReactNode } from 'react';
import type { ChatMessage } from '../../types';
import { useDialogFocus } from './useDialogFocus';
function summary(message:ChatMessage) {const plan=message.metadata?.plan;if(message.metadata?.type==='plan')return plan ? `Kế hoạch ${plan.steps.length} việc đã sẵn sàng: ${plan.summary}` : 'Kế hoạch đã sẵn sàng trên sân khấu chính.';
 if(['receipt','execution','execution_result','exec_done'].includes(message.metadata?.type ?? ''))return 'Biên nhận công việc đã có trên sân khấu chính.';
 return message.content;}
function ConversationLog({messages,streamingText,isStreaming}:{messages:ChatMessage[];streamingText?:string;isStreaming:boolean}) {
 const area=useRef<HTMLDivElement>(null),nearBottom=useRef(true);
 useLayoutEffect(()=>{if(area.current){if(!messages.length){area.current.scrollTop=0;nearBottom.current=true;}else if(nearBottom.current)area.current.scrollTop=area.current.scrollHeight;}},[messages.length,streamingText]);
 return <div ref={area} id="chat-messages-container" role="log" aria-live="polite" aria-label="Hội thoại" onScroll={event=>{const box=event.currentTarget;nearBottom.current=box.scrollHeight-box.clientHeight-box.scrollTop<120;}} className="flex-1 overflow-y-auto p-5 v3-space-y-4 text-xs sm:text-sm">
 {messages.map(message=>{const user=message.role==='user',highlight=['plan','receipt','execution','execution_result','exec_done'].includes(message.metadata?.type ?? ''),timestamp=message.timestamp ?? message.created_at;return <div key={message.id} className={`flex flex-col ${user ? 'items-end' : 'items-start'} v3-space-y-1`}>
 <span className="text-[11px] text-brand-muted">{user ? 'Bạn' : 'ATI'}{timestamp && Number.isFinite(Date.parse(timestamp)) && <> · <time dateTime={timestamp}>{new Date(timestamp).toLocaleString('vi-VN',{hour12:false})}</time></>}</span>
 <div className={user ? 'p-3 bg-neutral-900 text-white rounded-2xl rounded-tr-none max-w-[85%] leading-relaxed' : highlight ? 'p-3 bg-[#FFF5ED] border border-[#FFDEC9] text-brand-text rounded-2xl rounded-tl-none max-w-[88%] v3-space-y-2 leading-relaxed' : 'p-3 bg-neutral-100 text-brand-text rounded-2xl rounded-tl-none max-w-[88%] v3-space-y-2 leading-relaxed'}><p className={highlight ? 'font-semibold text-brand-primary' : 'whitespace-pre-wrap'}>{summary(message)}</p></div>
 {message.status==='sending' && <span className="text-[11px] text-brand-muted">Đang gửi…</span>}{message.status==='failed' && <span className="text-[11px] text-brand-danger">Gửi thất bại</span>}
 </div>;})}
 {isStreaming && <div className="flex flex-col items-start v3-space-y-1"><span className="text-[11px] text-brand-muted">ATI</span><div className="p-3 bg-neutral-100 text-brand-text rounded-2xl rounded-tl-none max-w-[88%] v3-space-y-2 leading-relaxed whitespace-pre-wrap">{streamingText || 'Đang xử lý…'}</div></div>}
 {!messages.length && !isStreaming && <p className="text-xs text-brand-muted">Chưa có tin nhắn nào</p>}
 </div>;
}
export function ConversationDrawer({messages,streamingText,isStreaming,composer,onClose}:{messages:ChatMessage[];streamingText?:string;isStreaming:boolean;composer:ReactNode;onClose:()=>void}){const dialog=useRef<HTMLElement>(null);useDialogFocus(dialog,onClose,'btn-open-chat');return (<aside ref={dialog} tabIndex={-1} aria-label="Nhật ký hội thoại" id="chat-drawer" className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] bg-white border-l border-brand-border shadow-2xl v3-transform transition-transform duration-300 ease-in-out flex flex-col`} role="dialog" aria-modal="true" aria-labelledby="chat-drawer-title">
        <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between bg-neutral-50/50">
          <div className="flex items-center gap-2">
            <h2 id="chat-drawer-title" className="font-display font-semibold text-lg text-brand-text">
              Nhật ký hội thoại
            </h2>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors" aria-label="Đóng Nhật ký hội thoại">
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
