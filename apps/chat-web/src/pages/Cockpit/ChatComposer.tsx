// Source: AppStagePage.tsx global-bottom-bar, moment-4-inline-chat and chat-drawer input.
import { useLayoutEffect, useRef, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
export interface ComposerProps {variant:'bottom'|'inline'|'drawer'|'response';draft:string;planning:boolean;input:RefObject<HTMLTextAreaElement|null>;onDraft:(value:string)=>void;onSend:(value:string)=>void;onKeyDown:(event:KeyboardEvent<HTMLTextAreaElement>)=>void;onClose?:()=>void}
export function ChatComposer({variant,draft,planning,input,onDraft,onSend,onKeyDown,onClose}:ComposerProps) {
 const footer=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
   if(!['bottom','response'].includes(variant) || !footer.current)return;
   const update=()=>document.documentElement.style.setProperty('--cockpit-bottom-space',`${Math.max(96,footer.current!.getBoundingClientRect().height+16)}px`);
   update(); const observer=typeof ResizeObserver==='undefined' ? null : new ResizeObserver(update);observer?.observe(footer.current);
   return ()=>{observer?.disconnect();document.documentElement.style.removeProperty('--cockpit-bottom-space');};
 },[variant,draft]);
 useLayoutEffect(()=>{const field=input.current;if(field){field.style.height='auto';field.style.height=`${Math.min(field.scrollHeight || 28,144)}px`;}},[draft,input,variant]);
 const submit=(event:FormEvent)=>{event.preventDefault();onSend(draft);};
 // ResponsesPage footer, retaining the app's multiline textarea and shared draft.
 if(variant==='response') return <footer ref={footer} id="global-bottom-bar" className="fixed bottom-0 left-0 right-0 z-30 bg-[#F8F8F6] border-t border-[#E5E5E0] px-4 py-3">
   <div className="max-w-3xl mx-auto">
     <form id="chat-input-form" aria-label="Nhập yêu cầu" aria-busy={planning} onSubmit={submit} className="relative flex items-center gap-2">
       <label htmlFor="chat-prompt-input" className="sr-only">Nhắn cho Planora</label>
       <textarea ref={input} rows={1} id="chat-prompt-input" value={draft} onChange={event=>onDraft(event.target.value)} onKeyDown={onKeyDown} aria-label="Mô tả công việc bạn muốn thực hiện" placeholder="Nhắn cho Planora…" autoComplete="off" className="w-full bg-white border border-[#E5E5E0] rounded-xl px-4 py-3 pr-24 text-xs sm:text-sm text-[#111827] placeholder-[#6B7280] shadow-2xs !outline-none focus-visible:!outline-none focus:border-[#111827] transition-all resize-none" />
       <button type="submit" id="btn-submit-chat" aria-label="Gửi tin nhắn" disabled={!draft.trim() || planning} className="absolute right-2 px-3.5 py-1.5 bg-[#FF5701] hover:bg-[#E04D00] text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors flex items-center gap-1.5"><span>Gửi</span><svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg></button>
     </form>
     <p className="text-[11px] text-[#6B7280] text-center mt-1.5">Planora chỉ đọc và ghi ở những nơi bạn cho phép. Chưa duyệt thì chưa làm. · <a href="/privacy" className="text-[#B43E00] hover:underline font-medium">Chính sách an toàn &amp; Dữ liệu</a></p>
   </div>
 </footer>;
 if(variant==='inline') return (<form aria-label="Nhập yêu cầu" onSubmit={submit} id="moment-4-inline-chat" className={`mb-3 p-2 bg-white rounded-xl border border-brand-border shadow-soft-card flex items-center gap-2 transition-all`}>
              <textarea ref={input} rows={1} value={draft} onChange={event=>onDraft(event.target.value)} aria-label="Mô tả công việc bạn muốn thực hiện" id="moment-4-chat-input" className="flex-1 text-xs sm:text-sm text-brand-text placeholder-neutral-500 bg-transparent border-0 focus:ring-0 !outline-none focus-visible:!outline-none px-2 py-1" placeholder="Bạn muốn sửa điều gì?" onKeyDown={onKeyDown} />
              <button type="submit" disabled={!draft.trim() || planning} className="px-3.5 py-1.5 bg-brand-text hover:bg-black text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1">
                <span>
                  Gửi
                </span>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
              <button type="button" onClick={onClose} className="p-1.5 text-neutral-500 hover:text-neutral-700 rounded-lg hover:bg-neutral-100 transition-colors" aria-label="Đóng ô sửa">
                {' '}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {' '}
              </button>
            </form>);
 if(variant==='drawer') return (<div className="p-4 border-t border-brand-border bg-[#F8F8F6]">
          <form aria-label="Nhập yêu cầu" onSubmit={submit} className="flex items-center gap-2">
            <textarea ref={input} rows={1} value={draft} onChange={event=>onDraft(event.target.value)} aria-label="Mô tả công việc bạn muốn thực hiện" id="drawer-chat-input" className="flex-1 px-3 py-2 bg-white rounded-xl border border-[#E5E5E0] text-xs sm:text-sm !outline-none focus-visible:!outline-none focus:border-[#111827]" placeholder="Nhắn tiếp trong phiên này…" onKeyDown={onKeyDown} />
            <button type="submit" disabled={!draft.trim() || planning} className="p-2 bg-[#C84300] text-white rounded-xl hover:bg-[#A83800] disabled:bg-neutral-200 disabled:text-neutral-500 transition-colors" aria-label="Gửi tin nhắn">
              {' '}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {' '}
            </button>
          </form>
        </div>);
 return (<footer ref={footer} id="global-bottom-bar" className={`fixed bottom-0 left-0 right-0 z-20 bg-[#F8F8F6] border-t border-[#E5E5E0] py-3 px-4 sm:px-6`}>
        <div className={`${planning ? 'max-w-2xl' : 'max-w-3xl'} mx-auto`}>
          <form aria-label="Nhập yêu cầu" aria-busy={planning} onSubmit={submit} className="bg-white rounded-xl border border-[#E2E2DC] shadow-2xs px-3 py-2 flex items-center gap-2.5 focus-within:border-[#B8B8B0] transition-colors">
            <label htmlFor="bottom-chat-input" className="sr-only">
              Nhắn thêm với tôi
            </label>
            <textarea
              ref={input}
              id="bottom-chat-input"
              rows={1}
              spellCheck={false}
              value={draft}
              onChange={event=>onDraft(event.target.value)}
              aria-label="Mô tả công việc bạn muốn thực hiện"
              className="flex-1 text-sm text-[#111827] placeholder-[#6B7280] bg-transparent border-0 focus:ring-0 !outline-none focus-visible:!outline-none px-1.5 py-1 resize-none"
              placeholder={
                planning
                  ? 'Gõ sẵn ý muốn bổ sung (sẽ gửi được ngay khi kế hoạch hiện ra)…'
                  : 'Nhắn tiếp để bổ sung chi tiết hoặc giao việc tiếp theo…'
              }
              onKeyDown={onKeyDown}
            />
            <button
              type="submit"
              disabled={!draft.trim() || planning}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex-shrink-0 flex items-center gap-1.5 !opacity-100 ${
                planning
                  ? 'bg-[#F4F4F1] text-[#4B5563] border border-[#E5E5E0] cursor-not-allowed'
                  : !draft.trim()
                  ? 'bg-[#F4F4F1] text-[#6B7280] border border-[#EAEAE4] cursor-not-allowed'
                  : 'bg-[#C84300] hover:bg-[#A83800] text-white shadow-2xs cursor-pointer'
              }`}
              aria-label="Gửi tin nhắn"
            >
              <span>{planning ? 'Đang xử lý…' : 'Gửi'}</span>
              {!planning && (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              )}
            </button>
          </form>
        </div>
      </footer>);
}
