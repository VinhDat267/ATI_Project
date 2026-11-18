import { useEffect, useId, useRef, useState } from 'react';
import type { User } from '../../types';
import { getActiveWorkspaceSummary, subscribeWorkspace } from '../../services/workspace-storage';
export interface UserNavMenuProps {
  pendingScheduleCount?: number;
  inboxBadgeCount?: number;
  currentPath?: string;
  user: User | null; onOpenSettings: () => void; onLogout: () => void;
  onManageUsers?: () => void; onOpenAccount?: () => void; navigate?: (path: string) => void;
  variant?: 'prototype';
  triggerClassName?: string; menuItemClassName?: string;
}
export function avatarInitials(user: User | null) {
  const words = user?.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return words.length ? `${words[0][0]}${words.length > 1 ? words.at(-1)![0] : ''}`.toLocaleUpperCase('vi-VN') : user?.email?.[0]?.toUpperCase() || 'AO';
}
export function UserNavMenu({ user, onOpenSettings, onLogout, onManageUsers, onOpenAccount, navigate, variant, triggerClassName, menuItemClassName, pendingScheduleCount = 0, inboxBadgeCount = 0, currentPath }: UserNavMenuProps) {
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState(getActiveWorkspaceSummary());
  useEffect(() => subscribeWorkspace(() => setWorkspace(getActiveWorkspaceSummary())), []);
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const items = () => [...(container.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const outside = (event: MouseEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  const select = (action?: () => void) => { setOpen(false); action?.(); };
  const canManageUsers = (workspace.id !== 'personal' && workspace.role === 'admin') || (workspace.id === 'personal' && user?.role === 'admin');
  type MenuEntry =
    | { kind: 'sep'; key: string }
    | { kind: 'item'; label: string; ariaLabel?: string; badge?: number; path?: string; action?: () => void; danger?: boolean };
  const entries: MenuEntry[] = [
    { kind: 'item', label: pendingScheduleCount > 0 ? `Nhật ký điều phối, ${pendingScheduleCount} lượt chờ duyệt` : 'Nhật ký điều phối', path: '/history', action: () => navigate?.('/history') },
    { kind: 'item', label: 'Không gian làm việc', path: '/', action: () => navigate?.('/') },
    { kind: 'item', label: 'Hộp thư đề xuất', ariaLabel: inboxBadgeCount > 0 ? `Hộp thư đề xuất, ${inboxBadgeCount} đề xuất cần xử lý` : 'Hộp thư đề xuất', badge: inboxBadgeCount > 0 ? inboxBadgeCount : undefined, path: '/inbox', action: () => navigate?.('/inbox') },
    { kind: 'sep', key: 'sep-workspace' },
    { kind: 'item', label: 'Kết nối dịch vụ', path: '/settings', action: onOpenSettings },
    { kind: 'item', label: 'Cẩm nang', path: '/guide', action: () => navigate?.('/guide') },
    { kind: 'item', label: 'Tài khoản', path: '/account', action: onOpenAccount },
    ...(canManageUsers ? [{ kind: 'item' as const, label: 'Quản lý người dùng', path: '/admin/users', action: onManageUsers }] : []),
    { kind: 'sep', key: 'sep-account' },
    { kind: 'item', label: 'Chính sách an toàn', path: '/privacy', action: () => navigate?.('/privacy') },
    { kind: 'item', label: 'Đăng xuất', action: onLogout, danger: true },
  ];
  const isPathCurrent = (path?: string) => {
    if (!path || !currentPath) return false;
    if (path === '/') return currentPath === '/' || currentPath.startsWith('/c/');
    return currentPath === path;
  };
  return <div ref={container} className="relative">
    <button ref={trigger} type="button" aria-label={`Menu người dùng: ${user?.name || user?.email || 'Người dùng'}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      className={triggerClassName ?? (variant === 'prototype' ? 'user-avatar-btn shadow-sm' : 'flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-primary-tint text-primary-text font-semibold')}
      onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>{avatarInitials(user)}</button>
    {open && <div id={id} role="menu" aria-label="Người dùng" className={`${variant === 'prototype' ? 'absolute right-0 top-full mt-2 w-64 sm:w-68 max-w-[calc(100vw-24px)] bg-white dark:bg-[#1A1613] rounded-2xl border border-brand-border dark:border-[#3a312a] shadow-2xl py-1.5 z-50' : 'absolute right-0 top-full mt-2 z-50 w-72 rounded-2xl border border-border bg-surface p-2 shadow-xl'} max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain`}
      onKeyDown={event => {
        const all = items(), index = all.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); all[event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
        } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        else if (event.key === 'Tab') setOpen(false);
      }}>
      <div className={variant === 'prototype' ? 'px-4 py-3 border-b border-brand-border dark:border-[#312923] select-none' : 'px-3 py-2 border-b border-border mb-1'}>
        <p className="font-semibold truncate">{user?.name || user?.email || 'Người dùng'}</p>
        {variant === 'prototype' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-[#51463E] dark:text-[#D7CEC4]">
              {workspace.id === 'personal'
                ? (user?.role === 'admin' ? 'Quản trị viên' : 'Thành viên')
                : (workspace.role === 'admin' ? 'Quản trị viên' : 'Thành viên')}
            </span>
            <span className="text-[11px] text-[#51463E] dark:text-[#A39A90]">
              <span aria-hidden="true">·</span> {workspace.id === 'personal' ? 'Cá nhân' : workspace.name}
            </span>
          </div>
        )}
        {user?.email && <p className="text-sm text-text-secondary truncate">{user.email}</p>}
      </div>
      {entries.map(entry => {
        if (entry.kind === 'sep') {
          return <div key={entry.key} role="separator" className="my-1 border-t border-brand-border dark:border-[#312923]" />;
        }
        const active = isPathCurrent(entry.path);
        const activeClass = active ? 'bg-orange-50/80 dark:bg-[#2A231E] font-semibold text-[#B43E00] dark:text-[#FB923C]' : '';
        return (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-label={entry.ariaLabel}
            aria-current={active ? 'page' : undefined}
            className={menuItemClassName ? `${menuItemClassName} ${entry.danger ? 'text-red-700 dark:text-red-400' : activeClass}` : variant === 'prototype' ? `user-menu-item ${entry.danger ? 'text-red-700' : activeClass}` : `w-full min-h-10 px-3 py-2 text-left rounded-lg hover:bg-surface-raised flex items-center gap-2 ${entry.danger ? 'text-danger-text' : active ? 'bg-orange-50 font-semibold text-[#B43E00]' : 'text-text'}`}
            onClick={() => select(entry.action)}
          >
            <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-[#FF5701]' : 'bg-transparent'}`} />
            <span className="flex-1 truncate">{entry.label}</span>
            {typeof entry.badge === 'number' && entry.badge > 0 && (
              <span aria-hidden="true" className="ml-auto rounded-full bg-[#FF5701] px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                {entry.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>}
  </div>;
}
