// FE-12: khung điều hướng chung của mọi trang sau khi đăng nhập.
// Redesign 11/2026 (phong cách "framed sheet"): thanh bên trái và thanh trên cùng một nền ấm (hình chữ L),
// nội dung nằm trên tờ giấy. Từ 1024 px thanh bên luôn hiện; hẹp hơn thì thanh bên thành tấm menu toàn màn hình
// mở bằng nút menu trên thanh trên, nên điện thoại vẫn tới được mọi trang mà không phải vào menu avatar.
// Mỗi đích chỉ còn một lối vào. Bước 5b: "Tự động" (/inbox) gom Lịch chạy, Hộp thư đề xuất và Bản tóm tắt;
// số lượt chờ duyệt và đề xuất cần xử lý cùng nằm trên mục này, Nhật ký chỉ còn hội thoại.
// Giao diện của khung nằm ở src/styles/app-shell.css; MainNav gắn data-app-shell lên <html> khi có mặt.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { BookOpen, History, Menu, MessagesSquare, Plug, SquarePen, Users, X, Zap } from 'lucide-react';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import { PlanoraMark } from '../PlanoraMark';
import type { User } from '../../types';
import { UserNavMenu, automationLabel } from './UserNavMenu';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { SidebarRecent } from './SidebarRecent';
import { useChatStore } from '../../store/chat-store';
import { useSchedulePendingCount } from '../../hooks/use-schedules';
import { getActiveWorkspaceSummary, subscribeWorkspace } from '../../services/workspace-storage';

export type NavTab = 'workspace' | 'history' | 'settings' | 'guide' | 'users' | 'inbox';
export const NAV_ITEMS = [
  { to: '/', label: 'Không gian làm việc', end: true },
  { to: '/inbox', label: 'Tự động', end: false },
  { to: '/history', label: 'Nhật ký', end: false },
  { to: '/settings', label: 'Kết nối dịch vụ', end: false },
  { to: '/guide', label: 'Cẩm nang', end: false },
] as const;
type Tab = { id: NavTab; path: string; name: string; icon: typeof History; group: 'work' | 'more'; adminOnly?: boolean };
const TABS: Tab[] = [
  { id: 'workspace', path: '/', name: 'Không gian làm việc', icon: MessagesSquare, group: 'work' },
  { id: 'history', path: '/history', name: 'Nhật ký', icon: History, group: 'work' },
  { id: 'inbox', path: '/inbox', name: 'Tự động', icon: Zap, group: 'work' },
  { id: 'settings', path: '/settings', name: 'Kết nối dịch vụ', icon: Plug, group: 'work' },
  { id: 'guide', path: '/guide', name: 'Cẩm nang', icon: BookOpen, group: 'more' },
  { id: 'users', path: '/admin/users', name: 'Người dùng', icon: Users, group: 'more', adminOnly: true },
];
const AVATAR = 'w-8 h-8 rounded-full bg-[#1A0E08] dark:bg-[#F3EEE8] text-white dark:text-[#1A0E08] text-xs font-semibold flex items-center justify-center flex-shrink-0 hover:opacity-90';
const MENU_ITEM = 'w-full flex text-left items-center gap-2.5 px-4 py-2 text-sm text-[#1a0e08] dark:text-[#F3EEE8] hover:bg-[#F3EEE7] dark:hover:bg-[#2A231E] focus:bg-[#F3EEE7] dark:focus:bg-[#2A231E] focus:outline-none transition-colors';

