import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import { UserNavMenu } from '../../components/layout/UserNavMenu';
import type { User } from '../../types';
import css from './page.css?inline';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Member, PendingUser } from './data';
import { useUsers } from './useUsers';
type Role = 'admin' | 'member';
const TABLE_WRAPPER = 'overflow-hidden rounded-2xl bg-white border border-[#E7E7E2] shadow-sm sm:block';
const TAB_ON = 'flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all bg-[#FF5701] text-white shadow-sm';
const TAB_OFF = 'flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all text-[#6B7280] hover:text-[#111827]';
// Thẻ yêu cầu chờ duyệt (renderPendingList).
function PendingCard({ u, isAdmin, onApprove }: { u: PendingUser; isAdmin: boolean; onApprove: (id: string) => void }) {
  const isVerified = !!u.emailVerified;
  return <div className="p-4 sm:p-5 rounded-2xl bg-white border border-[#E7E7E2] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:border-neutral-300">
    <div className="flex items-start gap-3.5 min-w-0">
      <div className={`w-10 h-10 rounded-full ${isVerified ? 'bg-amber-100 text-amber-900' : 'bg-neutral-100 text-neutral-600'} font-bold text-sm flex items-center justify-center flex-shrink-0`}>
        {u.avatarInitials}
      </div>
      <div className="min-w-0 v3-space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-[#111827]">{u.name}</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
            Chờ duyệt
          </span>
          {!isVerified ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-700 border border-neutral-300">
              Chưa xác minh email
            </span>
          ) : ''}
          <span className="text-xs text-[#9CA3AF]">·</span>
          <span className="text-xs text-[#6B7280]">{u.requestedAt}</span>
        </div>
        <p className="text-xs text-[#4B5563] break-all sm:truncate">{u.email}</p>
        <div className="flex items-center gap-2 text-[11px] text-[#6B7280] pt-0.5">
          <span className="inline-flex items-center gap-1 font-medium text-neutral-600">
            <svg className="w-3 h-3 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {` Đăng ký qua ${u.provider} `}
          </span>
        </div>
      </div>
    </div>
    <div className="flex flex-col sm:items-end gap-1.5 self-end sm:self-center flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#E7E7E2] w-full sm:w-auto">
      {isAdmin ? (isVerified ? <>
        <button type="button" onClick={() => onApprove(u.id)} className="w-full sm:w-auto px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-sm flex items-center justify-center gap-1.5">
          <span>Duyệt &amp; kích hoạt</span>
          <span>✓</span>
        </button>
        <span className="text-[11px] text-[#6B7280]">Chưa duyệt thì tài khoản không đăng nhập được.</span>
      </> : <>
        <button type="button" disabled className="w-full sm:w-auto px-3.5 py-1.5 rounded-lg bg-neutral-100 text-neutral-400 border border-neutral-200 text-xs font-semibold cursor-not-allowed flex items-center justify-center gap-1.5" title="Người này cần bấm link xác minh trong email trước.">
          <span>Duyệt &amp; kích hoạt</span>
          <span>✓</span>
        </button>
        <span className="text-[11px] text-amber-700 font-medium">Người này cần bấm link xác minh trong email trước.</span>
      </>) : (
        <span className="text-xs text-[#9CA3AF] italic">Cần quyền Quản trị viên để duyệt</span>
      )}
    </div>
  </div>;
}

