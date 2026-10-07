// Chuyển từ docs/design/prototypes/users.html bằng scripts/html-to-jsx.mjs, sau đó sửa tay.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { usePrototypePage, type PageMeta } from '../../app/usePrototypePage';
import css from './page.css?inline';
import { INITIAL_MEMBERS, INITIAL_PENDING, type Member, type PendingUser } from './data';

type Role = 'admin' | 'member';
type Tab = 'pending' | 'members';
type ModalId = 'modal-approve' | 'modal-toggle-lock' | 'modal-change-role';
type Toast = { id: number; message: string; icon: string; phase: 'enter' | 'shown' | 'leaving' };
// Ảnh chụp danh sách tại lần vẽ gần nhất: bản mẫu chỉ vẽ lại ở một số thao tác, giữa các lần đó DOM giữ nội dung cũ.
type PendingView = { users: PendingUser[]; isAdmin: boolean };
type MembersView = { rows: Member[]; isAdmin: boolean };
type Stats = { total: number; pending: number; active: number; locked: number };

const TAB_ON = 'flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all bg-[#FF5701] text-white shadow-sm';
const TAB_OFF = 'flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all text-[#6B7280] hover:text-[#111827]';
const DEMO_ROLE_ON = 'py-1 px-2 rounded-md font-medium text-center transition-colors bg-white shadow-sm text-[#FF5701]';
const DEMO_ROLE_OFF = 'py-1 px-2 rounded-md font-medium text-center transition-colors text-[#4B5563] hover:text-[#111827]';
const TOAST_BASE = 'px-4 py-2.5 rounded-xl bg-white border border-[#E7E7E2] shadow-lg text-xs font-medium text-[#111827] flex items-center gap-2 transform transition-all duration-300 pointer-events-auto';
const TOAST_PHASE = { enter: 'translate-y-2 opacity-0', shown: '', leaving: 'opacity-0 -translate-y-2' };
const TOAST_ICON: Record<string, string> = { info: 'text-[#FF5701]', success: 'text-emerald-600', warn: 'text-amber-600', danger: 'text-red-600' };
const TABLE_WRAPPER = 'overflow-hidden rounded-2xl bg-white border border-[#E7E7E2] shadow-sm sm:block';
const clone = <T,>(list: T[]): T[] => list.map(item => ({ ...item }));
const statsOf = (pending: PendingUser[], members: Member[]): Stats => ({
  total: members.length,
  pending: pending.length,
  active: members.filter(m => m.status === 'active').length,
  locked: members.filter(m => m.status === 'locked').length,
});

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

