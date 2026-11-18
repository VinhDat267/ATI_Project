import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import { MainNav } from '../../components/layout/MainNav';
import type { User } from '../../types';
import css from './page.css?inline';

import type { Member, PendingUser } from './data';
import { useUsers } from './useUsers';
type Role = 'admin' | 'member';
const TABLE_WRAPPER = 'ps-panel overflow-x-auto sm:block';

function PendingCard({ u, isAdmin, onApprove, onReject }: { u: PendingUser; isAdmin: boolean; onApprove: (id: string) => void; onReject?: (id: string) => void }) {
  const isVerified = !!u.emailVerified;
  return (
    <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="min-w-0 v3-space-y-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="font-semibold text-sm text-[#1a0e08] dark:text-[#F3EEE8]">{u.name}</span>
          <span className="ps-status ps-status-warning">Chờ duyệt</span>
          {!isVerified && <span className="ps-status ps-status-neutral">Chưa xác minh email</span>}
          <span className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A]">{u.requestedAt}</span>
        </div>
        <p className="text-sm text-[#51463E] dark:text-[#D7CEC4] break-all">{u.email}</p>
        <p className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A]">{`Đăng ký qua ${u.provider}`}</p>
      </div>
      <div className="flex flex-col sm:items-end gap-1.5 flex-shrink-0">
        {isAdmin ? (isVerified ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {onReject && (
                <button type="button" onClick={() => onReject(u.id)} className="ps-btn-quiet ps-btn-danger">
                  Từ chối
                </button>
              )}
              <button type="button" onClick={() => onApprove(u.id)} className="ps-btn">
                Duyệt &amp; kích hoạt
              </button>
            </div>
            <span className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A]">Chưa duyệt thì tài khoản không đăng nhập được.</span>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled
              className="ps-btn"
              title="Người này cần bấm link xác minh trong email trước."
            >
              Duyệt &amp; kích hoạt
            </button>
            <span className="text-[13px] text-[#B45309] dark:text-[#FBBF24]">Người này cần bấm link xác minh trong email trước.</span>
          </>
        )) : (
          <span className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A]">Cần quyền Quản trị viên để duyệt</span>
        )}
      </div>
    </div>
  );
}

const roleText = (role: Role) => (role === 'admin' ? 'Quản trị viên' : 'Thành viên');
const SELF_BADGE = <span className="text-[13px] font-medium text-[#6A5F56] dark:text-[#AFA59A]">(Bạn)</span>;

// Dòng bảng thành viên trên desktop (renderMembersList).
function MemberRow({ m, isAdmin, onRole, onLock }: { m: Member; isAdmin: boolean; onRole: (id: string) => void; onLock: (id: string) => void }) {
  const isLocked = m.status === 'locked';
  return (
    <tr className="hover:bg-[#E7DFD3]/40 dark:hover:bg-[#1F1A16] transition-colors">
      <td className="py-3.5 px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-sm text-[#1a0e08] dark:text-[#F3EEE8]">{m.name}</span>
            {m.isSelf ? SELF_BADGE : null}
          </div>
          <p className="text-[13px] text-[#51463E] dark:text-[#D7CEC4]">{m.email}</p>
        </div>
      </td>
      <td className="py-3.5 px-4 text-sm text-[#51463E] dark:text-[#D7CEC4] whitespace-nowrap">{roleText(m.role)}</td>
      <td className="py-3.5 px-4 whitespace-nowrap">
        <span className={`ps-status ${isLocked ? 'ps-status-error' : 'ps-status-connected'}`}>
          {isLocked ? 'Bị tạm khóa' : 'Đang hoạt động'}
        </span>
      </td>
      <td className="py-3.5 px-4 text-[13px] text-[#6A5F56] dark:text-[#AFA59A] tabular-nums whitespace-nowrap">{m.joinedDate}</td>
      <td className="py-3.5 px-4 text-[13px] text-[#6A5F56] dark:text-[#AFA59A] tabular-nums whitespace-nowrap">{`${m.sessionsCount} thiết bị`}</td>
      <td className="py-3.5 px-4 text-right whitespace-nowrap">
        {isAdmin && !m.isSelf ? (
          <div className="inline-flex items-center gap-2">
            <button type="button" onClick={() => onRole(m.id)} className="ps-btn-quiet" title="Đổi vai trò">
              Đổi vai trò
            </button>
            <button
              type="button"
              onClick={() => onLock(m.id)}
              className={isLocked ? 'ps-btn-quiet' : 'ps-btn-quiet ps-btn-danger'}
              title={isLocked ? 'Mở khóa' : 'Khóa'}
            >
              {isLocked ? 'Mở khóa' : 'Khóa'}
            </button>
          </div>
        ) : (
          <span className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A]">{m.isSelf ? '—' : 'Chỉ xem'}</span>
        )}
      </td>
    </tr>
  );
}