const roleText = (role: Role) => (role === 'admin' ? 'Quản trị viên' : 'Thành viên');
const roleBadge = (role: Role) => (role === 'admin' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-neutral-100 text-neutral-700 border-neutral-200');
const statusBadge = (locked: boolean) => (locked ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200');
const SELF_BADGE = <span className="text-[10px] font-bold px-1.5 py-[2px] rounded bg-neutral-200 text-neutral-700">Bạn</span>;

// Dòng bảng thành viên trên desktop (renderMembersList).
function MemberRow({ m, isAdmin, onRole, onLock }: { m: Member; isAdmin: boolean; onRole: (id: string) => void; onLock: (id: string) => void }) {
  const isLocked = m.status === 'locked';
  return <tr className="hover:bg-[#F8F8F6]/60 transition-colors">
    <td className="py-3 px-4">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full ${m.role === 'admin' ? 'bg-[#FF5701] text-white' : 'bg-neutral-200 text-neutral-700'} font-semibold text-xs flex items-center justify-center flex-shrink-0`}>
          {m.avatarInitials}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[#111827] text-xs sm:text-sm">{m.name}</span>
            {m.isSelf ? SELF_BADGE : ''}
          </div>
          <p className="text-xs text-[#6B7280]">{m.email}</p>
        </div>
      </div>
    </td>
    <td className="py-3 px-4">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${roleBadge(m.role)}`}>
        {` ${roleText(m.role)} `}
      </span>
    </td>
    <td className="py-3 px-4">
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${statusBadge(isLocked)}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${isLocked ? 'bg-red-500' : 'bg-emerald-500'}`} />
        {` ${isLocked ? 'Bị tạm khóa' : 'Đang hoạt động'} `}
      </span>
    </td>
    <td className="py-3 px-4 text-xs text-[#6B7280]">{` ${m.joinedDate} `}</td>
    <td className="py-3 px-4 text-xs text-[#6B7280]">{` ${m.sessionsCount} thiết bị `}</td>
    <td className="py-3 px-4 text-right">
      {isAdmin && !m.isSelf ? <>
        {' '}
        <div className="inline-flex items-center gap-1">
          <button type="button" onClick={() => onRole(m.id)} className="px-2 py-1 rounded text-xs text-[#4B5563] hover:text-[#111827] hover:bg-neutral-100 transition-colors" title="Đổi vai trò">
            {" Đổi vai trò "}
          </button>
          <button type="button" onClick={() => onLock(m.id)} className={`px-2 py-1 rounded text-xs ${isLocked ? 'text-emerald-600 hover:bg-emerald-50' : 'text-amber-600 hover:bg-amber-50'} transition-colors`} title={isLocked ? 'Mở khóa' : 'Khóa'}>
            {` ${isLocked ? 'Mở khóa' : 'Khóa'} `}
          </button>
        </div>
        {' '}
      </> : <>
        {' '}
        {m.isSelf ? <span className="text-xs text-[#9CA3AF]">—</span> : <span className="text-xs text-[#9CA3AF] italic">Chỉ xem</span>}
        {' '}
      </>}
    </td>
  </tr>;
}

// Thẻ thành viên trên mobile (renderMembersList).
function MemberCard({ m, isAdmin, onRole, onLock }: { m: Member; isAdmin: boolean; onRole: (id: string) => void; onLock: (id: string) => void }) {
  const isLocked = m.status === 'locked';
  return <div className="p-3.5 rounded-xl bg-white border border-[#E7E7E2] shadow-sm v3-space-y-2.5">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-full ${m.role === 'admin' ? 'bg-[#FF5701] text-white' : 'bg-neutral-200 text-neutral-700'} font-semibold text-xs flex items-center justify-center`}>
          {m.avatarInitials}
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-xs sm:text-sm text-[#111827]">{m.name}</span>
            {m.isSelf ? SELF_BADGE : ''}
          </div>
          <p className="text-[11px] text-[#6B7280]">{m.email}</p>
        </div>
      </div>
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${roleBadge(m.role)}`}>
        {` ${roleText(m.role)} `}
      </span>
    </div>
    <div className="flex items-center justify-between text-[11px] text-[#6B7280] pt-1 border-t border-[#E7E7E2]">
      <span className="inline-flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${isLocked ? 'bg-red-500' : 'bg-emerald-500'}`} />
        {` ${isLocked ? 'Bị tạm khóa' : 'Đang hoạt động'} `}
      </span>
      <span>{`Tham gia: ${m.joinedDate}`}</span>
    </div>
    {isAdmin && !m.isSelf ? (
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#E7E7E2]">
        <button type="button" onClick={() => onRole(m.id)} className="px-2.5 py-1 rounded text-xs text-[#4B5563] border border-[#E7E7E2] hover:bg-neutral-50">
          {" Đổi vai trò "}
        </button>
        <button type="button" onClick={() => onLock(m.id)} className={`px-2.5 py-1 rounded text-xs ${isLocked ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-amber-700 bg-amber-50 border border-amber-200'}`}>
          {` ${isLocked ? 'Mở khóa' : 'Khóa'} `}
        </button>
      </div>
    ) : ''}
  </div>;
}

export const meta: PageMeta = {
  id: "users",
  title: "Quản lý người dùng & Duyệt tài khoản — ATI",
  htmlClass: "",
  bodyClass: "min-h-screen flex flex-col bg-[#F8F8F6] text-[#111827]",
  css,
};