export function UsersPage() {
  usePrototypePage(meta);
  // Dữ liệu như biến toàn cục của bản mẫu; giao diện chỉ đổi khi gọi các hàm vẽ lại bên dưới.
  const model = useRef({ role: 'admin' as Role, tab: 'pending' as Tab, selectedUserId: null as string | null, pending: clone(INITIAL_PENDING), members: clone(INITIAL_MEMBERS) });
  const [stats, setStats] = useState<Stats>(() => statsOf(INITIAL_PENDING, INITIAL_MEMBERS));
  const [pendingView, setPendingView] = useState<PendingView>(() => ({ users: clone(INITIAL_PENDING), isAdmin: true }));
  const [membersView, setMembersView] = useState<MembersView | null>(null);
  const [tab, setTabView] = useState<Tab>('pending');
  const [role, setRoleView] = useState<Role>('admin');
  const [menuOpen, setMenuOpen] = useState(false);
  const [openModals, setOpenModals] = useState<ModalId[]>([]);
  const [approveUser, setApproveUser] = useState<{ name: string; email: string } | null>(null);
  const [lockUser, setLockUser] = useState<{ name: string; locked: boolean } | null>(null);
  const [roleUserName, setRoleUserName] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLSelectElement>(null);
  const approveRoleRef = useRef<HTMLSelectElement>(null);
  const newRoleRef = useRef<HTMLSelectElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const toastId = useRef(0);
  const timers = useRef<number[]>([]);
  const later = (ms: number, run: () => void) => { timers.current.push(window.setTimeout(run, ms)); };
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
  // Bấm ngoài menu demo thì đóng; Esc đóng mọi hộp thoại và menu.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && event.target !== menuButtonRef.current) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenModals([]);
      setMenuOpen(false);
    };
    document.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey); };
  }, []);

  const showToast = (message: string, type = 'info') => {
    const id = ++toastId.current;
    setToasts(list => [...list, { id, message, icon: TOAST_ICON[type] ?? TOAST_ICON.info, phase: 'enter' }]);
    requestAnimationFrame(() => setToasts(list => list.map(t => (t.id === id ? { ...t, phase: 'shown' } : t))));
    later(3500, () => {
      setToasts(list => list.map(t => (t.id === id ? { ...t, phase: 'leaving' } : t)));
      later(300, () => setToasts(list => list.filter(t => t.id !== id)));
    });
  };
  const query = () => searchRef.current?.value.trim().toLowerCase() ?? '';
  const updateStats = () => setStats(statsOf(model.current.pending, model.current.members));
  const renderPendingList = () => {
    const q = query();
    setPendingView({
      users: clone(model.current.pending.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))),
      isAdmin: model.current.role === 'admin',
    });
  };
  const renderMembersList = () => {
    const q = query();
    const roleFilter = filterRef.current?.value ?? 'all';
    setMembersView({
      rows: clone(model.current.members.filter(m => (m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) && (roleFilter === 'all' || m.role === roleFilter))),
      isAdmin: model.current.role === 'admin',
    });
  };
  const openModal = (id: ModalId) => setOpenModals(list => (list.includes(id) ? list : [...list, id]));
  const closeModal = (id: ModalId) => setOpenModals(list => list.filter(m => m !== id));
  const actions = {
    switchTab(next: Tab) {
      model.current.tab = next;
      setTabView(next);
      if (next === 'pending') renderPendingList(); else renderMembersList();
    },
    onSearch() { if (model.current.tab === 'pending') renderPendingList(); else renderMembersList(); },
    setRole(next: Role) {
      model.current.role = next;
      setRoleView(next);
      renderPendingList();
      renderMembersList();
      showToast(`Đã chuyển vai trò xem sang: ${roleText(next)}`);
    },
    addSamplePending() {
      model.current.pending.unshift({ id: 'pen_' + Math.floor(Math.random() * 899 + 100), name: 'Trần Gia Hưng', email: 'hung.tran@congty.vn', provider: 'Email', emailVerified: true, requestedAt: 'Vừa xong', avatarInitials: 'GH' });
      updateStats();
      if (model.current.tab === 'pending') renderPendingList();
      setMenuOpen(false);
      showToast('Đã thêm 1 yêu cầu duyệt mới từ Trần Gia Hưng', 'info');
    },
    resetData() {
      model.current.pending = clone(INITIAL_PENDING);
      updateStats();
      if (model.current.tab === 'pending') renderPendingList(); else renderMembersList();
      setMenuOpen(false);
      showToast('Đã khôi phục danh sách người dùng mẫu ban đầu');
    },
    openApproveModal(id: string) {
      const user = model.current.pending.find(u => u.id === id);
      if (!user) return;
      model.current.selectedUserId = id;
      setApproveUser({ name: user.name, email: user.email });
      openModal('modal-approve');
    },
    confirmApprove() {
      const user = model.current.pending.find(u => u.id === model.current.selectedUserId);
      if (!user) return;
      const assignedRole = (approveRoleRef.current?.value ?? 'member') as Role;
      model.current.pending = model.current.pending.filter(u => u.id !== model.current.selectedUserId);
      model.current.members.unshift({ id: 'usr_' + Date.now().toString().slice(-4), name: user.name, email: user.email, role: assignedRole, status: 'active', joinedDate: 'Hôm nay', sessionsCount: 1, avatarInitials: user.avatarInitials, isSelf: false });
      closeModal('modal-approve');
      updateStats();
      renderPendingList();
      showToast('Đã duyệt. Hệ thống gửi email báo cho người dùng.', 'success');
    },
    openLockModal(id: string) {
      const user = model.current.members.find(m => m.id === id);
      if (!user) return;
      model.current.selectedUserId = id;
      setLockUser({ name: user.name, locked: user.status === 'locked' });
      openModal('modal-toggle-lock');
    },
    confirmToggleLock() {
      const user = model.current.members.find(m => m.id === model.current.selectedUserId);
      if (!user) return;
      const wasLocked = user.status === 'locked';
      user.status = wasLocked ? 'active' : 'locked';
      if (!wasLocked) user.sessionsCount = 0;
      closeModal('modal-toggle-lock');
      updateStats();
      renderMembersList();
      showToast(wasLocked ? `Đã mở khóa tài khoản cho ${user.name}` : `Đã khóa tài khoản của ${user.name}`, wasLocked ? 'success' : 'warn');
    },
    openRoleModal(id: string) {
      const user = model.current.members.find(m => m.id === id);
      if (!user) return;
      model.current.selectedUserId = id;
      setRoleUserName(user.name);
      if (newRoleRef.current) newRoleRef.current.value = user.role;
      openModal('modal-change-role');
    },
    confirmChangeRole() {
      const user = model.current.members.find(m => m.id === model.current.selectedUserId);
      if (!user) return;
      const newRole = (newRoleRef.current?.value ?? user.role) as Role;
      user.role = newRole;
      closeModal('modal-change-role');
      renderMembersList();
      showToast(`Đã cập nhật vai trò của ${user.name} thành: ${roleText(newRole)}`, 'success');
    },
  };
  // Bấm nền tối của hộp thoại (không phải nội dung) thì đóng.
  const backdrop = (id: ModalId) => (event: ReactMouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) closeModal(id); };
  const modalClass = (id: ModalId) => `${openModals.includes(id) ? '' : 'hidden '}fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm`;
  const membersEmpty = membersView !== null && membersView.rows.length === 0;
  return (
    <>
      {/* Toast Thông báo nổi */}
      <div id="toast-container" className="fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center gap-2" role="status" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`${TOAST_BASE} ${TOAST_PHASE[toast.phase]}`.trim()}>
            <span className={`${toast.icon} font-bold text-sm`}>●</span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
      {/* THANH TRÊN (COCKPIT HEADER) */}
      <header className="sticky top-0 z-30 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          {/* Cụm Logo & Điều hướng quay lại */}
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <a href="/app-stage" className="flex items-center gap-2.5 group flex-shrink-0" title="Về sân khấu điều phối">
              <div className="w-8 h-8 rounded-lg bg-[#FF5701] flex items-center justify-center text-white font-display font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
                A
              </div>
              <span className="font-display font-bold text-lg tracking-tight text-[#111827]">
                ATI
              </span>
            </a>
            <div className="h-4 w-px bg-[#E7E7E2] flex-shrink-0" />
            <a href="/app-stage" className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Quay lại không gian làm việc">
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
            <a href="/history" className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Nhật ký điều phối">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {' '}
              <span>
                Nhật ký
              </span>
            </a>
            <a href="/settings" className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Kết nối dịch vụ">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              {' '}
              <span>
                Kết nối dịch vụ
              </span>
            </a>
            <a href="/account" className="hidden lg:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Tài khoản">
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
            <div className="relative">
              <button ref={menuButtonRef} onClick={(event) => { event.stopPropagation(); setMenuOpen(open => !open); }} id="btn-demo-scenario" type="button" className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-[#E7E7E2] bg-white text-[#4B5563] hover:text-[#111827] hover:border-neutral-400 transition-colors shadow-sm" aria-haspopup="true" aria-expanded="false" title="Tùy chọn kịch bản thử nghiệm">
                <svg className="w-3.5 h-3.5 text-[#FF5701]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
                <span className="hidden sm:inline">
                  Kịch bản
                </span>
                <svg className="w-3 h-3 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {' '}
              {/* Dropdown menu demo */}
              {' '}
              <div ref={menuRef} id="demo-menu-dropdown" className={`${menuOpen ? '' : 'hidden '}absolute right-0 mt-2 w-64 rounded-xl bg-white border border-[#E7E7E2] shadow-xl p-3 v3-space-y-3 z-40 text-xs`}>
                <div>
                  <p className="font-semibold text-[#111827] mb-1.5">
                    Xem như vai trò:
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#F8F8F6] rounded-lg border border-[#E7E7E2]">
                    <button type="button" id="demo-role-admin" onClick={() => actions.setRole('admin')} className={role === 'admin' ? DEMO_ROLE_ON : DEMO_ROLE_OFF}>
                      Quản trị viên
                    </button>
                    <button type="button" id="demo-role-member" onClick={() => actions.setRole('member')} className={role === 'member' ? DEMO_ROLE_ON : DEMO_ROLE_OFF}>
                      Thành viên
                    </button>
                  </div>
                </div>
                <div className="pt-2 border-t border-[#E7E7E2] v3-space-y-1.5">
                  <button type="button" id="btn-demo-add-pending" onClick={() => actions.addSamplePending()} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 text-[#4B5563] flex items-center justify-between">
                    <span>
                      Thêm 1 yêu cầu duyệt mẫu
                    </span>
                    <span className="text-[#FF5701] font-semibold">
                      +1
                    </span>
                  </button>
                  {' '}
                  <button type="button" id="btn-demo-reset-data" onClick={() => actions.resetData()} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500">
                    {" Khôi phục danh sách mẫu "}
                  </button>
                </div>
              </div>
            </div>
            {/* Avatar Người dùng */}
            <a href="/account" className="w-8 h-8 rounded-full bg-[#FF5701] text-white flex items-center justify-center font-semibold text-xs tracking-wider shadow-sm hover:ring-2 hover:ring-[#FF5701]/30 transition-all" title="Tài khoản của Lan Nguyễn">
              LN
            </a>
          </div>
        </div>
      </header>
      {/* NỘI DUNG CHÍNH */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 v3-space-y-8">
        {/* PHẦN TIÊU ĐỀ & NGUYÊN TẮC AN TOÀN */}
        <section className="v3-space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <nav className="flex items-center gap-1.5 text-xs text-[#6B7280] mb-2" aria-label="Đường dẫn chuyển trang">
                <a href="/app-stage" className="hover:text-[#111827] transition-colors">
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
                <input ref={searchRef} onInput={() => actions.onSearch()} type="text" id="input-search-users" placeholder="Tìm theo tên hoặc email…" className="w-full text-xs sm:text-sm px-3 py-2 pl-8 rounded-lg border border-[#E7E7E2] bg-white text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] transition-colors" aria-label="Tìm kiếm theo tên hoặc email" />
                {' '}
                <svg className="w-4 h-4 text-[#9CA3AF] absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              {/* Lọc vai trò (chỉ hiện ở tab Thành viên) */}
              <select ref={filterRef} onChange={() => renderMembersList()} id="select-filter-role" className={`${tab === 'members' ? '' : 'hidden '}text-xs sm:text-sm px-2.5 py-2 rounded-lg border border-[#E7E7E2] bg-white text-[#4B5563] focus:border-[#FF5701] transition-colors`} aria-label="Lọc theo vai trò">
                <option value="all">
                  Tất cả vai trò
                </option>
                {' '}
                <option value="admin">
                  Quản trị viên
                </option>
                {' '}
                <option value="member">
                  Thành viên
                </option>
              </select>
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
          <div id="view-pending" role="tabpanel" aria-labelledby="tab-btn-pending" className={`${tab === 'pending' ? '' : 'hidden '}v3-space-y-3`}>
            <div id="pending-list-container" className={`v3-space-y-3${pendingView.users.length === 0 ? ' hidden' : ''}`}>
              {pendingView.users.map(u => <PendingCard key={u.id} u={u} isAdmin={pendingView.isAdmin} onApprove={actions.openApproveModal} />)}
            </div>
            {/* Trạng thái trống khi đã duyệt hết */}
            <div id="pending-empty-state" className={`${pendingView.users.length === 0 ? '' : 'hidden '}p-8 sm:p-12 text-center rounded-2xl bg-white border border-[#E7E7E2] shadow-sm v3-space-y-3`}>
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
          <div id="view-members" role="tabpanel" aria-labelledby="tab-btn-members" className={`${tab === 'members' ? '' : 'hidden '}v3-space-y-3`}>
            {/* Bảng danh sách trên Desktop */}
            <div className={membersView && !membersEmpty ? TABLE_WRAPPER : `hidden ${TABLE_WRAPPER}`}>
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
                Hãy thử thay đổi từ khóa tìm kiếm hoặc bỏ bộ lọc vai trò.
              </p>
            </div>
          </div>
        </section>
      </main>
      {/* CHÂN TRANG NHỎ */}
      <footer className="mt-auto border-t border-[#E7E7E2] py-6 text-center text-xs text-[#6B7280]">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>
            ATI — AI Workflow Automation Platform · 2026
          </span>
          <div className="flex items-center gap-4 text-xs">
            <a href="/app-stage" className="hover:text-[#111827] transition-colors">
              Sân khấu điều phối
            </a>
            <a href="/history" className="hover:text-[#111827] transition-colors">
              Nhật ký điều phối
            </a>
            <a href="/settings" className="hover:text-[#111827] transition-colors">
              Kết nối dịch vụ
            </a>
            <a href="/account" className="hover:text-[#111827] transition-colors">
              Tài khoản
            </a>
            <a href="/privacy" className="text-[#FF5701] hover:underline font-medium transition-colors">
              Chính sách an toàn
            </a>
          </div>
        </div>
      </footer>
      {/* ==================== CÁC MODAL HÀNH ĐỘNG ==================== */}
      {/* 1. MODAL XÁC NHẬN DUYỆT TÀI KHOẢN */}
      <div id="modal-approve" onClick={backdrop('modal-approve')} className={modalClass('modal-approve')} role="dialog" aria-modal="true" aria-labelledby="modal-approve-title">
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
          <div className="v3-space-y-2">
            <label htmlFor="select-approve-role" className="block text-xs font-semibold text-[#111827]">
              Cấp vai trò cho người này:
            </label>
            {' '}
            <select ref={approveRoleRef} id="select-approve-role" className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-[#E7E7E2] bg-white focus:border-[#FF5701] transition-colors" defaultValue="member">
              {' '}
              <option value="member">
                Thành viên
              </option>
              {' '}
              <option value="admin">
                Quản trị viên
              </option>
              {' '}
            </select>
          </div>
          <div className="p-3 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-xs text-[#4B5563] v3-space-y-1">
            <p>
              ✓ Hệ thống sẽ gửi email báo duyệt kích hoạt ngay tới người dùng.
            </p>
            <p>
              ✓ Người này có thể đăng nhập ngay và gửi yêu cầu trong không gian làm việc.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={() => closeModal('modal-approve')} className="btn-close-modal px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-[#4B5563] hover:bg-neutral-100 transition-colors">
              Hủy
            </button>
            <button type="button" id="btn-confirm-approve" onClick={() => actions.confirmApprove()} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm">
              Xác nhận duyệt ✓
            </button>
          </div>
        </div>
      </div>
      {/* 2. MODAL KHÓA / MỞ KHÓA TÀI KHOẢN */}
      <div id="modal-toggle-lock" onClick={backdrop('modal-toggle-lock')} className={modalClass('modal-toggle-lock')} role="dialog" aria-modal="true" aria-labelledby="modal-lock-title">
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
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={() => closeModal('modal-toggle-lock')} className="btn-close-modal px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-[#4B5563] hover:bg-neutral-100 transition-colors">
              Hủy
            </button>
            <button type="button" id="btn-confirm-toggle-lock" onClick={() => actions.confirmToggleLock()} className={lockUser?.locked ? 'px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm' : 'px-4 py-2 rounded-xl bg-amber-600 text-white text-xs sm:text-sm font-semibold hover:bg-amber-700 transition-colors shadow-sm'}>
              {lockUser?.locked ? 'Xác nhận mở khóa' : 'Xác nhận khóa'}
            </button>
          </div>
        </div>
      </div>
      {/* 3. MODAL ĐỔI VAI TRÒ THÀNH VIÊN */}
      <div id="modal-change-role" onClick={backdrop('modal-change-role')} className={modalClass('modal-change-role')} role="dialog" aria-modal="true" aria-labelledby="modal-role-title">
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
            <select ref={newRoleRef} id="select-new-role" className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-[#E7E7E2] bg-white focus:border-[#FF5701] transition-colors">
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
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={() => closeModal('modal-change-role')} className="btn-close-modal px-4 py-2 rounded-xl text-xs sm:text-sm font-medium text-[#4B5563] hover:bg-neutral-100 transition-colors">
              Hủy
            </button>
            <button type="button" id="btn-confirm-change-role" onClick={() => actions.confirmChangeRole()} className="px-4 py-2 rounded-xl bg-[#FF5701] text-white text-xs sm:text-sm font-semibold hover:bg-[#e04d01] transition-colors shadow-sm">
              Lưu vai trò
            </button>
          </div>
        </div>
      </div>
      {/* JAVASCRIPT ĐIỀU KHIỂN TOÀN BỘ LOGIC */}
    </>
  );
}
