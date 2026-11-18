import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import { MainNav } from '../../components/layout/MainNav';
import type { User } from '../../types';
import css from './page.css?inline';
import { useState, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Conversation } from '../../types';
import { formatConversationTime } from '../../services/conversation-time';
import { useHistory } from './useHistory';

function statusClass(status?: string): string {
  if (status === 'completed') return 'ps-status ps-status-connected';
  if (status === 'partial' || status === 'failed' || status === 'reconciliation_required' || status === 'executing' || status === 'planning') {
    return 'ps-status ps-status-warning';
  }
  return 'ps-status ps-status-neutral';
}

function RequestCard({ req, isEditing, actions, title, saving }: { req: HistoryRow; isEditing: boolean; actions: CardActions; title: string; saving: boolean }) {
  const rawTitle = req.title || 'Hội thoại mới';
  const displayTitle = rawTitle.length > 60 ? rawTitle.slice(0, 60) + '…' : rawTitle;
  return <article className="px-4 sm:px-5 py-3.5 group">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      {/* Cụm trái: Tiêu đề hội thoại (hoặc ô đổi tên inline), Trạng thái, Giờ */}
      <div className="v3-space-y-1.5 flex-1 min-w-0">
        {isEditing ? (
          <div className="v3-space-y-1.5 py-0.5" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap items-center gap-2">
              {/* React ghi value bằng thuộc tính DOM nên con trỏ nằm cuối chữ; bản mẫu đọc value từ HTML nên con trỏ ở đầu.
                  Đặt lại về đầu khi tạo ô để khi focus, chữ dài trên màn hẹp cuộn giống bản mẫu. */}
              <input autoFocus aria-label="Tiêu đề hội thoại" id={`rename-input-${req.id}`} type="text" maxLength={60} value={title} onChange={event => actions.setTitle(event.target.value)} onKeyDown={(event) => actions.handleRenameKey(event, req.id)} className="ps-field flex-1 min-w-0 font-semibold" placeholder="Nhập tiêu đề hội thoại (tối đa 60 ký tự)" />
              <button type="button" onClick={() => actions.saveInlineRename(req.id)} disabled={saving} className="ps-btn flex-shrink-0">
                Lưu
              </button>
              <button type="button" onClick={() => actions.cancelInlineRename()} className="ps-btn-quiet flex-shrink-0">
                Huỷ
              </button>
            </div>
            <div className="text-[13px] text-[var(--ps-faint)] flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                {"Nhấn "}
                <kbd className="px-1.5 py-0.5 bg-[var(--ps-sheet)] border border-[var(--ps-edge)] rounded text-xs font-mono">Enter</kbd>
                {" để lưu, "}
                <kbd className="px-1.5 py-0.5 bg-[var(--ps-sheet)] border border-[var(--ps-edge)] rounded text-xs font-mono">Esc</kbd>
                {" để huỷ"}
              </span>
              <span>·</span>
              <span>Tối đa 60 ký tự</span>
            </div>
          </div>
        ) : (
          <>
            <h3 className="font-sans text-[15px] font-semibold text-[var(--ps-ink)] leading-snug break-words">
              {displayTitle}
            </h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <span className={statusClass(req.status)}>{req.statusLabel}</span>
              <span className="text-[var(--ps-faint)] tabular-nums">{req.timeStr}</span>
            </div>
          </>
        )}
      </div>
      {/* Cụm phải: Đổi tên + Mở hội thoại */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {!isEditing && (
          <button type="button" onClick={(event) => actions.startInlineRename(req.id, event)} className="ps-btn-quiet" id={`rename-button-${req.id}`} aria-label={`Đổi tên ${rawTitle}`} title="Đổi tên hội thoại">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
            <span>Đổi tên</span>
          </button>
        )}
        <a href={`/c/${encodeURIComponent(req.id)}`} onClick={event => { event.preventDefault(); actions.openConversation(req.id); }} className="text-sm font-medium text-[var(--ps-accent-text)] hover:underline whitespace-nowrap inline-flex items-center gap-1 py-1.5">
          <span>Mở hội thoại</span>
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  </article>;
}

export const meta: PageMeta = {
  id: "history",
  title: "Nhật ký — Planora",
  htmlClass: "",
  bodyClass: "min-h-screen flex flex-col bg-[#F8F4EE] text-[#1a0e08]",
  css,
};


type HistoryRow = Conversation & { timeStr: string; dateGroup: string; statusLabel: string };
type CardActions = { startInlineRename: (id: string, event: ReactMouseEvent) => void; handleRenameKey: (event: ReactKeyboardEvent, id: string) => void; saveInlineRename: (id: string) => void; cancelInlineRename: () => void; openConversation: (id: string) => void; setTitle: (value: string) => void };
const GROUPS = [{ key: 'today', title: 'Hôm nay' }, { key: 'yesterday', title: 'Hôm qua' }, { key: 'older', title: 'Trước đó' }];
const STATUS_LABEL: Record<string, string> = { chatting: 'Đang trao đổi', planning: 'Đang lập kế hoạch', completed: 'Hoàn thành', executing: 'Đang chạy', partial: 'Cần xử lý', failed: 'Cần xử lý', reconciliation_required: 'Cần đối soát', stopped: 'Đã dừng', rejected: 'Đã từ chối' };
export interface HistoryPageProps { user: User | null; navigate: (path: string) => void; onLogout: () => void }
export function HistoryPage({ user, navigate, onLogout }: HistoryPageProps) {
  usePrototypePage(meta);
  const { rows, search, setSearch, cursor, loading, error, notice, editing, title, setTitle, saving, edit, cancel, rename, loadMore } = useHistory(user);
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'needs_action' | 'chatting'>('all');
  const day = new Date(); day.setHours(0,0,0,0); const yesterday = new Date(day); yesterday.setDate(yesterday.getDate() - 1);
  const allDisplayed: HistoryRow[] = rows.map(row => { const value = row.updatedAt ?? row.updated_at ?? row.created_at; const time = value ? new Date(value).getTime() : NaN; return { ...row, timeStr: formatConversationTime(value), dateGroup: time >= day.getTime() ? 'today' : time >= yesterday.getTime() ? 'yesterday' : 'older', statusLabel: STATUS_LABEL[row.status ?? ''] ?? 'Hội thoại' }; });
  const displayed = allDisplayed.filter(row => {
    if (statusFilter === 'completed') return row.status === 'completed';
    if (statusFilter === 'needs_action') return row.status === 'partial' || row.status === 'failed' || row.status === 'reconciliation_required';
    if (statusFilter === 'chatting') return !row.status || row.status === 'chatting' || row.status === 'planning' || row.status === 'executing';
    return true;
  });
  const empty: false | 'search' | 'filter' | 'none' = loading || error || displayed.length > 0 ? false
    : rows.length > 0 ? 'filter' : search ? 'search' : 'none';
  const actions: CardActions & { loadMoreRequests: () => void } = {
    startInlineRename(id, event) { event.stopPropagation(); edit(id); },
    handleRenameKey(event, id) { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); void rename(id); } if (event.key === 'Escape') { event.preventDefault(); cancel(); } },
    saveInlineRename(id) { void rename(id); }, cancelInlineRename: cancel, setTitle, openConversation(id) { navigate(`/c/${encodeURIComponent(id)}`); }, loadMoreRequests: loadMore,
  };
  return <>
      {/* FE-12: thanh điều hướng chung thay thanh trên của bản mẫu. */}
      <MainNav user={user} current="history" pageName="Nhật ký" navigate={navigate} onLogout={onLogout} />
      {/* NỘI DUNG CHÍNH */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 v3-space-y-6">
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
        {loading && <p role="status" className="ps-note">Đang tải hội thoại...</p>}
        <div className="ps-pagehead">
          <h1>Nhật ký</h1>
          <p>
            Lịch sử hội thoại của bạn. Tìm theo tiêu đề, đổi tên và mở lại hội thoại để tiếp tục công việc.
          </p>
        </div>
        {/* THANH TÌM KIẾM VÀ BỘ LỌC */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1 min-w-0">
            <label htmlFor="search-input" className="sr-only">
              Tìm kiếm yêu cầu trong nhật ký
            </label>
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--ps-faint)]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input value={search} onChange={event => setSearch(event.target.value)} type="search" id="search-input" placeholder="Tìm theo tiêu đề hội thoại…" className="ps-field w-full pl-9" />
          </div>
          <div role="group" aria-label="Bộ lọc trạng thái hội thoại" className="ps-segmented self-start">
            {([
              { key: 'all', label: 'Tất cả' },
              { key: 'completed', label: 'Hoàn thành' },
              { key: 'needs_action', label: 'Cần xử lý' },
              { key: 'chatting', label: 'Đang trao đổi' },
            ] as const).map(pill => (
              <button
                key={pill.key}
                type="button"
                aria-pressed={statusFilter === pill.key}
                onClick={() => setStatusFilter(pill.key)}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>
        {/* DANH SÁCH NHẬT KÝ THEO DÒNG THỜI GIAN */}
        <div id="requests-list-container" className="v3-space-y-6">
          {GROUPS.map(group => {
            const items = displayed.filter(r => r.dateGroup === group.key);
            if (items.length === 0) return null;
            return (
              <section key={group.key} className="v3-space-y-2.5">
                <h2 className="ps-grouptitle">
                  <span>{group.title}</span>
                  <span className="ps-groupcount">{items.length}</span>
                </h2>
                <div className="ps-panel ps-rows">
                  {items.map(req => <RequestCard key={req.id} req={req} isEditing={editing === req.id} actions={actions} title={title} saving={saving} />)}
                </div>
              </section>
            );
          })}
        </div>
        {/* NÚT TẢI THÊM CUỐI DANH SÁCH */}
        <div id="load-more-container" className={`pt-2 flex flex-col items-center justify-center gap-2${!!cursor ? '' : ' hidden'}`}>
          <button type="button" id="btn-load-more" disabled={loading} onClick={() => actions.loadMoreRequests()} className="ps-btn-quiet">
            <span>Tải thêm</span>
          </button>
          <div id="load-more-all-loaded" className="hidden text-[13px] text-[var(--ps-faint)]">
            Đã hiển thị toàn bộ lịch sử hội thoại
          </div>
        </div>
        {/* TRẠNG THÁI RỖNG: ba trường hợp khác nhau (chưa có gì, tìm không thấy, bộ lọc không có hội thoại). */}
        {empty && <div id="empty-state" className="ps-panel p-8 sm:p-10 text-center v3-space-y-3">
          <h3 className="font-sans text-base font-semibold text-[var(--ps-ink)]">
            {empty === 'search' ? "Không tìm thấy hội thoại phù hợp" : empty === 'filter' ? "Không có hội thoại nào ở bộ lọc này" : "Chưa có hội thoại nào"}
          </h3>
          <p className="ps-note max-w-sm mx-auto">
            {empty === 'search' ? "Thử từ khóa khác trong tiêu đề hội thoại." : empty === 'filter' ? "Các hội thoại đã tải không thuộc trạng thái này." : "Gửi yêu cầu đầu tiên ở trang chủ; hội thoại sẽ hiện ở đây để bạn mở lại."}
          </p>
          {empty === 'search' && (
            <button type="button" onClick={() => setSearch("")} className="ps-btn-quiet mt-2">
              Xoá từ khóa tìm kiếm
            </button>
          )}
          {empty === 'filter' && (
            <button type="button" onClick={() => setStatusFilter('all')} className="ps-btn-quiet mt-2">
              Xem tất cả
            </button>
          )}
        </div>}
        {/* Bước 5b: Lịch chạy chuyển sang trang Tự động (/inbox); Nhật ký chỉ còn hội thoại. */}
      </main>
    </>;
}
