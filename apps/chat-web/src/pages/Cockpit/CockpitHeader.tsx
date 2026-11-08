// Markup/classes copied from AppStagePage.tsx:712-917, PROTO-01 #96.
// Demo user/menu/runtime are replaced with existing authenticated app behavior.
// FE-12: the bar itself is the shared MainNav; this header adds the two drawer buttons and the sandbox strip.
// The current request moved out of the bar into each moment (RequestEcho).
import { useState } from 'react';
import { MainNav } from '../../components/layout/MainNav';
import type { User } from '../../types';
interface Props {
  moment: number | string;
  runtimeMode: 'sandbox' | 'live' | null;
  messageCount: number;
  historyOpen: boolean;
  chatOpen: boolean;
  historyDialogId?: string;
  chatDialogId?: string;
  user: User | null;
  navigate: (path: string) => void;
  onLogout: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onConversation: () => void;
}
export function CockpitHeader({
  moment,
  runtimeMode,
  messageCount: chatCount,
  historyOpen,
  chatOpen,
  historyDialogId,
  chatDialogId,
  user,
  navigate,
  onLogout,
  onSettings,
  onHistory,
  onConversation,
}: Props) {
  const [testExplainOpen, setTestExplainOpen] = useState(false);
  const hasActiveChat = !(moment === 1 && chatCount === 0);
  const actions = (
    <>
      <button
        id="btn-open-history"
        type="button"
        aria-label="Mở danh sách hội thoại"
        title="Hội thoại gần đây"
        onClick={() => onHistory()}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 whitespace-nowrap text-xs font-medium text-brand-text bg-white hover:bg-neutral-100 rounded-xl border border-brand-border shadow-2xs transition-colors cursor-pointer"
        aria-expanded={historyOpen ? 'true' : 'false'}
        aria-controls={historyOpen ? historyDialogId : undefined}
      >
        <svg
          className="w-3.5 h-3.5 text-brand-muted flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
          />
        </svg>
        <span className={hasActiveChat ? 'hidden 2xl:inline' : 'hidden xl:inline'}>
          Hội thoại gần đây
        </span>
      </button>
      {/* Nút Xem hội thoại (Ẩn ở khoảnh khắc 1 khi chưa có tin nhắn; PBI-03: hội thoại đã lưu vẫn mở được) */}
      <button
        id="btn-open-chat"
        type="button"
        aria-label="Xem hội thoại"
        title="Xem nhật ký hội thoại hiện tại"
        onClick={() => onConversation()}
        className={`${!hasActiveChat ? 'hidden! ' : ''}inline-flex items-center gap-1.5 px-2.5 py-1.5 whitespace-nowrap text-xs font-medium text-white bg-brand-text hover:bg-black rounded-xl shadow-2xs transition-all cursor-pointer`}
        aria-expanded={chatOpen ? 'true' : 'false'}
        aria-controls={chatOpen ? chatDialogId : undefined}
      >
        <svg
          className="w-3.5 h-3.5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <span className="hidden xl:inline 2xl:hidden">Hội thoại</span>
        <span className="hidden 2xl:inline">Xem hội thoại</span>
        <span
          id="chat-count-badge"
          className="px-1.5 py-[2px] bg-white/20 rounded-full text-[10px] font-bold"
        >
          {chatCount}
        </span>
      </button>
    </>
  );
  return (
    <MainNav user={user} current="workspace" navigate={navigate} onLogout={onLogout} onOpenSettings={onSettings} actions={actions}>
      {runtimeMode === 'sandbox' && (
        <>
          <div
            id="test-mode-banner"
            role="status"
            className={`w-full bg-[#FEF9C3] border-t border-amber-200/80 text-amber-900 transition-all`}
          >
            <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-2 h-8 text-[11px] sm:text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <svg
                  className="w-3.5 h-3.5 text-amber-700 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="font-medium sm:hidden">
                  Thử nghiệm · không gọi dịch vụ thật
                </span>
                <span className="font-medium hidden sm:inline">
                  Chế độ thử nghiệm: kế hoạch mẫu, không gọi dịch vụ thật
                </span>
              </div>
              <button
                id="btn-toggle-test-mode-explain"
                type="button"
                onClick={() => setTestExplainOpen(!testExplainOpen)}
                className="flex-shrink-0 text-amber-800 hover:text-amber-950 underline underline-offset-2 font-medium focus:v3-outline-none focus:ring-1 focus:ring-amber-500 rounded px-1 py-0.5"
                aria-expanded={testExplainOpen ? 'true' : 'false'}
                aria-controls="test-mode-explanation"
              >
                {' Là gì? '}
              </button>
            </div>
            <div
              id="test-mode-explanation"
              className={`${testExplainOpen ? '' : 'hidden '}px-4 sm:px-6 pb-2 text-[11px] sm:text-xs text-amber-800 leading-relaxed border-t border-amber-200/60 pt-1.5 max-w-5xl mx-auto`}
            >
              Máy chủ đang chạy thử: Planora dùng kế hoạch soạn sẵn và không ghi gì
              lên Trello, Slack hay các công cụ khác. Chế độ do máy chủ quyết
              định khi khởi động.
            </div>
          </div>
        </>
      )}
    </MainNav>
  );
}