export interface MainNavProps {
  user: User | null;
  current: NavTab | null;
  navigate: (path: string) => void;
  onLogout: () => void;
  onOpenSettings?: () => void;
  /** Tên trang hiện trên thanh trên khi màn hẹp hơn 1024 px (lúc đó thanh bên đã gập). */
  pageName?: string;
  /** Nút riêng của trang, đặt trước nút sáng/tối (cockpit: Lịch sử, Xem hội thoại). */
  actions?: ReactNode;
  /** Số đề xuất Slack cần xử lý (trang Tự động truyền vào khi đã tải hộp thư). */
  inboxBadgeCount?: number;
  /** Phần nằm ngay dưới thanh trên, trong cùng header dính (cockpit: dải Chế độ thử nghiệm). */
  children?: ReactNode;
  /** Nút "Yêu cầu mới" ở thanh bên. Cockpit truyền cách tạo hội thoại của nó; trang khác thì dọn trạng thái rồi về trang chủ. */
  onNewRequest?: () => void;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MainNav({ user, current, navigate, onLogout, onOpenSettings, pageName, actions, inboxBadgeCount, children, onNewRequest }: MainNavProps) {
  const pendingCount = useSchedulePendingCount(user);
  const [activeWorkspace, setActiveWorkspace] = useState(getActiveWorkspaceSummary());
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => subscribeWorkspace(() => setActiveWorkspace(getActiveWorkspaceSummary())), []);
  // Bật lớp giao diện của khung app (app-shell.css) khi khung đang hiện, trả lại khi rời trang.
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.dataset.appShell = '';
    return () => { delete html.dataset.appShell; };
  }, []);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (event: MediaQueryListEvent) => { if (event.matches) setMenuOpen(false); };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[data-testid="create-org-modal-backdrop"], [data-testid="join-org-modal-backdrop"]')) return;
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        setMenuOpen(false);
        menuBtnRef.current?.focus();
        return;
      }
      if (event.key === 'Tab' && sidebarRef.current && (sidebarRef.current.contains(document.activeElement) || document.activeElement === menuBtnRef.current)) {
        const items = [...sidebarRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.closest('[hidden]'));
        const first = items[0], last = items.at(-1);
        if (!first) return;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === menuBtnRef.current)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === menuBtnRef.current)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const closeMenu = () => {
    setMenuOpen(false);
    menuBtnRef.current?.focus();
  };

  // Bấm kèm phím bổ trợ hoặc chuột giữa thì để trình duyệt mở tab mới như link thường.
  const follow = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setMenuOpen(false);
    if (path === '/settings' && onOpenSettings) { onOpenSettings(); return; }
    navigate(path);
  };
  const newRequest = () => {
    setMenuOpen(false);
    if (onNewRequest) { onNewRequest(); return; }
    useChatStore.getState().reset({ preservePlanning: true });
    navigate('/');
  };
  const canManageUsers = (activeWorkspace.id !== 'personal' && activeWorkspace.role === 'admin') || (activeWorkspace.id === 'personal' && user?.role === 'admin');
  const usersPendingCount = activeWorkspace.id !== 'personal' && typeof activeWorkspace.pendingCount === 'number' ? activeWorkspace.pendingCount : 0;
  const inboxCount = typeof inboxBadgeCount === 'number' && inboxBadgeCount > 0 ? inboxBadgeCount : 0;
  const tabs = TABS.filter(tab => !tab.adminOnly || canManageUsers);
  const countFor = (id: NavTab) => (id === 'users' ? usersPendingCount : id === 'inbox' ? pendingCount + inboxCount : 0);
  const labelFor = (tab: Tab, count: number) => {
    if (!count) return tab.name;
    if (tab.id === 'inbox') return automationLabel(pendingCount, inboxCount);
    return `${tab.name}, ${count} chờ duyệt`;
  };
  const link = (tab: Tab) => {
    const count = countFor(tab.id);
    const Icon = tab.icon;
    return (
      <a
        key={tab.id}
        href={tab.path}
        onClick={follow(tab.path)}
        data-testid={tab.id === 'inbox' ? 'nav-events-inbox-link' : undefined}
        aria-label={labelFor(tab, count)}
        aria-current={current === tab.id ? 'page' : undefined}
        className="ps-navlink"
      >
        <Icon aria-hidden="true" strokeWidth={1.75} />
        <span className="truncate">{tab.name}</span>
        {count > 0 && <span aria-hidden="true" className="ps-navcount" data-schedule-count={tab.id === 'inbox' && pendingCount > 0 ? '' : undefined} data-users-pending-count={tab.id === 'users' ? '' : undefined} data-inbox-badge-count={tab.id === 'inbox' && inboxCount > 0 ? '' : undefined}>{count}</span>}
      </a>
    );
  };

  return (
    <header className="ps-topbar sticky top-0 z-30 w-full" data-menu-open={menuOpen ? '' : undefined}>
      <div ref={sidebarRef} id="app-sidebar" className="ps-sidebar" data-app-sidebar data-open={menuOpen ? '' : undefined}>
        <div className="flex items-center justify-between gap-2 h-9 px-1.5">
          <button ref={closeBtnRef} type="button" className="ps-iconbtn ps-sidebar-close order-2" aria-label="Đóng menu điều hướng" onClick={closeMenu}>
            <X aria-hidden="true" size={18} />
          </button>
          <a href="/" onClick={follow('/')} aria-label="Planora · Về không gian làm việc" title="Về không gian làm việc" className="order-1 flex items-center gap-2 min-w-0">
            <PlanoraMark className="w-6 h-6 text-[#1a0e08] dark:text-[#F3EEE8] flex-shrink-0" />
            <span className="ps-brand">Planora</span>
          </a>
        </div>
        <div data-sidebar-workspace className="mt-3 mb-3">
          <WorkspaceSwitcher navigate={navigate} variant="sidebar" />
        </div>
        <button type="button" data-new-request className="ps-newrequest mb-4" onClick={newRequest}>
          <SquarePen aria-hidden="true" strokeWidth={1.75} />
          <span>Yêu cầu mới</span>
        </button>
        <nav aria-label="Điều hướng chính" className="flex flex-col">
          <div className="ps-navgroup flex flex-col gap-0.5">{tabs.filter(tab => tab.group === 'work').map(link)}</div>
          <div className="ps-navgroup flex flex-col gap-0.5">{tabs.filter(tab => tab.group === 'more').map(link)}</div>
        </nav>
        <SidebarRecent userId={user?.id} follow={follow} />
      </div>
      <div data-main-nav className="ps-topbar-row flex items-center gap-2 px-3 sm:px-5">
        <button ref={menuBtnRef} type="button" className="ps-iconbtn ps-menu-btn -ml-1" aria-label="Mở menu điều hướng" aria-expanded={menuOpen} aria-controls="app-sidebar" onClick={() => setMenuOpen(true)}>
          <Menu aria-hidden="true" size={20} />
        </button>
        <PlanoraMark className="ps-topbar-mark w-5 h-5 text-[#1a0e08] dark:text-[#F3EEE8] flex-shrink-0 lg:hidden" />
        {pageName && <span data-nav-page-name className="ps-pagename truncate lg:hidden">{pageName}</span>}
        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
          {actions}
          <ThemeToggle />
          <UserNavMenu user={user} variant="prototype" triggerClassName={AVATAR} menuItemClassName={MENU_ITEM} navigate={navigate} currentPath={current ? TABS.find(t => t.id === current)?.path : (typeof window !== 'undefined' ? window.location.pathname : undefined)} onOpenAccount={() => navigate('/account')} onLogout={onLogout} />
        </div>
      </div>
      {children}
      <div aria-hidden="true" className="ps-sheet-corner" />
    </header>
  );
}
