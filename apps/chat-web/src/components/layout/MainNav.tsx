// FE-12: thanh điều hướng chung của mọi trang sau khi đăng nhập (nhóm trưởng chốt 19/10/2026,
// đặc tả giao diện mục 1.1 điểm 10). Không có trong bản mẫu; class màu lấy từ header của bản React
// để prototype/theme.css lo chế độ tối như ở các trang khác.
// Tab hiện từ 900 px: ở 768–899 px, cockpit của admin không đủ chỗ đặt 5 tab ở giữa thanh
// (review #162, nhóm trưởng chốt 20/10/2026).
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import type { User } from '../../types';
import { UserNavMenu } from './UserNavMenu';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { useSchedulePendingCount } from '../../hooks/use-schedules';
import { getActiveWorkspaceSummary, subscribeWorkspace } from '../../services/workspace-storage';

export type NavTab = 'workspace' | 'history' | 'settings' | 'guide' | 'users' | 'inbox';
export const NAV_ITEMS = [
  { to: '/', label: 'Không gian làm việc', end: true },
  { to: '/inbox', label: 'Hộp thư đề xuất', end: false },
  { to: '/history', label: 'Nhật ký', end: false },
  { to: '/settings', label: 'Kết nối dịch vụ', end: false },
  { to: '/guide', label: 'Cẩm nang', end: false },
] as const;
const TABS: { id: NavTab; path: string; name: string; short: string; adminOnly?: boolean }[] = [
  { id: 'workspace', path: '/', name: 'Không gian làm việc', short: 'Làm việc' },
  { id: 'history', path: '/history', name: 'Nhật ký', short: 'Nhật ký' },
  { id: 'settings', path: '/settings', name: 'Kết nối dịch vụ', short: 'Kết nối' },
  { id: 'guide', path: '/guide', name: 'Cẩm nang', short: 'Cẩm nang' },
  { id: 'users', path: '/admin/users', name: 'Người dùng', short: 'Người dùng', adminOnly: true },
];
const TAB = 'inline-flex items-center h-9 px-2 border-b-2 text-sm whitespace-nowrap transition-colors';
const TAB_ON = `${TAB} border-[#FF5701] font-semibold text-[#111827]`;
const TAB_OFF = `${TAB} border-transparent font-medium text-[#4B5563] hover:text-[#111827]`;
const AVATAR = 'w-8 h-8 rounded-full bg-[#FF5701] text-white text-xs font-bold flex items-center justify-center shadow-sm flex-shrink-0 hover:opacity-90';
const MENU_ITEM = 'flex w-full text-left items-center gap-2.5 px-4 py-2 text-xs text-[#111827] dark:text-slate-50 hover:bg-neutral-100 dark:hover:bg-slate-700 hover:text-[#FF5701] focus:bg-neutral-100 dark:focus:bg-slate-700 focus:text-[#FF5701] focus:outline-none transition-colors';

export interface MainNavProps {
  user: User | null;
  current: NavTab | null;
  navigate: (path: string) => void;
  onLogout: () => void;
  onOpenSettings?: () => void;
  /** Tên trang hiện cạnh logo khi màn hẹp hơn 900 px (lúc đó không có tab). */
  pageName?: string;
  /** Nút riêng của trang, đặt trước nút sáng/tối (cockpit: Lịch sử, Xem hội thoại). */
  actions?: ReactNode;
  /** Số đề xuất cần xử lý trong Hộp thư đề xuất (hiển thị badge nhanh trên thanh điều hướng). */
  inboxBadgeCount?: number;
  /** Phần nằm ngay dưới thanh, trong cùng header dính (cockpit: dải Chế độ thử nghiệm). */
  children?: ReactNode;
}

