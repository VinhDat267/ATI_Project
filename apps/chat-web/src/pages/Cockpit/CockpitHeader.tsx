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
  onNewConversation?: () => void;
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
  onNewConversation,
}: Props) {
  const [testExplainOpen, setTestExplainOpen] = useState(false);
  const hasActiveChat = !(moment === 1 && chatCount === 0);
  const actions = (
    <>
      <button
        id="btn-open-history"
        data-shell-compact-only
        type="button"
        aria-label="Mở danh sách hội thoại"
        title="Hội thoại gần đây"
        onClick={() => onHistory()}
        className="ps-action"
        aria-expanded={historyOpen ? 'true' : 'false'}
        aria-controls={historyOpen ? historyDialogId : undefined}
      >
        <svg
          aria-hidden="true"
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
        <span className="hidden sm:inline">Gần đây</span>
      </button>
      {/* Nút Xem hội thoại (Ẩn ở khoảnh khắc 1 khi chưa có tin nhắn; PBI-03: hội thoại đã lưu vẫn mở được) */}
      <button
        id="btn-open-chat"
        type="button"
        aria-label="Xem hội thoại"
        title="Xem nhật ký hội thoại hiện tại"
        onClick={() => onConversation()}
        className={`${!hasActiveChat ? 'hidden! ' : ''}ps-action`}
        aria-expanded={chatOpen ? 'true' : 'false'}
        aria-controls={chatOpen ? chatDialogId : undefined}
      >
        <svg
          aria-hidden="true"
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
        <span className="hidden sm:inline">Hội thoại</span>
        <span
          id="chat-count-badge"
          className="ps-count"
        >
          {chatCount}
        </span>
      </button>
    </>
  );
  return (
    <MainNav user={user} current="workspace" navigate={navigate} onLogout={onLogout} onOpenSettings={onSettings} actions={actions} onNewRequest={onNewConversation}>
      {runtimeMode === 'sandbox' && (
        <>
          <div
            id="test-mode-banner"
            role="status"
            className="ps-sandbox w-full"
          >
            <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-2 h-8 text-xs sm:text-[13px]">
              <div className="flex items-center gap-2 min-w-0">
                <span aria-hidden="true" className="ps-sandbox-dot" />
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
                className="flex-shrink-0 text-[#51463E] dark:text-[#D7CEC4] hover:text-[#1A0E08] dark:hover:text-[#F3EEE8] underline underline-offset-2 font-medium rounded px-1 py-0.5"
                aria-expanded={testExplainOpen ? 'true' : 'false'}
                aria-controls="test-mode-explanation"
              >
                {' Là gì? '}
              </button>
            </div>
            <div
              id="test-mode-explanation"
              className={`${testExplainOpen ? '' : 'hidden '}px-4 sm:px-6 pb-2 text-xs sm:text-[13px] leading-relaxed pt-1 max-w-5xl mx-auto`}
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
