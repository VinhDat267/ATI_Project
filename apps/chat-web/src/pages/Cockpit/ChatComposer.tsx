// Source: AppStagePage.tsx global-bottom-bar, moment-4-inline-chat and chat-drawer input.
import { useLayoutEffect, useRef, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
export interface ComposerProps {variant:'bottom'|'inline'|'drawer';draft:string;planning:boolean;input:RefObject<HTMLTextAreaElement|null>;onDraft:(value:string)=>void;onSend:(value:string)=>void;onKeyDown:(event:KeyboardEvent<HTMLTextAreaElement>)=>void;onClose?:()=>void}
export function ChatComposer({variant,draft,planning,input,onDraft,onSend,onKeyDown,onClose}:ComposerProps) {
 const footer=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
   if(variant!=='bottom' || !footer.current)return;
   const update=()=>document.documentElement.style.setProperty('--cockpit-bottom-space',`${Math.max(96,footer.current!.getBoundingClientRect().height+16)}px`);
   update(); const observer=typeof ResizeObserver==='undefined' ? null : new ResizeObserver(update);observer?.observe(footer.current);
   return ()=>{observer?.disconnect();document.documentElement.style.removeProperty('--cockpit-bottom-space');};
 },[variant,draft]);
 useLayoutEffect(()=>{const field=input.current;if(field){field.style.height='auto';field.style.height=`${Math.min(field.scrollHeight || 28,144)}px`;}},[draft,input,variant]);
 const submit=(event:FormEvent)=>{event.preventDefault();onSend(draft);};
 if(variant==='inline') return (<form aria-label="Nhập yêu cầu" onSubmit={submit} id="moment-4-inline-chat" className={`mb-3 p-2 bg-white rounded-xl border border-brand-border shadow-soft-card flex items-center gap-2 transition-all`}>
              <textarea ref={input} rows={1} value={draft} onChange={event=>onDraft(event.target.value)} aria-label="Mô tả công việc bạn muốn thực hiện" id="moment-4-chat-input" className="flex-1 text-xs sm:text-sm text-brand-text placeholder-neutral-400 bg-transparent border-0 focus:ring-0 focus:v3-outline-none px-2 py-1" placeholder="Bạn muốn sửa điều gì?" onKeyDown={onKeyDown} />
              <button type="submit" disabled={!draft.trim() || planning} className="px-3.5 py-1.5 bg-brand-text hover:bg-black text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1">
                <span>
                  Gửi
                </span>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
              <button type="button" onClick={onClose} className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-100 transition-colors" aria-label="Đóng ô sửa">
                {' '}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {' '}
              </button>
            </form>);
 if(variant==='drawer') return (<div className="p-4 border-t border-brand-border bg-neutral-50/50">
          <form aria-label="Nhập yêu cầu" onSubmit={submit} className="flex items-center gap-2">
            <textarea ref={input} rows={1} value={draft} onChange={event=>onDraft(event.target.value)} aria-label="Mô tả công việc bạn muốn thực hiện" id="drawer-chat-input" className="flex-1 px-3 py-2 bg-white rounded-xl border border-brand-border text-xs sm:text-sm focus:v3-outline-none focus:border-brand-primary" placeholder="Nhắn tiếp trong phiên này…" onKeyDown={onKeyDown} />
            <button type="submit" disabled={!draft.trim() || planning} className="p-2 bg-brand-primary text-white rounded-xl hover:bg-brand-primary-hover transition-colors" aria-label="Gửi tin nhắn">
              {' '}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {' '}
            </button>
          </form>
        </div>);
 return (<footer ref={footer} id="global-bottom-bar" className={`fixed bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-[#F8F8F6] via-[#F8F8F6]/95 to-transparent pt-6 pb-4 px-4 sm:px-6 pointer-events-none`}>
        <div className="max-w-3xl mx-auto pointer-events-auto">
          <form aria-label="Nhập yêu cầu" aria-busy={planning} onSubmit={submit} className="bg-white rounded-2xl border border-brand-border shadow-elevated p-2 sm:p-2.5 flex items-center gap-2 focus-within:border-brand-primary focus-within:shadow-orange-glow transition-all">
            <div className="p-2 text-brand-muted hidden sm:block">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <label htmlFor="bottom-chat-input" className="sr-only">
              Nhắn thêm với tôi
            </label>
            <textarea ref={input} id="bottom-chat-input" rows={1} value={draft} onChange={event=>onDraft(event.target.value)} aria-label="Mô tả công việc bạn muốn thực hiện" className="flex-1 text-sm sm:text-base text-brand-text placeholder-neutral-400 bg-transparent border-0 focus:ring-0 focus:v3-outline-none px-2 py-1" placeholder="Nhắn thêm với tôi để sửa kế hoạch hoặc thêm chi tiết..." onKeyDown={onKeyDown} />
            <button type="submit" disabled={!draft.trim() || planning} className="px-4 py-2 bg-neutral-900 hover:bg-black text-white text-xs sm:text-sm font-medium rounded-xl transition-colors flex-shrink-0 flex items-center gap-1.5" aria-label="Gửi tin nhắn">
              <span>
                Gửi
              </span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </form>
        </div>
      </footer>);
}
