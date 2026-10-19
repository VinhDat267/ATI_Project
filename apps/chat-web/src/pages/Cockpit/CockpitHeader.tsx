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
  const actions = (
    <>
      <button
        id="btn-open-history"
        type="button"
        aria-label="Mở danh sách hội thoại"
        onClick={() => onHistory()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 whitespace-nowrap text-xs font-medium text-brand-text bg-white hover:bg-neutral-100 rounded-lg border border-brand-border shadow-sm transition-colors"
        aria-expanded={historyOpen ? 'true' : 'false'}
        aria-controls={historyOpen ? historyDialogId : undefined}
      >
        <svg
          className="w-3.5 h-3.5 text-brand-muted"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className="hidden xl:inline">Lịch sử</span>
      </button>
      {/* Nút Xem hội thoại (Ẩn ở khoảnh khắc 1, NHÓM 5 thay py-0.2 -> py-[2px]) */}
      <button
        id="btn-open-chat"
        type="button"
        aria-label="Xem hội thoại"
        onClick={() => onConversation()}
        className={`${moment === 1 ? 'hidden! ' : ''}inline-flex items-center gap-1.5 px-3 py-1.5 whitespace-nowrap text-xs font-medium text-white bg-brand-text hover:bg-black rounded-lg shadow-sm transition-all`}
        aria-expanded={chatOpen ? 'true' : 'false'}
        aria-controls={chatOpen ? chatDialogId : undefined}
      >
        <svg
          className="w-3.5 h-3.5"
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
        <span className="hidden xl:inline">Xem hội thoại</span>
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
              Máy chủ đang chạy thử: ATI dùng kế hoạch soạn sẵn và không ghi gì
              lên Trello, Slack hay các công cụ khác. Chế độ do máy chủ quyết
              định khi khởi động.
            </div>
          </div>
        </>
      )}
    </MainNav>
  );
}