// Hàng thành viên trên mobile (renderMembersList).
function MemberCard({ m, isAdmin, onRole, onLock }: { m: Member; isAdmin: boolean; onRole: (id: string) => void; onLock: (id: string) => void }) {
  const isLocked = m.status === 'locked';
  return (
    <div className="p-4 v3-space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-sm text-[#1a0e08] dark:text-[#F3EEE8]">{m.name}</span>
            {m.isSelf ? SELF_BADGE : null}
          </div>
          <p className="text-[13px] text-[#51463E] dark:text-[#D7CEC4] break-all">{m.email}</p>
        </div>
        <span className="text-[13px] text-[#51463E] dark:text-[#D7CEC4] flex-shrink-0">{roleText(m.role)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[13px] text-[#6A5F56] dark:text-[#AFA59A]">
        <span className={`ps-status ${isLocked ? 'ps-status-error' : 'ps-status-connected'}`}>
          {isLocked ? 'Bị tạm khóa' : 'Đang hoạt động'}
        </span>
        <span className="tabular-nums">{`Tham gia: ${m.joinedDate}`}</span>
      </div>
      {isAdmin && !m.isSelf ? (
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={() => onRole(m.id)} className="ps-btn-quiet">
            Đổi vai trò
          </button>
          <button
            type="button"
            onClick={() => onLock(m.id)}
            className={isLocked ? 'ps-btn-quiet' : 'ps-btn-quiet ps-btn-danger'}
          >
            {isLocked ? 'Mở khóa' : 'Khóa'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const meta: PageMeta = {
  id: "users",
  title: "Người dùng — Planora",
  htmlClass: "",
  bodyClass: "min-h-screen flex flex-col bg-[#F8F4EE] text-[#1a0e08]",
  css,
};

export interface UsersPageProps { user: User | null; navigate: (path: string) => void; onLogout: () => void }
export function UsersPage({ user, navigate, onLogout }: UsersPageProps) {
  usePrototypePage(meta);
  const { tab, search, setSearch, page, setPage, total, loading, busy, error, notice, modal, selected, newRole, setNewRole, newRoleRef, pendingView, membersView, stats, actions, closeModal, inviteCode, requireApproval, canManage } = useUsers(user);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const role = user?.role ?? 'member', membersEmpty = membersView.rows.length === 0;
  const approveUser = modal === 'modal-approve' ? selected : null, lockUser = selected ? { name: selected.name, locked: selected.status === 'disabled' } : null, roleUserName = selected?.name;
  const modalClass = (_id: string) => 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45';
  const backdrop = (_id: string) => (event: ReactMouseEvent) => { if (event.target === event.currentTarget) closeModal(); };
  if (!canManage) {
    return (
      <main className="p-6 max-w-xl mx-auto v3-space-y-4">
        <p role="alert" className="text-sm text-[#1a0e08] dark:text-[#F3EEE8]">Bạn không có quyền quản trị người dùng.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-lg border border-[#E3DACE] dark:border-[#2A231E] bg-white dark:bg-[#1A1613] text-sm font-semibold text-[#1a0e08] dark:text-[#F3EEE8]"
        >
          Về trang chính
        </button>
      </main>
    );
  }
  return (
    <>
      {/* FE-12: thanh điều hướng chung thay thanh trên của bản mẫu. */}
      <MainNav user={user} current="users" pageName="Người dùng" navigate={navigate} onLogout={onLogout} />
      {/* NỘI DUNG CHÍNH */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 v3-space-y-6">
        {!modal && error && <p role="alert" className="text-sm text-[#B91C1C] dark:text-[#F87171]">{error}</p>}
        {notice && <p role="status" className="text-sm text-[#047857] dark:text-[#34D399]">{notice}</p>}
        {loading && <p role="status" className="ps-note">Đang tải người dùng...</p>}
        {/* PHẦN TIÊU ĐỀ */}
        <div className="ps-pagehead">
          <h1>Người dùng</h1>
          <p>Thành viên mới tự đăng ký rồi chờ bạn duyệt.</p>
        </div>
        {inviteCode && (
          <section aria-label="Mã mời tổ chức" className="ps-panel p-4 sm:p-5 v3-space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E3DACE] dark:border-[#2A231E] pb-3.5">
              <div>
                <div className="text-[13px] font-medium text-[#6A5F56] dark:text-[#AFA59A]">
                  Mã mời tham gia tổ chức
                </div>
                <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
                  <span className="font-mono text-base sm:text-lg font-semibold text-[#1a0e08] dark:text-[#F3EEE8] tracking-wider">
                    {inviteCode}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        try { navigator.clipboard?.writeText(inviteCode); } catch {}
                        setCopiedCode(true);
                        setTimeout(() => setCopiedCode(false), 2000);
                      }}
                      className="ps-btn-quiet"
                    >
                      {copiedCode ? 'Đã chép' : 'Sao chép mã'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const link = typeof window !== 'undefined' ? `${window.location.origin}/?invite=${inviteCode}` : `/?invite=${inviteCode}`;
                        try { navigator.clipboard?.writeText(link); } catch {}
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      className="ps-btn-quiet"
                    >
                      {copiedLink ? 'Đã chép' : 'Sao chép Link mời'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void actions.regenerateInviteCode()}
                      className="ps-btn-quiet"
                    >
                      Đổi mã mới
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2 sm:pt-0">
                <input
                  id="toggle-require-approval"
                  type="checkbox"
                  aria-label="Cần Quản trị viên duyệt thành viên mới"
                  checked={requireApproval}
                  onChange={(e) => void actions.toggleRequireApproval(e.target.checked)}
                  className="rounded border-[#E3DACE] dark:border-[#2A231E] text-[#C84300] focus:ring-[#C84300]"
                />
                <label htmlFor="toggle-require-approval" className="text-sm font-medium text-[#1a0e08] dark:text-[#F3EEE8] cursor-pointer">
                  Cần Quản trị viên duyệt thành viên mới
                </label>
              </div>
            </div>
            <p className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A]">
              Gửi mã mời hoặc link mời cho thành viên. {requireApproval ? 'Thành viên dùng mã mời sẽ ở trạng thái Chờ duyệt cho tới khi Quản trị viên phê duyệt.' : 'Thành viên dùng mã mời sẽ được tham gia và kích hoạt ngay lập tức.'}
            </p>
          </section>
        )}
        {/* DẢI THỐNG KÊ TỔNG QUAN (.ps-stats) */}
        <section className="ps-panel ps-stats" aria-label="Thống kê tổng quan thành viên">
          <div className="ps-stat cursor-default! hover:bg-transparent!">
            <span className="ps-stat-label">Tổng thành viên</span>
            <span id="stat-total-members" className="ps-stat-value">{stats.total}</span>
          </div>
          <div className="ps-stat cursor-default! hover:bg-transparent!">
            <span className="ps-stat-label">Chờ phê duyệt</span>
            <span id="stat-pending-approvals" className="ps-stat-value">{stats.pending}</span>
          </div>
          <div className="ps-stat cursor-default! hover:bg-transparent!">
            <span className="ps-stat-label">Đang hoạt động</span>
            <span id="stat-active-members" className="ps-stat-value">{stats.active}</span>
          </div>
          <div className="ps-stat cursor-default! hover:bg-transparent!">
            <span className="ps-stat-label">Đang bị khóa</span>
            <span id="stat-locked-members" className="ps-stat-value">{stats.locked}</span>
          </div>
        </section>
        {/* THANH TABS CHUYỂN ĐỔI & BỘ LỌC TÌM KIẾM */}
        <section className="v3-space-y-4">
          <div className="ps-sectionhead">
            <div className="ps-segmented" role="tablist" aria-label="Phân nhóm quản lý người dùng">
              <button
                type="button"
                id="tab-btn-pending"
                role="tab"
                aria-selected={tab === 'pending' ? 'true' : 'false'}
                aria-controls="view-pending"
                onClick={() => actions.switchTab('pending')}
                className="inline-flex items-center gap-2"
              >
                <span>Chờ duyệt</span>
                <span id="tab-badge-pending-count" className="ps-groupcount">{stats.pending}</span>
              </button>
              <button
                type="button"
                id="tab-btn-members"
                role="tab"
                aria-selected={tab === 'members' ? 'true' : 'false'}
                aria-controls="view-members"
                onClick={() => actions.switchTab('members')}
                className="inline-flex items-center gap-2"
              >
                <span>Thành viên</span>
                <span id="tab-badge-members-count" className="ps-groupcount">{stats.total}</span>
              </button>
            </div>
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              type="search"
              id="input-search-users"
              placeholder="Tìm theo tên hoặc email…"
              className="ps-field w-full sm:w-72"
              aria-label="Tìm kiếm theo tên hoặc email"
            />
          </div>
          {/* CẢNH BÁO KHI XEM VAI TRÒ THÀNH VIÊN */}
          <div id="banner-member-readonly" className={`${role === 'member' ? '' : 'hidden '}ps-panel p-3.5 text-sm text-[#51463E] dark:text-[#D7CEC4]`}>
            Bạn đang xem với vai trò <strong className="text-[#1a0e08] dark:text-[#F3EEE8]">Thành viên</strong>. Chỉ Quản trị viên mới có quyền duyệt tài khoản mới, đổi vai trò hoặc tạm khóa thành viên.
          </div>
          {/* VIEW 1: DANH SÁCH CHỜ DUYỆT */}
          <div id="view-pending" hidden={tab !== 'pending'} role="tabpanel" aria-labelledby="tab-btn-pending" className={`${tab === 'pending' ? '' : 'hidden '}v3-space-y-3`}>
            {pendingView.isAdmin && pendingView.users.length > 0 && (
              <div className="flex justify-end">
                <button type="button" onClick={() => void actions.approveAllPending()} className="ps-btn-quiet">
                  Chấp thuận tất cả
                </button>
              </div>
            )}
            <div id="pending-list-container" className={pendingView.users.length === 0 ? 'hidden' : 'ps-panel ps-rows'}>
              {pendingView.users.map(u => <PendingCard key={u.id} u={u} isAdmin={pendingView.isAdmin} onApprove={actions.openApproveModal} onReject={actions.rejectPendingUser} />)}
            </div>
            <div id="pending-empty-state" hidden={loading || pendingView.users.length > 0} className={`${pendingView.users.length === 0 ? '' : 'hidden '}ps-panel p-6 sm:p-8 text-center v3-space-y-1.5`}>
              <h3 className="font-sans text-base font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
                Không có yêu cầu nào đang chờ duyệt
              </h3>
              <p className="ps-note max-w-md mx-auto">
                Mọi tài khoản đăng ký mới đã được xử lý. Khi có người dùng mới đăng ký, thông báo sẽ xuất hiện tại đây.
              </p>
            </div>
          </div>
          {/* VIEW 2: DANH SÁCH THÀNH VIÊN */}
          <div id="view-members" hidden={tab !== 'members'} role="tabpanel" aria-labelledby="tab-btn-members" className={`${tab === 'members' ? '' : 'hidden '}v3-space-y-3`}>
            <div className={membersView && !membersEmpty ? `hidden ${TABLE_WRAPPER}` : 'hidden'}>
              <table className="w-full text-left text-sm">
                <thead className="bg-[#F8F4EE] dark:bg-[#131010] text-[13px] font-semibold text-[#6A5F56] dark:text-[#AFA59A] border-b border-[#E3DACE] dark:border-[#2A231E]">
                  <tr>
                    <th scope="col" className="py-3 px-4 whitespace-nowrap">Thành viên</th>
                    <th scope="col" className="py-3 px-4 whitespace-nowrap">Vai trò</th>
                    <th scope="col" className="py-3 px-4 whitespace-nowrap">Trạng thái</th>
                    <th scope="col" className="py-3 px-4 whitespace-nowrap">Ngày tham gia</th>
                    <th scope="col" className="py-3 px-4 whitespace-nowrap">Thiết bị</th>
                    <th scope="col" className="py-3 px-4 text-right whitespace-nowrap">Thao tác</th>
                  </tr>
                </thead>
                <tbody id="table-members-body" className="divide-y divide-[#E3DACE] dark:divide-[#2A231E]">
                  {membersView?.rows.map(m => <MemberRow key={m.id} m={m} isAdmin={membersView.isAdmin} onRole={actions.openRoleModal} onLock={actions.openLockModal} />)}
                </tbody>
              </table>
            </div>
            <div id="mobile-members-container" className={`sm:hidden ps-panel ps-rows${membersEmpty ? ' hidden' : ''}`}>
              {membersView?.rows.map(m => <MemberCard key={m.id} m={m} isAdmin={membersView.isAdmin} onRole={actions.openRoleModal} onLock={actions.openLockModal} />)}
            </div>
            <div id="members-empty-search" className={`${membersEmpty ? '' : 'hidden '}ps-panel p-6 sm:p-8 text-center v3-space-y-1.5`}>
              <p className="text-base font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
                Không tìm thấy thành viên phù hợp
              </p>
              <p className="ps-note">Hãy thử thay đổi từ khóa tìm kiếm.</p>
            </div>
          </div>
        </section>
        <nav aria-label="Phân trang người dùng" className="flex items-center justify-between gap-3 text-[13px] text-[#6A5F56] dark:text-[#AFA59A]">
          <span>Trang {page}</span>
          <div className="flex gap-2">
            <button type="button" disabled={loading || page === 1} onClick={() => setPage(page - 1)} className="ps-btn-quiet">
              Trang trước
            </button>
            <button type="button" disabled={loading || page * 20 >= total} onClick={() => setPage(page + 1)} className="ps-btn-quiet">
              Trang sau
            </button>
          </div>
        </nav>
      </main>
      {/* ==================== CÁC MODAL HÀNH ĐỘNG ==================== */}
      {modal === "modal-approve" && <div id="modal-approve" onClick={backdrop('modal-approve')} className={modalClass('modal-approve')} role="dialog" aria-modal="true" aria-labelledby="modal-approve-title">
        <div className="ps-panel w-full max-w-md p-6 v3-space-y-4">
          <div className="v3-space-y-1">
            <h3 id="modal-approve-title" className="text-base sm:text-lg font-sans font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
              Duyệt kích hoạt tài khoản
            </h3>
            <p className="ps-note">
              {'Bạn sắp phê duyệt cho '}
              <strong id="approve-user-name" className="text-[#1a0e08] dark:text-[#F3EEE8]">
                {approveUser ? approveUser.name : '...'}
              </strong>
              {' ('}
              <span id="approve-user-email" className="text-[#51463E] dark:text-[#D7CEC4]">
                {approveUser ? approveUser.email : '...'}
              </span>
              ) tham gia vào nhóm Planora.
            </p>
          </div>
          <div className="text-[13px] text-[#51463E] dark:text-[#D7CEC4] v3-space-y-1 border-t border-[#E3DACE] dark:border-[#2A231E] pt-3">
            <p>• Hệ thống sẽ gửi email báo duyệt kích hoạt ngay tới người dùng.</p>
            <p>• Người này sẽ dùng được các service đã kết nối của nhóm (Trello, Slack, GitHub…).</p>
          </div>
          {error && <p role="alert" className="text-xs text-[#B91C1C] dark:text-[#F87171]">{error}</p>}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={() => closeModal('modal-approve')} disabled={busy} className="btn-close-modal ps-btn-quiet">
              Hủy
            </button>
            <button type="button" id="btn-confirm-approve" disabled={busy} onClick={() => actions.confirmApprove()} className="ps-btn">
              Xác nhận duyệt
            </button>
          </div>
        </div>
      </div>}
      {modal === "modal-toggle-lock" && <div id="modal-toggle-lock" onClick={backdrop('modal-toggle-lock')} className={modalClass('modal-toggle-lock')} role="dialog" aria-modal="true" aria-labelledby="modal-lock-title">
        <div className="ps-panel w-full max-w-md p-6 v3-space-y-4">
          <div className="v3-space-y-1">
            <h3 id="modal-lock-title" className="text-base sm:text-lg font-sans font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
              {lockUser?.locked ? 'Mở khóa tài khoản' : 'Khóa tài khoản'}
            </h3>
            <p id="modal-lock-desc" className="ps-note">
              {lockUser === null ? 'Người này bị đăng xuất khỏi mọi thiết bị và không đăng nhập được cho tới khi được mở khoá.' : lockUser.locked ? <>
                {'Mở khóa tài khoản cho '}<strong className="text-[#1a0e08] dark:text-[#F3EEE8]">{lockUser.name}</strong>{'. Sau khi mở khóa, người này có thể đăng nhập lại và sử dụng hệ thống bình thường.'}
              </> : <>
                {'Khóa tài khoản '}<strong className="text-[#1a0e08] dark:text-[#F3EEE8]">{lockUser.name}</strong>{'?'}<br className="hidden sm:inline" />{' Người này bị đăng xuất khỏi mọi thiết bị và không đăng nhập được cho tới khi được mở khoá.'}
              </>}
            </p>
          </div>
          {error && <p role="alert" className="text-xs text-[#B91C1C] dark:text-[#F87171]">{error}</p>}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={() => closeModal('modal-toggle-lock')} disabled={busy} className="btn-close-modal ps-btn-quiet">
              Hủy
            </button>
            <button
              type="button"
              id="btn-confirm-toggle-lock"
              disabled={busy}
              onClick={() => actions.confirmToggleLock()}
              className={lockUser?.locked ? 'ps-btn' : 'ps-btn-quiet ps-btn-danger'}
            >
              {lockUser?.locked ? 'Xác nhận mở khóa' : 'Xác nhận khóa'}
            </button>
          </div>
        </div>
      </div>}
      {modal === "modal-change-role" && <div id="modal-change-role" onClick={backdrop('modal-change-role')} className={modalClass('modal-change-role')} role="dialog" aria-modal="true" aria-labelledby="modal-role-title">
        <div className="ps-panel w-full max-w-md p-6 v3-space-y-4">
          <div className="v3-space-y-1">
            <h3 id="modal-role-title" className="text-base sm:text-lg font-sans font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
              Thay đổi vai trò thành viên
            </h3>
            <p className="ps-note">
              {'Cập nhật vai trò cho '}
              <strong id="role-user-name" className="text-[#1a0e08] dark:text-[#F3EEE8]">
                {roleUserName ?? '...'}
              </strong>
            </p>
          </div>
          <div className="v3-space-y-2">
            <label htmlFor="select-new-role" className="block text-sm font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
              Vai trò mới:
            </label>
            <p className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A]">Quản trị viên có thể duyệt tài khoản và quản lý cấu hình dịch vụ chung.</p>
            <select ref={newRoleRef} value={newRole} onChange={event => setNewRole(event.target.value as Role)} id="select-new-role" className="ps-field w-full">
              <option value="member">
                Thành viên (chỉ gửi yêu cầu, không đổi kết nối chung)
              </option>
              <option value="admin">
                Quản trị viên (quản lý kết nối, duyệt và khóa người dùng)
              </option>
            </select>
          </div>
          {error && <p role="alert" className="text-xs text-[#B91C1C] dark:text-[#F87171]">{error}</p>}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={() => closeModal('modal-change-role')} disabled={busy} className="btn-close-modal ps-btn-quiet">
              Hủy
            </button>
            <button type="button" id="btn-confirm-change-role" disabled={busy} onClick={() => actions.confirmChangeRole()} className="ps-btn">
              Xác nhận đổi vai trò
            </button>
          </div>
        </div>
      </div>}
    </>
  );
}
