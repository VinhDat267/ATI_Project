// FE-12: thanh điều hướng chung của mọi trang sau khi đăng nhập (nhóm trưởng chốt 19/10/2026,
// đặc tả giao diện mục 1.1 điểm 10). Không có trong bản mẫu; class màu lấy từ header của bản React
// để prototype/theme.css lo chế độ tối như ở các trang khác.
// Tab hiện từ 900 px: ở 768–899 px, cockpit của admin không đủ chỗ đặt 5 tab ở giữa thanh
// (review #162, nhóm trưởng chốt 20/10/2026).
import type { MouseEvent, ReactNode } from 'react';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import type { User } from '../../types';
import { UserNavMenu } from './UserNavMenu';
import { useSchedulePendingCount } from '../../hooks/use-schedules';

export type NavTab = 'workspace' | 'history' | 'settings' | 'guide' | 'users';
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
  /** Phần nằm ngay dưới thanh, trong cùng header dính (cockpit: dải Chế độ thử nghiệm). */
  children?: ReactNode;
}

export function MainNav({ user, current, navigate, onLogout, onOpenSettings, pageName, actions, children }: MainNavProps) {
  const pendingCount = useSchedulePendingCount(user);
  // Bấm kèm phím bổ trợ hoặc chuột giữa thì để trình duyệt mở tab mới như link thường.
  const follow = (path: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(path);
  };
  const tabs = TABS.filter(tab => !tab.adminOnly || user?.role === 'admin');
  return (
    <header className="sticky top-0 z-30 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2]">
      <div data-main-nav className="max-w-7xl mx-auto grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:px-6 py-2">
        <div className="col-start-1 flex items-center gap-2.5 min-w-0 justify-self-start">
          <a href="/" onClick={follow('/')} aria-label="ATI · Về không gian làm việc" title="Về không gian làm việc" className="flex items-center gap-2 group flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-[#FF5701] flex items-center justify-center text-white font-display font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
              A
            </div>
            <span className="font-display font-bold text-lg tracking-tight text-[#111827] hidden sm:inline">
              ATI
            </span>
          </a>
          {pageName && <span data-nav-page-name className="min-[900px]:hidden text-sm font-medium text-[#4B5563] truncate">{pageName}</span>}
        </div>
        <nav aria-label="Điều hướng chính" className="col-start-2 hidden min-[900px]:flex items-center gap-1 justify-self-center">
          {tabs.map(tab => (
            <a key={tab.id} href={tab.path} onClick={follow(tab.path)} aria-label={tab.id === 'history' && pendingCount > 0 ? `Nhật ký, ${pendingCount} lượt chờ duyệt` : tab.name} aria-current={current === tab.id ? 'page' : undefined} className={current === tab.id ? TAB_ON : TAB_OFF}>
              <span className="xl:hidden">{tab.short}</span>
              <span className="hidden xl:inline">{tab.name}</span>
              {tab.id === 'history' && pendingCount > 0 && <span aria-hidden="true" data-schedule-count className="ml-1 rounded-full px-1.5 py-0.5 bg-[#FF5701] text-white text-[10px] font-bold">{pendingCount}</span>}
            </a>
          ))}
        </nav>
        <div className="col-start-3 flex items-center gap-2 flex-shrink-0 justify-self-end">
          {actions}
          <ThemeToggle />
          <UserNavMenu user={user} pendingScheduleCount={pendingCount} variant="prototype" triggerClassName={AVATAR} menuItemClassName={MENU_ITEM} navigate={navigate} onOpenSettings={onOpenSettings ?? (() => navigate('/settings'))} onOpenAccount={() => navigate('/account')} onManageUsers={() => navigate('/admin/users')} onLogout={onLogout} />
        </div>
      </div>
      {children}
    </header>
  );
}
