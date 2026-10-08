import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import { UserNavMenu } from '../../components/layout/UserNavMenu';
import type { User } from '../../types';
import css from './page.css?inline';
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Conversation } from '../../types';
import { formatConversationTime } from '../../services/conversation-time';
import { useHistory } from './useHistory';
function RequestCard({ req, isEditing, actions, title, saving }: { req: HistoryRow; isEditing: boolean; actions: CardActions; title: string; saving: boolean }) {
  const rawTitle = req.title || '';
  const displayTitle = rawTitle.length > 60 ? rawTitle.slice(0, 60) + '…' : rawTitle;
  return <article className="p-4 sm:p-5 rounded-2xl bg-white border border-[#E7E7E2] shadow-soft hover:border-[#FF5701]/60 transition-all group">
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      {/* Cụm trái: Trạng thái, Thời gian, Tiêu đề hội thoại, Kết quả */}
      <div className="v3-space-y-2 flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border bg-neutral-100 text-neutral-700 border-neutral-200`}>{req.statusLabel}</span>
          <span className="text-[#9CA3AF]">·</span>
          <span className="text-[#6B7280] font-medium">{req.timeStr}</span>
        </div>
        {/* Tiêu đề hội thoại (hoặc ô nhập đổi tên inline) */}
        {isEditing ? (
          <div className="v3-space-y-1.5 py-0.5" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2">
              {/* React ghi value bằng thuộc tính DOM nên con trỏ nằm cuối chữ; bản mẫu đọc value từ HTML nên con trỏ ở đầu.
                  Đặt lại về đầu khi tạo ô để khi focus, chữ dài trên màn hẹp cuộn giống bản mẫu. */}
              <input autoFocus aria-label="Tiêu đề hội thoại" id={`rename-input-${req.id}`} type="text" maxLength={60} value={title} onChange={event => actions.setTitle(event.target.value)} onKeyDown={(event) => actions.handleRenameKey(event, req.id)} className="flex-1 min-w-0 text-sm sm:text-base font-semibold text-[#111827] px-3 py-1.5 border-2 border-[#FF5701] rounded-xl focus:v3-outline-none focus:ring-2 focus:ring-[#FF5701]/20 bg-white shadow-sm" placeholder="Nhập tiêu đề hội thoại (tối đa 60 ký tự)" />
              <button type="button" onClick={() => actions.saveInlineRename(req.id)} disabled={saving} className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#FF5701] hover:bg-[#E04D00] text-white transition-colors shadow-sm flex-shrink-0">
                Lưu
              </button>
              <button type="button" onClick={() => actions.cancelInlineRename()} className="px-2.5 py-1.5 text-xs font-medium rounded-xl text-[#6B7280] hover:text-[#111827] hover:bg-neutral-100 transition-colors flex-shrink-0">
                Huỷ
              </button>
            </div>
            <div className="text-[11px] text-[#6B7280] flex items-center gap-2">
              <span>
                {"Nhấn "}
                <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono">Enter</kbd>
                {" để lưu, "}
                <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-[10px] font-mono">Esc</kbd>
                {" để huỷ"}
              </span>
              <span className="text-[#9CA3AF]">·</span>
              <span>Tối đa 60 ký tự</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm sm:text-base font-semibold text-[#111827] group-hover:text-[#FF5701] transition-colors leading-snug">
              {displayTitle}
            </h3>
            <button type="button" onClick={(event) => actions.startInlineRename(req.id, event)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#6B7280] hover:text-[#FF5701] hover:bg-neutral-100 rounded-lg transition-colors" id={`rename-button-${req.id}`} aria-label={`Đổi tên ${rawTitle}`} title="Đổi tên hội thoại">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              <span className="text-[11px] font-medium">Đổi tên</span>
            </button>
          </div>
        )}
      </div>
      {/* Cụm phải: Dải dịch vụ + Nút xem chi tiết */}
      <div className="flex sm:flex-col items-center sm:items-end justify-between gap-3 flex-shrink-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-neutral-100">
        <div className="flex items-center gap-2">
          <a href={`/c/${encodeURIComponent(req.id)}`} onClick={event => { event.preventDefault(); actions.openConversation(req.id); }} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#F8F8F6] group-hover:bg-[#FF5701] text-[#111827] group-hover:text-white border border-[#E7E7E2] group-hover:border-transparent transition-all shadow-sm">
            <span>Mở hội thoại</span>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
          </a>
        </div>
      </div>
    </div>
  </article>;
}

export const meta: PageMeta = {
  id: "history",
  title: "Nhật ký điều phối & Lịch sử yêu cầu — ATI",
  htmlClass: "",
  bodyClass: "min-h-screen flex flex-col bg-[#F8F8F6] text-[#111827]",
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
  const role = user?.role ?? 'member';
  const day = new Date(); day.setHours(0,0,0,0); const yesterday = new Date(day); yesterday.setDate(yesterday.getDate() - 1);
  const displayed: HistoryRow[] = rows.map(row => { const value = row.updatedAt ?? row.updated_at ?? row.created_at; const time = value ? new Date(value).getTime() : NaN; return { ...row, timeStr: formatConversationTime(value), dateGroup: time >= day.getTime() ? 'today' : time >= yesterday.getTime() ? 'yesterday' : 'older', statusLabel: STATUS_LABEL[row.status ?? ''] ?? 'Hội thoại' }; });
  const actions: CardActions & { loadMoreRequests: () => void } = {
    startInlineRename(id, event) { event.stopPropagation(); edit(id); },
    handleRenameKey(event, id) { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); void rename(id); } if (event.key === 'Escape') { event.preventDefault(); cancel(); } },
    saveInlineRename(id) { void rename(id); }, cancelInlineRename: cancel, setTitle, openConversation(id) { navigate(`/c/${encodeURIComponent(id)}`); }, loadMoreRequests: loadMore,
  };
  return <>
      {/* THANH TRÊN (COCKPIT HEADER) */}
      <header className="sticky top-0 z-30 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          {/* Cụm Logo & Điều hướng quay lại */}
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <a href="/" onClick={event => { event.preventDefault(); navigate("/"); }} className="flex items-center gap-2.5 group flex-shrink-0" title="Về sân khấu điều phối">
              <div className="w-8 h-8 rounded-lg bg-[#FF5701] flex items-center justify-center text-white font-display font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
                A
              </div>
              <span className="font-display font-bold text-lg tracking-tight text-[#111827]">
                ATI
              </span>
            </a>
            <div className="h-4 w-px bg-[#E7E7E2] flex-shrink-0" />
            <a href="/" onClick={event => { event.preventDefault(); navigate("/"); }} className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Quay lại không gian làm việc">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="hidden sm:inline">
                Về không gian làm việc
              </span>
              <span className="sm:hidden">
                Quay lại
              </span>
            </a>
            <div className="hidden md:block h-4 w-px bg-[#E7E7E2] flex-shrink-0" />
            {/* Liên kết chéo */}
            <a href="/settings" onClick={event => { event.preventDefault(); navigate("/settings"); }} className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Kết nối dịch vụ">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              {' '}
              <span>
                Kết nối dịch vụ
              </span>
            </a>
            <a href="/guide" onClick={event => { event.preventDefault(); navigate("/guide"); }} className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title={"Cẩm nang kết nối & Mẫu câu lệnh"}>
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              {' '}
              <span>
                Cẩm nang
              </span>
            </a>
            <a hidden={role !== "admin"} href="/admin/users" onClick={event => { event.preventDefault(); navigate("/admin/users"); }} id="nav-link-users" className="hidden lg:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Quản lý người dùng">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              {' '}
              <span>
                Người dùng
              </span>
            </a>
          </div>
          {/* Cụm Phải: Vai trò + Kịch bản Demo + Avatar */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Nhãn vai trò hiện tại */}
            <span id="role-pill-badge" className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-200/80 text-[#374151] border border-neutral-300/60" title="Vai trò hiện tại của bạn">
              <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
              {' '}
              <span id="current-role-label">
                {role === 'admin' ? 'Quản trị viên' : 'Thành viên'}
              </span>
            </span>
<ThemeToggle /><UserNavMenu user={user} variant="prototype" navigate={navigate} onOpenSettings={() => navigate("/settings")} onOpenAccount={() => navigate("/account")} onManageUsers={() => navigate("/admin/users")} onLogout={onLogout} />
          </div>
        </div>
      </header>
      {/* NỘI DUNG CHÍNH */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 v3-space-y-6">
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {notice && <p role="status" className="text-xs text-emerald-600">{notice}</p>}
        {loading && <p role="status" className="text-xs text-[#6B7280]">Đang tải hội thoại...</p>}
        {/* KHỐI TIÊU ĐỀ & NGUYÊN TẮC AN TOÀN */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#E7E7E2] pb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-200/80 text-[#374151]">
                <svg className="w-3 h-3 text-[#FF5701]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {" Nhật ký điều phối"}
              </span>
              <span id="requests-count-badge" className="text-xs text-[#6B7280]">
                {`${rows.length} hội thoại đã tải`}
              </span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#111827]">
              Nhật ký điều phối &amp; Lịch sử yêu cầu
            </h1>
            <p className="text-sm text-[#4B5563] mt-1.5 max-w-2xl leading-relaxed">
              Lịch sử hội thoại của bạn. Tìm theo tiêu đề, đổi tên và mở lại hội thoại để tiếp tục công việc.
            </p>
          </div>
          {/* Nút hành động nhanh */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <a href="/" onClick={event => { event.preventDefault(); navigate("/"); }} className="inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-xl bg-[#FF5701] text-white hover:bg-[#E04D00] shadow-sm hover:shadow transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              <span>
                Gõ yêu cầu mới
              </span>
            </a>
          </div>
        </div>
        {/* NGUYÊN TẮC AN TOÀN */}
        <div className="p-4 rounded-2xl bg-white border border-[#E7E7E2] shadow-soft flex items-start gap-3.5">
          <div className="w-8 h-8 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center flex-shrink-0 text-[#FF5701] mt-0.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
            <strong className="text-[#111827] font-semibold">
              Minh bạch &amp; An toàn dữ liệu:
            </strong>
            {" ATI chỉ ghi khi bạn duyệt kế hoạch. Trang này chỉ hiển thị hội thoại của chính bạn; mở hội thoại để xem kế hoạch và kết quả đã lưu."}
          </div>
        </div>
        {/* THANH TÌM KIẾM VÀ BỘ LỌC ĐA NĂNG */}
        <div className="bg-white p-4 rounded-2xl border border-[#E7E7E2] shadow-soft v3-space-y-3.5">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Ô tìm kiếm */}
            <div className="relative flex-1">
              <label htmlFor="search-input" className="sr-only">
                Tìm kiếm yêu cầu trong nhật ký
              </label>
              {' '}
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#9CA3AF]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              {' '}
              <input value={search} onChange={event => setSearch(event.target.value)} type="search" id="search-input" placeholder="Tìm theo tiêu đề hội thoại…" className="w-full text-xs sm:text-sm pl-10 pr-4 py-2.5 bg-[#F8F8F6] border border-[#E7E7E2] rounded-xl text-[#111827] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] transition-all" />
            </div>
          </div>
        </div>
        {/* DANH SÁCH NHẬT KÝ THEO DÒNG THỜI GIAN */}
        <div id="requests-list-container" className="v3-space-y-6">
          {GROUPS.map(group => {
            const items = displayed.filter(r => r.dateGroup === group.key);
            if (items.length === 0) return null;
            return (
              <section key={group.key} className="v3-space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-[#6B7280]">{group.title}</h2>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E7E7E2]" />
                  <span className="text-xs text-[#9CA3AF]">{`${items.length} hội thoại`}</span>
                </div>
                <div className="v3-space-y-3">
                  {items.map(req => <RequestCard key={req.id} req={req} isEditing={editing === req.id} actions={actions} title={title} saving={saving} />)}
                </div>
              </section>
            );
          })}
        </div>
        {/* NÚT TẢI THÊM CUỐI DANH SÁCH */}
        <div id="load-more-container" className={`pt-2 flex flex-col items-center justify-center gap-2${!!cursor ? '' : ' hidden'}`}>
          <button type="button" id="btn-load-more" disabled={loading} onClick={() => actions.loadMoreRequests()} className="inline-flex items-center gap-2 px-5 py-2.5 text-xs sm:text-sm font-semibold rounded-xl bg-white border border-[#E7E7E2] hover:border-[#FF5701] text-[#374151] hover:text-[#FF5701] shadow-soft transition-all">
            <span>
              Tải thêm
            </span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div id="load-more-all-loaded" className="hidden text-xs text-[#9CA3AF]">
            Đã hiển thị toàn bộ lịch sử hội thoại
          </div>
        </div>
        {/* TRẠNG THÁI RỖNG (EMPTY STATE KHI TÌM KHÔNG THẤY) */}
        <div id="empty-state" className={`${!loading && rows.length === 0 ? '' : 'hidden '}p-12 text-center bg-white rounded-2xl border border-[#E7E7E2] shadow-soft v3-space-y-3`}>
          <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto text-[#6B7280]">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h3 className="font-display text-lg font-bold text-[#111827]">
            {search ? "Không tìm thấy hội thoại phù hợp" : "Chưa có hội thoại nào"}
          </h3>
          <p className="text-xs sm:text-sm text-[#6B7280] max-w-sm mx-auto">
            Thử thay đổi từ khóa tìm kiếm theo tiêu đề hội thoại.
          </p>
          {' '}
          <button type="button" onClick={() => setSearch("")} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-neutral-100 hover:bg-neutral-200 text-[#111827] transition-colors mt-2">
            <span>
              Xoá từ khóa tìm kiếm
            </span>
          </button>
        </div>
      </main>
      {/* CHÂN TRANG */}
      <footer className="mt-auto border-t border-[#E7E7E2] bg-[#F8F8F6] py-6 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6B7280]">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-[#111827]">
              ATI
            </span>
            <span>
              · 2026
            </span>
            <span>
              · AI Workflow Automation Platform
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <a href="/" onClick={event => { event.preventDefault(); navigate("/"); }} className="hover:text-[#111827] transition-colors">
              Không gian làm việc
            </a>
            <a href="/settings" onClick={event => { event.preventDefault(); navigate("/settings"); }} className="hover:text-[#111827] transition-colors">
              Kết nối dịch vụ
            </a>
            <a href="/guide" onClick={event => { event.preventDefault(); navigate("/guide"); }} className="hover:text-[#111827] transition-colors">
              Cẩm nang &amp; Mẫu lệnh
            </a>
            <a hidden={role !== "admin"} href="/admin/users" onClick={event => { event.preventDefault(); navigate("/admin/users"); }} className="hover:text-[#111827] transition-colors">
              Quản lý người dùng
            </a>
            <a href="/account" onClick={event => { event.preventDefault(); navigate("/account"); }} className="hover:text-[#111827] transition-colors">
              Tài khoản
            </a>
            <a href="/privacy" onClick={event => { event.preventDefault(); navigate("/privacy"); }} className="text-[#FF5701] hover:underline font-medium transition-colors">
              Chính sách an toàn
            </a>
          </div>
        </div>
      </footer>
    </>;
}
