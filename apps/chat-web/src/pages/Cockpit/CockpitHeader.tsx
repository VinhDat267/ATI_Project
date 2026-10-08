// Markup/classes copied from AppStagePage.tsx:712-917, PROTO-01 #96.
// Demo user/menu/runtime are replaced with existing authenticated app behavior.
import { useState } from 'react';
import { UserNavMenu } from '../../components/layout/UserNavMenu';
import { useTheme } from '../../hooks/use-theme';
import type { User } from '../../types';
interface Props {
  moment: number | string;
  runtimeMode: 'sandbox' | 'live' | null;
  request: string;
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
  request,
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
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';
  const [testExplainOpen, setTestExplainOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-brand-border transition-all">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <a
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigate('/');
            }}
            className="flex items-center gap-2 group flex-shrink-0"
            title="Về đầu"
          >
            <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center text-white font-display font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
              A
            </div>
            <span className="font-display font-bold text-lg tracking-tight text-brand-text hidden sm:inline">
              ATI
            </span>
          </a>
          {/* Yêu cầu hiện tại (Ẩn ở khoảnh khắc 1) */}
          <div
            id="top-bar-query-container"
            className={`${moment === 1 ? 'hidden ' : ''}items-center gap-3 min-w-0 flex-1`}
          >
            <div className="h-4 w-px bg-brand-border flex-shrink-0" />
            <div className="flex items-center gap-2 text-xs sm:text-sm text-brand-muted truncate max-w-xl">
              <span className="px-1.5 py-0.5 rounded bg-[#EBECE7] text-brand-text font-medium text-[11px] flex-shrink-0">
                Yêu cầu hiện tại
              </span>
              <span
                id="top-bar-query"
                className="text-brand-text truncate font-normal"
                title={request}
                aria-label={request}
              >
                {request}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            id="btn-open-history"
            type="button"
            aria-label="Mở danh sách hội thoại"
            onClick={() => onHistory()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-text bg-white hover:bg-neutral-100 rounded-lg border border-brand-border shadow-sm transition-colors"
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
            <span className="hidden sm:inline">Lịch sử</span>
          </button>
          {/* Nút Xem hội thoại (Ẩn ở khoảnh khắc 1, NHÓM 5 thay py-0.2 -> py-[2px]) */}
          <button
            id="btn-open-chat"
            type="button"
            aria-label="Xem hội thoại"
            onClick={() => onConversation()}
            className={`${moment === 1 ? 'hidden! ' : ''}inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-brand-text hover:bg-black rounded-lg shadow-sm transition-all`}
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
            <span className="hidden sm:inline">Xem hội thoại</span>
            <span
              id="chat-count-badge"
              className="px-1.5 py-[2px] bg-white/20 rounded-full text-[10px] font-bold"
            >
              {chatCount}
            </span>
          </button>
          {/* Nút Theme Toggle Sáng / Tối */}
          <button
            id="btn-theme-toggle"
            type="button"
            onClick={() => toggleTheme()}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-brand-text bg-white hover:bg-neutral-100 border border-brand-border shadow-sm transition-colors focus:v3-outline-none"
            aria-label={
              dark ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'
            }
            title={
              dark ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'
            }
          >
            {/* Icon Mặt trăng (hiển thị khi đang ở theme Sáng) */}
            <svg
              id="theme-icon-moon"
              className="w-4 h-4 text-brand-muted block dark:hidden"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
            {/* Icon Mặt trời (hiển thị khi đang ở theme Tối) */}
            <svg
              id="theme-icon-sun"
              className="w-4 h-4 text-amber-400 hidden dark:block"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          </button>
          <UserNavMenu
            variant="prototype"
            user={user}
            navigate={navigate}
            onOpenSettings={onSettings}
            onOpenAccount={() => navigate('/account')}
            onManageUsers={() => navigate('/admin/users')}
            onLogout={onLogout}
          />
        </div>
      </div>
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
    </header>
  );
}
