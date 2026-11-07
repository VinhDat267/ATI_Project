import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import { MainNav } from '../../components/layout/MainNav';
import type { User, Conversation } from '../../types';
import css from './page.css?inline';
import { useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatConversationTime } from '../../services/conversation-time';
import { useHistory } from './useHistory';
import { ScheduleSection } from './ScheduleSection';

function statusBadgeClass(status?: string): string {
  if (status === 'completed') {
    return 'bg-[var(--planora-success-bg)] text-[var(--planora-success-text)] border-[var(--planora-success-border)]';
  }
  if (status === 'partial' || status === 'failed' || status === 'reconciliation_required') {
    return 'bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border-[var(--planora-pending-border)]';
  }
  if (status === 'executing' || status === 'planning' || status === 'chatting') {
    return 'bg-[var(--planora-surface-inset)] text-[var(--planora-primary)] border-[var(--planora-divider)]';
  }
  return 'bg-[var(--planora-surface-inset)] text-[var(--planora-muted)] border-[var(--planora-divider)]';
}

function RequestCard({
  req,
  isEditing,
  actions,
  title,
  saving,
}: {
  req: HistoryRow;
  isEditing: boolean;
  actions: CardActions;
  title: string;
  saving: boolean;
}) {
  const rawTitle = req.title || 'Hội thoại mới';
  const displayTitle = rawTitle.length > 60 ? rawTitle.slice(0, 60) + '…' : rawTitle;

  return (
    <article className="p-4 sm:p-5 rounded-2xl bg-[var(--planora-paper)] border border-[var(--planora-divider)] shadow-xs hover:border-[var(--planora-border-strong)] transition-all group">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        {/* Cụm trái: Trạng thái, Thời gian, Tiêu đề hội thoại */}
        <div className="v3-space-y-2 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${statusBadgeClass(req.status)}`}>
              {req.statusLabel}
            </span>
            <span className="text-[var(--planora-muted)]">·</span>
            <span className="text-[var(--planora-muted)] font-medium">{req.timeStr}</span>
          </div>

          {/* Tiêu đề hội thoại (hoặc ô nhập đổi tên inline) */}
          {isEditing ? (
            <div className="v3-space-y-1.5 py-0.5" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  aria-label="Tiêu đề hội thoại"
                  id={`rename-input-${req.id}`}
                  type="text"
                  maxLength={60}
                  value={title}
                  onChange={(event) => actions.setTitle(event.target.value)}
                  onKeyDown={(event) => actions.handleRenameKey(event, req.id)}
                  className="flex-1 min-w-0 text-sm sm:text-base font-semibold text-[var(--planora-text)] px-3 py-1.5 border-2 border-[var(--planora-primary)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--planora-primary)]/20 bg-[var(--planora-paper)] shadow-xs"
                  placeholder="Nhập tiêu đề hội thoại (tối đa 60 ký tự)"
                />
                <button
                  type="button"
                  onClick={() => actions.saveInlineRename(req.id)}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[var(--planora-primary)] hover:bg-[var(--planora-primary-hover)] text-[var(--planora-on-primary)] transition-colors shadow-xs flex-shrink-0 cursor-pointer disabled:opacity-50"
                >
                  Lưu
                </button>
                <button
                  type="button"
                  onClick={() => actions.cancelInlineRename()}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-xl text-[var(--planora-muted)] hover:text-[var(--planora-text)] hover:bg-[var(--planora-surface-inset)] transition-colors flex-shrink-0 cursor-pointer"
                >
                  Huỷ
                </button>
              </div>
              <div className="text-[11px] text-[var(--planora-muted)] flex items-center gap-2">
                <span>
                  {'Nhấn '}
                  <kbd className="px-1.5 py-0.5 bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] rounded text-[10px] font-mono text-[var(--planora-text)]">
                    Enter
                  </kbd>
                  {' để lưu, '}
                  <kbd className="px-1.5 py-0.5 bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] rounded text-[10px] font-mono text-[var(--planora-text)]">
                    Esc
                  </kbd>
                  {' để huỷ'}
                </span>
                <span className="text-[var(--planora-muted)]">·</span>
                <span>Tối đa 60 ký tự</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-serif text-sm sm:text-base font-semibold text-[var(--planora-text)] group-hover:text-[var(--planora-primary)] transition-colors leading-snug">
                {displayTitle}
              </h3>
              <button
                type="button"
                onClick={(event) => actions.startInlineRename(req.id, event)}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[var(--planora-muted)] hover:text-[var(--planora-primary)] hover:bg-[var(--planora-surface-inset)] rounded-lg transition-colors cursor-pointer"
                id={`rename-button-${req.id}`}
                aria-label={`Đổi tên ${rawTitle}`}
                title="Đổi tên hội thoại"
              >
                <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
                <span className="text-[11px] font-medium">Đổi tên</span>
              </button>
            </div>
          )}
        </div>

        {/* Cụm phải: Nút mở hội thoại */}
        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-3 flex-shrink-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-[var(--planora-divider)]">
          <div className="flex items-center gap-2">
            <a
              href={`/c/${encodeURIComponent(req.id)}`}
              onClick={(event) => {
                event.preventDefault();
                actions.openConversation(req.id);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl bg-[var(--planora-paper)] group-hover:bg-[var(--planora-primary)] text-[var(--planora-text)] group-hover:text-[var(--planora-on-primary)] border border-[var(--planora-divider)] group-hover:border-transparent transition-all shadow-xs cursor-pointer"
            >
              <span>Mở hội thoại</span>
              <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

export const meta: PageMeta = {
  id: 'history',
  title: 'Nhật ký điều phối & Lịch sử yêu cầu — Planora',
  htmlClass: '',
  bodyClass: 'min-h-screen flex flex-col bg-[var(--planora-canvas)] text-[var(--planora-text)]',
  css,
};

type HistoryRow = Conversation & { timeStr: string; dateGroup: string; statusLabel: string };
type CardActions = {
  startInlineRename: (id: string, event: ReactMouseEvent) => void;
  handleRenameKey: (event: ReactKeyboardEvent, id: string) => void;
  saveInlineRename: (id: string) => void;
  cancelInlineRename: () => void;
  openConversation: (id: string) => void;
  setTitle: (value: string) => void;
};

const GROUPS = [
  { key: 'today', title: 'Hôm nay' },
  { key: 'yesterday', title: 'Hôm qua' },
  { key: 'older', title: 'Trước đó' },
];

const STATUS_LABEL: Record<string, string> = {
  chatting: 'Đang trao đổi',
  planning: 'Đang lập kế hoạch',
  completed: 'Hoàn thành',
  executing: 'Đang chạy',
  partial: 'Cần xử lý',
  failed: 'Cần xử lý',
  reconciliation_required: 'Cần đối soát',
  stopped: 'Đã dừng',
  rejected: 'Đã từ chối',
};

export interface HistoryPageProps {
  user: User | null;
  navigate: (path: string) => void;
  onLogout: () => void;
}

export function HistoryPage({ user, navigate, onLogout }: HistoryPageProps) {
  usePrototypePage(meta);
  const {
    rows,
    search,
    setSearch,
    cursor,
    loading,
    error,
    notice,
    editing,
    title,
    setTitle,
    saving,
    edit,
    cancel,
    rename,
    loadMore,
  } = useHistory(user);

  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'needs_action' | 'chatting'>('all');
  const role = user?.role ?? 'member';
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const yesterday = new Date(day);
  yesterday.setDate(yesterday.getDate() - 1);

  const allDisplayed: HistoryRow[] = rows.map((row) => {
    const value = row.updatedAt ?? row.updated_at ?? row.created_at;
    const time = value ? new Date(value).getTime() : NaN;
    return {
      ...row,
      timeStr: formatConversationTime(value),
      dateGroup: time >= day.getTime() ? 'today' : time >= yesterday.getTime() ? 'yesterday' : 'older',
      statusLabel: STATUS_LABEL[row.status ?? ''] ?? 'Hội thoại',
    };
  });

  const displayed = allDisplayed.filter((row) => {
    if (statusFilter === 'completed') return row.status === 'completed';
    if (statusFilter === 'needs_action')
      return row.status === 'partial' || row.status === 'failed' || row.status === 'reconciliation_required';
    if (statusFilter === 'chatting')
      return !row.status || row.status === 'chatting' || row.status === 'planning' || row.status === 'executing';
    return true;
  });

  const actions: CardActions & { loadMoreRequests: () => void } = {
    startInlineRename(id, event) {
      event.stopPropagation();
      edit(id);
    },
    handleRenameKey(event, id) {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        void rename(id);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    },
    saveInlineRename(id) {
      void rename(id);
    },
    cancelInlineRename: cancel,
    setTitle,
    openConversation(id) {
      navigate(`/c/${encodeURIComponent(id)}`);
    },
    loadMoreRequests: loadMore,
  };

  return (
    <>
      <MainNav user={user} current="history" pageName="Nhật ký" navigate={navigate} onLogout={onLogout} />

      {/* NỘI DUNG CHÍNH */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 v3-space-y-6">
        {error && <p role="alert" className="text-sm text-[var(--planora-error-text)]">{error}</p>}
        {notice && <p role="status" className="text-xs text-[var(--planora-success-text)]">{notice}</p>}
        {loading && <p role="status" className="text-xs text-[var(--planora-muted)]">Đang tải hội thoại...</p>}

        {/* KHỐI TIÊU ĐỀ & NGUYÊN TẮC AN TOÀN */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--planora-divider)] pb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--planora-surface-inset)] text-[var(--planora-text)] border border-[var(--planora-divider)]">
                <svg aria-hidden="true" className="w-3 h-3 text-[var(--planora-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {' Nhật ký điều phối'}
              </span>
              <span id="requests-count-badge" className="text-xs text-[var(--planora-muted)]">
                {`${rows.length} hội thoại đã tải`}
              </span>
            </div>
            <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[var(--planora-text)]">
              Nhật ký điều phối &amp; Lịch sử yêu cầu
            </h1>
            <p className="text-sm text-[var(--planora-muted)] mt-1.5 max-w-2xl leading-relaxed">
              Lịch sử hội thoại của bạn. Tìm theo tiêu đề, đổi tên và mở lại hội thoại để tiếp tục công việc.
            </p>
          </div>

          {/* Nút hành động nhanh */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href="/"
              onClick={(event) => {
                event.preventDefault();
                navigate('/');
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-xl bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)] shadow-xs hover:shadow transition-all cursor-pointer"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              <span>Gõ yêu cầu mới</span>
            </a>
          </div>
        </div>

        {/* NGUYÊN TẮC AN TOÀN */}
        <div className="p-4 rounded-2xl bg-[var(--planora-paper)] border border-[var(--planora-divider)] shadow-xs flex items-start gap-3.5">
          <div className="w-8 h-8 rounded-xl bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] flex items-center justify-center flex-shrink-0 text-[var(--planora-primary)] mt-0.5">
            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <div className="text-xs sm:text-sm text-[var(--planora-muted)] leading-relaxed">
            <strong className="text-[var(--planora-text)] font-semibold">Minh bạch &amp; An toàn dữ liệu:</strong>
            {' Planora chỉ ghi khi bạn duyệt kế hoạch. Trang này chỉ hiển thị hội thoại của chính bạn; mở hội thoại để xem kế hoạch và kết quả đã lưu.'}
          </div>
        </div>

        <ScheduleSection user={user} navigate={navigate} />

        {/* THANH TÌM KIẾM VÀ BỘ LỌC ĐA NĂNG */}
        <div className="bg-[var(--planora-paper)] p-4 rounded-2xl border border-[var(--planora-divider)] shadow-xs v3-space-y-3.5">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Ô tìm kiếm */}
            <div className="relative flex-1">
              <label htmlFor="search-input" className="sr-only">
                Tìm kiếm yêu cầu trong nhật ký
              </label>
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--planora-muted)]">
                <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
                id="search-input"
                placeholder="Tìm theo tiêu đề hội thoại…"
                className="w-full text-xs sm:text-sm pl-10 pr-4 py-2.5 bg-[var(--planora-paper)] border border-[var(--planora-border-strong)] rounded-xl text-[var(--planora-text)] placeholder-[var(--planora-muted)] focus:bg-[var(--planora-paper)] focus:outline-none focus:border-[var(--planora-primary)] focus:ring-1 focus:ring-[var(--planora-primary)] transition-all"
              />
            </div>

            {/* Bộ lọc nhanh theo nhóm kết quả */}
            <div role="group" aria-label="Bộ lọc trạng thái hội thoại" className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { key: 'all', label: 'Tất cả' },
                  { key: 'completed', label: 'Hoàn thành' },
                  { key: 'needs_action', label: 'Cần xử lý' },
                  { key: 'chatting', label: 'Đang trao đổi' },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.key}
                  type="button"
                  aria-pressed={statusFilter === pill.key}
                  onClick={() => setStatusFilter(pill.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs transition-all border cursor-pointer ${
                    statusFilter === pill.key
                      ? 'bg-[var(--planora-primary)] text-[var(--planora-on-primary)] border-[var(--planora-primary)] font-semibold shadow-xs'
                      : 'bg-[var(--planora-paper)] text-[var(--planora-muted)] hover:text-[var(--planora-text)] border-[var(--planora-divider)] hover:bg-[var(--planora-surface-inset)] font-medium'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* DANH SÁCH NHẬT KÝ THEO DÒNG THỜI GIAN */}
        <div id="requests-list-container" className="v3-space-y-6">
          {GROUPS.map((group) => {
            const items = displayed.filter((r) => r.dateGroup === group.key);
            if (items.length === 0) return null;
            return (
              <section key={group.key} className="v3-space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <h2 className="font-serif text-xs font-bold uppercase tracking-wider text-[var(--planora-muted)]">
                    {group.title}
                  </h2>
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--planora-divider)]" />
                  <span className="text-xs text-[var(--planora-muted)]">{`${items.length} hội thoại`}</span>
                </div>
                <div className="v3-space-y-3">
                  {items.map((req) => (
                    <RequestCard
                      key={req.id}
                      req={req}
                      isEditing={editing === req.id}
                      actions={actions}
                      title={title}
                      saving={saving}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {/* NÚT TẢI THÊM CUỐI DANH SÁCH */}
        <div
          id="load-more-container"
          className={`pt-2 flex flex-col items-center justify-center gap-2${cursor ? '' : ' hidden'}`}
        >
          <button
            type="button"
            id="btn-load-more"
            disabled={loading}
            onClick={() => actions.loadMoreRequests()}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-xl bg-[var(--planora-paper)] border border-[var(--planora-divider)] hover:border-[var(--planora-primary)] text-[var(--planora-text)] hover:text-[var(--planora-primary)] shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            <span>Tải thêm</span>
            <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div id="load-more-all-loaded" className="hidden text-xs text-[var(--planora-muted)]">
            Đã hiển thị toàn bộ lịch sử hội thoại
          </div>
        </div>

        {/* TRẠNG THÁI RỖNG (EMPTY STATE KHI TÌM KHÔNG THẤY) */}
        <div
          id="empty-state"
          className={`${
            !loading && rows.length === 0 ? '' : 'hidden '
          }p-12 text-center bg-[var(--planora-paper)] rounded-2xl border border-[var(--planora-divider)] shadow-xs v3-space-y-3`}
        >
          <div className="w-12 h-12 rounded-full bg-[var(--planora-surface-inset)] flex items-center justify-center mx-auto text-[var(--planora-muted)]">
            <svg aria-hidden="true" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <h3 className="font-serif text-lg font-bold text-[var(--planora-text)]">
            {search ? 'Không tìm thấy hội thoại phù hợp' : 'Chưa có hội thoại nào'}
          </h3>
          <p className="text-xs sm:text-sm text-[var(--planora-muted)] max-w-sm mx-auto">
            Thử thay đổi từ khóa tìm kiếm theo tiêu đề hội thoại.
          </p>
          <button
            type="button"
            onClick={() => setSearch('')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-[var(--planora-surface-inset)] hover:bg-[var(--planora-divider)] text-[var(--planora-text)] transition-colors mt-2 cursor-pointer"
          >
            <span>Xoá từ khóa tìm kiếm</span>
          </button>
        </div>
      </main>

      {/* CHÂN TRANG */}
      <footer className="mt-auto border-t border-[var(--planora-divider)] bg-[var(--planora-canvas)] py-6 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--planora-muted)]">
          <div className="flex items-center gap-2">
            <span className="font-serif font-bold text-[var(--planora-text)]">Planora</span>
            <span>· 2026</span>
            <span>· AI Workflow Automation Platform</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="/"
              onClick={(event) => {
                event.preventDefault();
                navigate('/');
              }}
              className="hover:text-[var(--planora-text)] transition-colors"
            >
              Không gian làm việc
            </a>
            <a
              href="/settings"
              onClick={(event) => {
                event.preventDefault();
                navigate('/settings');
              }}
              className="hover:text-[var(--planora-text)] transition-colors"
            >
              Kết nối dịch vụ
            </a>
            <a
              href="/guide"
              onClick={(event) => {
                event.preventDefault();
                navigate('/guide');
              }}
              className="hover:text-[var(--planora-text)] transition-colors"
            >
              Cẩm nang &amp; Mẫu lệnh
            </a>
            <a
              hidden={role !== 'admin'}
              href="/admin/users"
              onClick={(event) => {
                event.preventDefault();
                navigate('/admin/users');
              }}
              className="hover:text-[var(--planora-text)] transition-colors"
            >
              Quản lý người dùng
            </a>
            <a
              href="/account"
              onClick={(event) => {
                event.preventDefault();
                navigate('/account');
              }}
              className="hover:text-[var(--planora-text)] transition-colors"
            >
              Tài khoản
            </a>
            <a
              href="/privacy"
              onClick={(event) => {
                event.preventDefault();
                navigate('/privacy');
              }}
              className="text-[var(--planora-primary)] hover:underline font-medium transition-colors"
            >
              Chính sách an toàn
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