export interface UsersPageProps { user: User | null; navigate: (path: string) => void; onLogout: () => void }
export function UsersPage({ user, navigate, onLogout }: UsersPageProps) {
  usePrototypePage(meta);
  const { tab, search, setSearch, page, setPage, total, loading, busy, error, notice, modal, selected, newRole, setNewRole, newRoleRef, pendingView, membersView, stats, actions, closeModal } = useUsers(user);
  const role = user?.role ?? 'member', membersEmpty = membersView.rows.length === 0;
  const approveUser = modal === 'modal-approve' ? selected : null, lockUser = selected ? { name: selected.name, locked: selected.status === 'disabled' } : null, roleUserName = selected?.name;
  const modalClass = (_id: string) => 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm';
  const backdrop = (_id: string) => (event: ReactMouseEvent) => { if (event.target === event.currentTarget) closeModal(); };
  if (!user || user.role !== 'admin') return <main className="p-6"><p role="alert">Bạn không có quyền quản trị người dùng.</p><button onClick={() => navigate('/')}>Về trang chính</button></main>;
  return (
    <>
      {/* THANH TRÊN (COCKPIT HEADER) */}
      <header className="sticky top-0 z-30 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
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
            <a href="/history" onClick={event => { event.preventDefault(); navigate("/history"); }} className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Nhật ký điều phối">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {' '}
              <span>
                Nhật ký
              </span>
            </a>
            <a href="/settings" onClick={event => { event.preventDefault(); navigate("/settings"); }} className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Kết nối dịch vụ">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              {' '}
              <span>
                Kết nối dịch vụ
              </span>
            </a>
            <a href="/account" onClick={event => { event.preventDefault(); navigate("/account"); }} className="hidden lg:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Tài khoản">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {' '}
              <span>
                Tài khoản
              </span>
            </a>
          </div>
          {/* Cụm Phải: Vai trò + Kịch bản Demo + Avatar */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Nhãn vai trò */}
            <span id="role-pill-badge" className={role === 'admin' ? 'hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200' : 'hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700 border border-neutral-300'}>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {' '}
              <span id="role-text-header">
                {roleText(role)}
              </span>
            </span>
            {/* Menu Kịch bản demo */}
<ThemeToggle /><UserNavMenu user={user} variant="prototype" triggerClassName="w-8 h-8 rounded-full bg-[#FF5701] text-white text-xs font-bold flex items-center justify-center shadow-sm flex-shrink-0 hover:opacity-90" menuItemClassName="flex w-full text-left items-center gap-2.5 px-4 py-2 text-xs text-[#111827] dark:text-slate-50 hover:bg-neutral-100 dark:hover:bg-slate-700 hover:text-[#FF5701] focus:bg-neutral-100 dark:focus:bg-slate-700 focus:text-[#FF5701] focus:outline-none transition-colors" navigate={navigate} onOpenSettings={() => navigate("/settings")} onOpenAccount={() => navigate("/account")} onManageUsers={() => navigate("/admin/users")} onLogout={onLogout} />
          </div>
        </div>
      </header>
      {/* NỘI DUNG CHÍNH */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 v3-space-y-8">
        {!modal && error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {notice && <p role="status" className="text-sm text-emerald-600">{notice}</p>}
        {loading && <p role="status" className="text-xs text-[#6B7280]">Đang tải người dùng...</p>}
        {/* PHẦN TIÊU ĐỀ & NGUYÊN TẮC AN TOÀN */}
        <section className="v3-space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <nav className="flex items-center gap-1.5 text-xs text-[#6B7280] mb-2" aria-label="Đường dẫn chuyển trang">
                <a href="/" onClick={event => { event.preventDefault(); navigate("/"); }} className="hover:text-[#111827] transition-colors">
                  Không gian làm việc
                </a>
                <span>
                  /
                </span>
                <span className="text-[#111827] font-medium">
                  Quản lý người dùng
                </span>
              </nav>
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#111827]">
                Quản lý người dùng &amp; Duyệt tài khoản
              </h1>
              <p className="text-sm text-[#6B7280] mt-1">
                Kiểm soát ai được quyền sử dụng ATI trong nhóm và phê duyệt các đăng ký mới.
              </p>
            </div>
            {/* Hướng dẫn tự đăng ký cho thành viên mới */}
            <div id="header-action-invite" className={`w-full sm:w-auto max-w-md p-3 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-xs text-[#4B5563] flex items-center gap-2.5${role === 'admin' ? '' : ' hidden'}`}>
              <svg className="w-4 h-4 text-[#FF5701] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="leading-relaxed">
                Thành viên mới tự đăng ký ở trang chủ (email hoặc Google), sau đó xuất hiện ở tab Chờ duyệt.
              </span>
            </div>
          </div>
          {/* Dòng nguyên tắc minh bạch */}
          <div className="p-3.5 sm:p-4 rounded-xl bg-[#FFFFFF] border border-[#E7E7E2] shadow-sm flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
              <strong className="text-[#111827] font-semibold">
                Quy tắc nhóm:
              </strong>
              {" ATI chỉ đọc và ghi theo yêu cầu của các thành viên đã được duyệt kích hoạt. Quản trị viên toàn quyền quyết định ai được tham gia nhóm và phạm vi tài nguyên công cụ được phép sử dụng."}
            </p>
          </div>
        </section>
        {/* THẺ THỐNG KÊ TỔNG QUAN (4 METRIC CARDS) */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4" aria-label="Thống kê tổng quan thành viên">
          {/* Thẻ 1: Tổng thành viên */}
          <div className="p-4 rounded-xl bg-white border border-[#E7E7E2] shadow-sm v3-space-y-1">
            <p className="text-xs font-medium text-[#6B7280]">
              Tổng thành viên
            </p>
            <div className="flex items-baseline gap-2">
              <span id="stat-total-members" className="text-2xl font-bold font-display text-[#111827]">
                {stats.total}
              </span>
              <span className="text-xs text-neutral-400">
                người
              </span>
            </div>
          </div>
          {/* Thẻ 2: Chờ phê duyệt */}
          <div className="p-4 rounded-xl bg-white border border-amber-200 shadow-sm v3-space-y-1 bg-gradient-to-br from-white to-amber-50/40">
            <p className="text-xs font-medium text-amber-800 flex items-center justify-between">
              <span>
                Chờ phê duyệt
              </span>
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            </p>
            <div className="flex items-baseline gap-2">
              <span id="stat-pending-approvals" className="text-2xl font-bold font-display text-[#FF5701]">
                {stats.pending}
              </span>
              <span className="text-xs text-amber-700 font-medium">
                yêu cầu mới
              </span>
            </div>
          </div>
          {/* Thẻ 3: Đang hoạt động */}
          <div className="p-4 rounded-xl bg-white border border-[#E7E7E2] shadow-sm v3-space-y-1">
            <p className="text-xs font-medium text-[#6B7280]">
              Đang hoạt động
            </p>
            <div className="flex items-baseline gap-2">
              <span id="stat-active-members" className="text-2xl font-bold font-display text-emerald-600">
                {stats.active}
              </span>
              <span className="text-xs text-neutral-400">
                tài khoản
              </span>
            </div>
          </div>
          {/* Thẻ 4: Đang bị khóa */}
          <div className="p-4 rounded-xl bg-white border border-[#E7E7E2] shadow-sm v3-space-y-1">
            <p className="text-xs font-medium text-[#6B7280]">
              Đang bị khóa
            </p>
            <div className="flex items-baseline gap-2">
              <span id="stat-locked-members" className="text-2xl font-bold font-display text-neutral-500">
                {stats.locked}
              </span>
              <span className="text-xs text-neutral-400">
                tài khoản
              </span>
            </div>
          </div>
        </section>
        {/* THANH TABS CHUYỂN ĐỔI & BỘ LỌC TÌM KIẾM */}
        <section className="v3-space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E7E7E2] pb-3">
            {/* Segmented Navigation Tabs */}
            <div className="inline-flex p-1 bg-[#FFFFFF] border border-[#E7E7E2] rounded-xl shadow-sm self-start" role="tablist" aria-label="Phân nhóm quản lý người dùng">
              <button type="button" id="tab-btn-pending" role="tab" aria-selected={tab === 'pending' ? 'true' : 'false'} aria-controls="view-pending" onClick={() => actions.switchTab('pending')} className={tab === 'pending' ? TAB_ON : TAB_OFF}>
                <span>
                  Chờ duyệt
                </span>
                <span id="tab-badge-pending-count" className={stats.pending === 0 ? 'px-1.5 py-[2px] rounded-full text-[11px] font-bold bg-neutral-100 text-neutral-500' : 'px-1.5 py-[2px] rounded-full text-[11px] font-bold bg-white text-[#FF5701]'}>
                  {stats.pending}
                </span>
              </button>
              <button type="button" id="tab-btn-members" role="tab" aria-selected={tab === 'members' ? 'true' : 'false'} aria-controls="view-members" onClick={() => actions.switchTab('members')} className={tab === 'members' ? TAB_ON : TAB_OFF}>
                <span>
                  Thành viên
                </span>
                <span id="tab-badge-members-count" className="px-1.5 py-[2px] rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-600">
                  {stats.total}
                </span>
              </button>
            </div>
            {/* Bộ lọc & Ô tìm kiếm thành viên */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <input value={search} onChange={event => setSearch(event.target.value)} type="search" id="input-search-users" placeholder="Tìm theo tên hoặc email…" className="w-full text-xs sm:text-sm px-3 py-2 pl-8 rounded-lg border border-[#E7E7E2] bg-white text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] transition-colors" aria-label="Tìm kiếm theo tên hoặc email" />
                {' '}
                <svg className="w-4 h-4 text-[#9CA3AF] absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

            </div>
          </div>
          {/* CẢNH BÁO KHI XEM VỚI VAI TRÒ THÀNH VIÊN */}
          <div id="banner-member-readonly" className={`${role === 'member' ? '' : 'hidden '}p-3 rounded-xl bg-neutral-100 border border-[#E7E7E2] text-xs text-[#4B5563] flex items-center gap-2`}>
            <svg className="w-4 h-4 text-[#6B7280] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              {"Bạn đang xem với vai trò "}
              <strong>
                Thành viên
              </strong>
              . Chỉ Quản trị viên mới có quyền duyệt tài khoản mới, đổi vai trò hoặc tạm khóa thành viên.
            </span>
          </div>
          {/* VIEW 1: DANH SÁCH CHỜ DUYỆT (PENDING APPROVALS) */}
          <div id="view-pending" hidden={tab !== "pending"} role="tabpanel" aria-labelledby="tab-btn-pending" className={`${tab === 'pending' ? '' : 'hidden '}v3-space-y-3`}>
            <div id="pending-list-container" className={`v3-space-y-3${pendingView.users.length === 0 ? ' hidden' : ''}`}>
              {pendingView.users.map(u => <PendingCard key={u.id} u={u} isAdmin={pendingView.isAdmin} onApprove={actions.openApproveModal} />)}
            </div>
            {/* Trạng thái trống khi đã duyệt hết */}
            <div id="pending-empty-state" hidden={loading || pendingView.users.length > 0} className={`${pendingView.users.length === 0 ? '' : 'hidden '}p-8 sm:p-12 text-center rounded-2xl bg-white border border-[#E7E7E2] shadow-sm v3-space-y-3`}>
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-[#111827]">
                Không có yêu cầu nào đang chờ duyệt
              </h3>
              <p className="text-xs sm:text-sm text-[#6B7280] max-w-sm mx-auto">
                Mọi tài khoản đăng ký mới đã được xử lý. Khi có người dùng mới đăng ký, thông báo sẽ xuất hiện tại đây.
              </p>
            </div>
          </div>
          {/* VIEW 2: DANH SÁCH THÀNH VIÊN (ACTIVE MEMBERS) */}
          <div id="view-members" hidden={tab !== "members"} role="tabpanel" aria-labelledby="tab-btn-members" className={`${tab === 'members' ? '' : 'hidden '}v3-space-y-3`}>
            {/* Bảng danh sách trên Desktop */}
            <div className={membersView && !membersEmpty ? `hidden ${TABLE_WRAPPER}` : `hidden ${TABLE_WRAPPER}`}>
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F8F8F6] text-xs font-semibold text-[#6B7280] border-b border-[#E7E7E2]">
                  <tr>
                    <th scope="col" className="py-3 px-4">
                      Thành viên
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Vai trò
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Trạng thái
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Ngày tham gia
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Thiết bị
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody id="table-members-body" className="v3-divide-y divide-[#E7E7E2]">
                  {membersView?.rows.map(m => <MemberRow key={m.id} m={m} isAdmin={membersView.isAdmin} onRole={actions.openRoleModal} onLock={actions.openLockModal} />)}
                </tbody>
              </table>
            </div>
            {/* Danh sách thẻ trên Mobile */}
            <div id="mobile-members-container" className={`sm:hidden v3-space-y-2.5${membersEmpty ? ' hidden' : ''}`}>
              {membersView?.rows.map(m => <MemberCard key={m.id} m={m} isAdmin={membersView.isAdmin} onRole={actions.openRoleModal} onLock={actions.openLockModal} />)}
            </div>
            {/* Trạng thái trống khi tìm kiếm không ra kết quả */}
            <div id="members-empty-search" className={`${membersEmpty ? '' : 'hidden '}p-8 text-center rounded-2xl bg-white border border-[#E7E7E2] v3-space-y-2`}>
              <p className="text-sm font-semibold text-[#111827]">
                Không tìm thấy thành viên phù hợp
              </p>
              <p className="text-xs text-[#6B7280]">
                Hãy thử thay đổi từ khóa tìm kiếm.
              </p>
            </div>
          </div>
        </section>
        <nav aria-label="Phân trang người dùng" className="flex items-center justify-between gap-3 text-xs text-[#6B7280]"><span>Trang {page}</span><div className="flex gap-2"><button disabled={loading || page === 1} onClick={() => setPage(page - 1)} className="px-3 py-2 rounded-lg border border-[#E7E7E2] bg-white">Trang trước</button><button disabled={loading || page * 20 >= total} onClick={() => setPage(page + 1)} className="px-3 py-2 rounded-lg border border-[#E7E7E2] bg-white">Trang sau</button></div></nav>
      </main>
      {/* CHÂN TRANG NHỎ */}
      <footer className="mt-auto border-t border-[#E7E7E2] py-6 text-center text-xs text-[#6B7280]">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>
            ATI — AI Workflow Automation Platform · 2026
          </span>
          <div className="flex items-center gap-4 text-xs">
            <a href="/" onClick={event => { event.preventDefault(); navigate("/"); }} className="hover:text-[#111827] transition-colors">
              Sân khấu điều phối
            </a>
            <a href="/history" onClick={event => { event.preventDefault(); navigate("/history"); }} className="hover:text-[#111827] transition-colors">
              Nhật ký điều phối
            </a>
            <a href="/settings" onClick={event => { event.preventDefault(); navigate("/settings"); }} className="hover:text-[#111827] transition-colors">
              Kết nối dịch vụ
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
      {/* ==================== CÁC MODAL HÀNH ĐỘNG ==================== */}
      {/* 1. MODAL XÁC NHẬN DUYỆT TÀI KHOẢN */}
      {modal === "modal-approve" && <div id="modal-approve" onClick={backdrop('modal-approve')} className={modalClass('modal-approve')} role="dialog" aria-modal="true" aria-labelledby="modal-approve-title">
        <div className="w-full max-w-md bg-white rounded-2xl border border-[#E7E7E2] shadow-2xl p-6 v3-space-y-4">
          <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="v3-space-y-1">
            <h3 id="modal-approve-title" className="text-base font-display font-bold text-[#111827]">
              Duyệt kích hoạt tài khoản
            </h3>
            <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
              {"Bạn sắp phê duyệt cho "}
              <strong id="approve-user-name" className="text-[#111827]">
                {approveUser ? approveUser.name : '...'}
              </strong>
              {" ("}
              <span id="approve-user-email" className="text-[#6B7280]">
                {approveUser ? approveUser.email : '...'}
              </span>
              ) tham gia vào nhóm ATI.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-xs text-[#4B5563] v3-space-y-1">
            <p>
              ✓ Hệ thống sẽ gửi email báo duyệt kích hoạt ngay tới người dùng.
            </p>
            <p>
              ✓ Người này sẽ dùng được các service đã kết nối của nhóm (Trello, Slack, GitHub…).
            </p>
          </div>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={() => closeModal('modal-approve')} disabled={busy} className="btn-close-modal px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-[#4B5563] hover:bg-neutral-100 transition-colors">
              Hủy
            </button>
            <button type="button" id="btn-confirm-approve" disabled={busy} onClick={() => actions.confirmApprove()} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm">
              Xác nhận duyệt ✓
            </button>
          </div>
        </div>
      </div>}
      {/* 2. MODAL KHÓA / MỞ KHÓA TÀI KHOẢN */}
      {modal === "modal-toggle-lock" && <div id="modal-toggle-lock" onClick={backdrop('modal-toggle-lock')} className={modalClass('modal-toggle-lock')} role="dialog" aria-modal="true" aria-labelledby="modal-lock-title">
        <div className="w-full max-w-md bg-white rounded-2xl border border-[#E7E7E2] shadow-2xl p-6 v3-space-y-4">
          <div id="lock-icon-box" className={lockUser?.locked ? 'w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center' : 'w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center'}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div className="v3-space-y-1">
            <h3 id="modal-lock-title" className="text-base font-display font-bold text-[#111827]">
              {lockUser?.locked ? 'Mở khóa tài khoản' : 'Khóa tài khoản'}
            </h3>
            <p id="modal-lock-desc" className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
              {lockUser === null ? 'Người này bị đăng xuất khỏi mọi thiết bị và không đăng nhập được cho tới khi được mở khoá.' : lockUser.locked ? <>
                {'Mở khóa tài khoản cho '}<strong className="text-[#111827]">{lockUser.name}</strong>{'. Sau khi mở khóa, người này có thể đăng nhập lại và sử dụng hệ thống bình thường.'}
              </> : <>
                {'Khóa tài khoản '}<strong className="text-[#111827]">{lockUser.name}</strong>{'?'}<br className="hidden sm:inline" />{' Người này bị đăng xuất khỏi mọi thiết bị và không đăng nhập được cho tới khi được mở khoá.'}
              </>}
            </p>
          </div>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={() => closeModal('modal-toggle-lock')} disabled={busy} className="btn-close-modal px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-[#4B5563] hover:bg-neutral-100 transition-colors">
              Hủy
            </button>
            <button type="button" id="btn-confirm-toggle-lock" disabled={busy} onClick={() => actions.confirmToggleLock()} className={lockUser?.locked ? 'px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm' : 'px-4 py-2 rounded-xl bg-amber-600 text-white text-xs sm:text-sm font-semibold hover:bg-amber-700 transition-colors shadow-sm'}>
              {lockUser?.locked ? 'Xác nhận mở khóa' : 'Xác nhận khóa'}
            </button>
          </div>
        </div>
      </div>}
      {/* 3. MODAL ĐỔI VAI TRÒ THÀNH VIÊN */}
      {modal === "modal-change-role" && <div id="modal-change-role" onClick={backdrop('modal-change-role')} className={modalClass('modal-change-role')} role="dialog" aria-modal="true" aria-labelledby="modal-role-title">
        <div className="w-full max-w-md bg-white rounded-2xl border border-[#E7E7E2] shadow-2xl p-6 v3-space-y-4">
          <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <div className="v3-space-y-1">
            <h3 id="modal-role-title" className="text-base font-display font-bold text-[#111827]">
              Thay đổi vai trò thành viên
            </h3>
            <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
              {"Cập nhật vai trò cho "}
              <strong id="role-user-name" className="text-[#111827]">
                {roleUserName ?? '...'}
              </strong>
            </p>
          </div>
          <div className="v3-space-y-2">
            <label htmlFor="select-new-role" className="block text-xs font-semibold text-[#111827]">
              Vai trò mới:
            </label>
            {' '}
            <p className="text-xs text-[#4B5563]">Quản trị viên có thể duyệt tài khoản và quản lý cấu hình dịch vụ chung.</p>
            <select ref={newRoleRef} value={newRole} onChange={event => setNewRole(event.target.value as Role)} id="select-new-role" className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-[#E7E7E2] bg-white focus:border-[#FF5701] transition-colors">
              {' '}
              <option value="member">
                Thành viên (chỉ gửi yêu cầu, không đổi kết nối chung)
              </option>
              {' '}
              <option value="admin">
                Quản trị viên (quản lý kết nối, duyệt và khóa người dùng)
              </option>
              {' '}
            </select>
          </div>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={() => closeModal('modal-change-role')} disabled={busy} className="btn-close-modal px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-[#4B5563] hover:bg-neutral-100 transition-colors">
              Hủy
            </button>
            <button type="button" id="btn-confirm-change-role" disabled={busy} onClick={() => actions.confirmChangeRole()} className="px-4 py-2 rounded-xl bg-[#FF5701] text-white text-xs sm:text-sm font-semibold hover:bg-[#e04d01] transition-colors shadow-sm">
              Xác nhận đổi vai trò
            </button>
          </div>
        </div>
      </div>}
      {/* JAVASCRIPT ĐIỀU KHIỂN TOÀN BỘ LOGIC */}
    </>
  );
}
