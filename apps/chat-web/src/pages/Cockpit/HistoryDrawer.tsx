// Source: AppStagePage.tsx history-drawer; history loading, search and rename keep FE-02 ownership guards.
import { useRef } from 'react';
import { SidebarHistory } from '../../components/layout/SidebarHistory';
import { useDialogFocus } from './useDialogFocus';
export function HistoryDrawer({conversationId,onClose,onNewConversation,onSelectConversation}:{conversationId:string|null;onClose:()=>void;onNewConversation:()=>void;onSelectConversation:(id:string)=>void}){const dialog=useRef<HTMLElement>(null);useDialogFocus(dialog,onClose,'btn-open-history');return (<aside ref={dialog} tabIndex={-1} aria-label="Lịch sử yêu cầu" id="history-drawer" className={`fixed inset-y-0 left-0 z-50 w-full sm:w-[380px] bg-white border-r border-brand-border shadow-2xl v3-transform transition-transform duration-300 ease-in-out flex flex-col`} role="dialog" aria-modal="true" aria-labelledby="history-drawer-title">
        <div className="px-5 py-4 border-b border-brand-border flex items-center justify-between bg-neutral-50/50">
          <h2 id="history-drawer-title" className="font-display font-semibold text-lg text-brand-text">
            Lịch sử yêu cầu
          </h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors" aria-label="Đóng Lịch sử yêu cầu">
            {' '}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            {' '}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 v3-space-y-2 text-xs sm:text-sm">
          <button type="button" onClick={()=>{onClose();onNewConversation();}} className="w-full px-5 py-2.5 bg-brand-primary hover:bg-brand-primary-hover text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-all">Cuộc hội thoại mới</button>
          <SidebarHistory prototype currentConversationId={conversationId} onSelectConversation={onSelectConversation} onCloseMobileSidebar={onClose}/>
        </div>
      </aside>);}