export function MainNav({ user, current, navigate, onLogout, onOpenSettings, pageName, actions, inboxBadgeCount, children }: MainNavProps) {
  const pendingCount = useSchedulePendingCount(user);
  const [activeWorkspace, setActiveWorkspace] = useState(getActiveWorkspaceSummary());
  useEffect(() => subscribeWorkspace(() => setActiveWorkspace(getActiveWorkspaceSummary())), []);

  // Bấm kèm phím bổ trợ hoặc chuột giữa thì để trình duyệt mở tab mới như link thường.
  const follow = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(path);
  };
  const canManageUsers = (activeWorkspace.id !== 'personal' && activeWorkspace.role === 'admin') || (activeWorkspace.id === 'personal' && user?.role === 'admin');
  const usersPendingCount = activeWorkspace.id !== 'personal' && typeof activeWorkspace.pendingCount === 'number' ? activeWorkspace.pendingCount : 0;
  const tabs = TABS.filter(tab => !tab.adminOnly || canManageUsers);
  return (
    <header className="sticky top-0 z-30 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2]">
      <div data-main-nav className="max-w-7xl mx-auto grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:px-6 py-2">
        <div className="col-start-1 flex items-center gap-2 min-w-0 max-w-full justify-self-start">
          <a href="/" onClick={follow('/')} aria-label="Planora · Về không gian làm việc" title="Về không gian làm việc" className="flex items-center gap-2 group flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-[#FF5701] flex items-center justify-center text-white font-display font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
              P
            </div>
            <span className="font-display font-bold text-lg tracking-tight text-[#111827] hidden sm:inline">
              Planora
            </span>
          </a>
          <div className="hidden sm:flex min-w-0 shrink">
            <WorkspaceSwitcher navigate={navigate} />
          </div>
          {pageName && <span data-nav-page-name className="min-[900px]:hidden text-sm font-medium text-[#4B5563] truncate">{pageName}</span>}
        </div>
        <nav aria-label="Điều hướng chính" className="col-start-2 hidden min-[900px]:flex items-center gap-1 justify-self-center">
          {tabs.map(tab => (
            <a key={tab.id} href={tab.path} onClick={follow(tab.path)} aria-label={tab.id === 'history' && pendingCount > 0 ? `Nhật ký, ${pendingCount} lượt chờ duyệt` : tab.name} aria-current={current === tab.id ? 'page' : undefined} className={current === tab.id ? TAB_ON : TAB_OFF}>
              <span className="xl:hidden">{tab.short}</span>
              <span className="hidden xl:inline">{tab.name}</span>
              {tab.id === 'history' && pendingCount > 0 && <span aria-hidden="true" data-schedule-count className="ml-1 rounded-full px-1.5 py-0.5 bg-[#FF5701] text-white text-xs font-bold">{pendingCount}</span>}
              {tab.id === 'users' && usersPendingCount > 0 && <span aria-hidden="true" data-users-pending-count className="ml-1 rounded-full px-1.5 py-0.5 bg-[#FF5701] text-white text-xs font-bold">{usersPendingCount}</span>}
            </a>
          ))}
        </nav>
        <div className="col-start-3 flex items-center gap-1.5 sm:gap-2 flex-shrink-0 justify-self-end">
          <a
            href="/inbox"
            onClick={follow('/inbox')}
            data-testid="nav-events-inbox-link"
            aria-current={current === 'inbox' ? 'page' : undefined}
            aria-label={
              typeof inboxBadgeCount === 'number' && inboxBadgeCount > 0
                ? `Hộp thư đề xuất, ${inboxBadgeCount} đề xuất cần xử lý`
                : 'Sự kiện & Đề xuất'
            }
            title="Mở Trung tâm Sự kiện & Đề xuất chờ duyệt"
            className={
              current === 'inbox' || (typeof inboxBadgeCount === 'number' && inboxBadgeCount > 0)
                ? 'inline-flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 rounded-xl bg-[#FF5701]/10 px-2.5 py-1.5 text-xs font-semibold text-[#FF5701] hover:bg-[#FF5701]/20 transition-colors border border-[#FF5701]/30'
                : `${actions ? 'hidden xl:inline-flex' : 'inline-flex'} items-center gap-1.5 whitespace-nowrap flex-shrink-0 rounded-xl bg-white dark:bg-[#1E1E1E] px-2.5 py-1.5 text-xs font-medium text-[#4B5563] dark:text-[#D1D5DB] hover:text-[#111827] dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 border border-[#E7E7E2] dark:border-[#374151] shadow-sm transition-colors`
            }
          >
            <svg className="w-3.5 h-3.5 text-[#FF5701] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className={actions ? 'hidden 2xl:inline' : 'hidden xl:inline 2xl:hidden'}>
              {typeof inboxBadgeCount === 'number' && inboxBadgeCount > 0 ? 'Hộp thư' : 'Sự kiện'}
            </span>
            {!actions && (
              <span className="hidden 2xl:inline">
                {typeof inboxBadgeCount === 'number' && inboxBadgeCount > 0 ? 'Hộp thư đề xuất' : 'Sự kiện & Đề xuất'}
              </span>
            )}
            {typeof inboxBadgeCount === 'number' && inboxBadgeCount > 0 && (
              <span data-inbox-badge-count className="rounded-full bg-[#FF5701] px-1.5 py-0.5 text-xs font-bold text-white">
                {inboxBadgeCount}
              </span>
            )}
          </a>
          {actions}
          <ThemeToggle />
          <UserNavMenu user={user} pendingScheduleCount={pendingCount} variant="prototype" triggerClassName={AVATAR} menuItemClassName={MENU_ITEM} navigate={navigate} onOpenSettings={onOpenSettings ?? (() => navigate('/settings'))} onOpenAccount={() => navigate('/account')} onManageUsers={() => navigate('/admin/users')} onLogout={onLogout} />
        </div>
      </div>
      {children}
    </header>
  );
}
