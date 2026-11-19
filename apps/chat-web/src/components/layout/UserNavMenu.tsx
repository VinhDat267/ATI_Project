import { useEffect, useId, useRef, useState } from 'react';
import type { User } from '../../types';
import { getActiveWorkspaceSummary, subscribeWorkspace } from '../../services/workspace-storage';
export interface UserNavMenuProps {
  pendingScheduleCount?: number;
  inboxBadgeCount?: number;
  currentPath?: string;
  user: User | null; onOpenSettings?: () => void; onLogout: () => void;
  onManageUsers?: () => void; onOpenAccount?: () => void; navigate?: (path: string) => void;
  variant?: 'prototype';
  triggerClassName?: string; menuItemClassName?: string;
}
/** Tên đọc của mục Tự động: mỗi hàng đợi giữ danh từ của nó (lượt lịch chạy chờ duyệt, đề xuất Slack cần xử lý). */
export function automationLabel(pendingRuns: number, proposals: number): string {
  const parts = [pendingRuns > 0 ? `${pendingRuns} lượt chờ duyệt` : '', proposals > 0 ? `${proposals} đề xuất cần xử lý` : ''].filter(Boolean);
  return parts.length ? `Tự động, ${parts.join(', ')}` : 'Tự động';
}

export function avatarInitials(user: User | null) {
  const words = user?.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return words.length ? `${words[0][0]}${words.length > 1 ? words.at(-1)![0] : ''}`.toLocaleUpperCase('vi-VN') : user?.email?.[0]?.toUpperCase() || 'AO';
}
export function UserNavMenu({ user, onLogout, onOpenAccount, navigate, variant, triggerClassName, menuItemClassName, currentPath }: UserNavMenuProps) {
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
  type MenuEntry =
    | { kind: 'sep'; key: string }
    | { kind: 'item'; label: string; ariaLabel?: string; path?: string; action?: () => void; danger?: boolean };
  // Điều hướng không gian làm việc nằm hoàn toàn ở thanh bên (và ngăn kéo mobile);
  // menu avatar chỉ giữ danh tính, tài khoản, chính sách và đăng xuất để tránh trùng lặp.
  const entries: MenuEntry[] = [
    { kind: 'item', label: 'Tài khoản', path: '/account', action: onOpenAccount ?? (() => navigate?.('/account')) },
    { kind: 'item', label: 'Chính sách an toàn', path: '/privacy', action: () => navigate?.('/privacy') },
    { kind: 'sep', key: 'sep-account' },
    { kind: 'item', label: 'Đăng xuất', action: onLogout, danger: true },
  ];
  const isPathCurrent = (path?: string) => Boolean(path && currentPath && currentPath === path);
  return <div ref={container} className="relative">
    <button ref={trigger} type="button" aria-label={`Menu người dùng: ${user?.name || user?.email || 'Người dùng'}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      className={triggerClassName ?? (variant === 'prototype' ? 'user-avatar-btn shadow-sm' : 'flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-primary-tint text-primary-text font-semibold')}
      onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>{avatarInitials(user)}</button>
    {open && <div id={id} role="menu" aria-label="Người dùng" className={`${variant === 'prototype' ? 'absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-24px)] bg-[var(--ps-panel,#FFFFFF)] dark:bg-[#1A1613] rounded-xl border border-[var(--ps-edge,#E3DACE)] dark:border-[#2A231E] shadow-md py-1.5 z-50' : 'absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-md'} max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain`}
      onKeyDown={event => {
        const all = items(), index = all.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); all[event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
        } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        else if (event.key === 'Tab') setOpen(false);
      }}>
      <div className={variant === 'prototype' ? 'px-4 py-3 border-b border-[var(--ps-edge,#E3DACE)] dark:border-[#2A231E] select-none' : 'px-3 py-2 border-b border-border mb-1'}>
        <p className="text-sm font-semibold text-[#1A0E08] dark:text-[#F3EEE8] truncate">{user?.name || user?.email || 'Người dùng'}</p>
        {variant === 'prototype' && (
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-xs text-[#51463E] dark:text-[#D7CEC4]">
              {workspace.id === 'personal'
                ? (user?.role === 'admin' ? 'Quản trị viên' : 'Thành viên')
                : (workspace.role === 'admin' ? 'Quản trị viên' : 'Thành viên')}
            </span>
            <span className="text-xs text-[#6A5F56] dark:text-[#AFA59A]">
              <span aria-hidden="true">·</span> {workspace.id === 'personal' ? 'Cá nhân' : workspace.name}
            </span>
          </div>
        )}
        {user?.email && <p className="text-xs text-[#6A5F56] dark:text-[#AFA59A] truncate mt-0.5">{user.email}</p>}
      </div>
      {entries.map(entry => {
        if (entry.kind === 'sep') {
          return <div key={entry.key} role="separator" className="my-1 border-t border-[var(--ps-edge,#E3DACE)] dark:border-[#2A231E]" />;
        }
        const active = isPathCurrent(entry.path);
        const activeClass = active ? 'bg-[#E1D7C9]/70 dark:bg-[#2A231E] font-medium text-[#1A0E08] dark:text-[#F3EEE8]' : '';
        return (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-label={entry.ariaLabel}
            aria-current={active ? 'page' : undefined}
            className={menuItemClassName ? `${menuItemClassName} ${entry.danger ? 'text-red-700 dark:text-red-400' : activeClass}` : variant === 'prototype' ? `user-menu-item ${entry.danger ? 'text-red-700' : activeClass}` : `w-full min-h-10 px-3 py-2 text-left rounded-lg hover:bg-surface-raised flex items-center gap-2 ${entry.danger ? 'text-danger-text' : active ? 'bg-surface-raised font-medium text-text' : 'text-text'}`}
            onClick={() => select(entry.action)}
          >
            <span className="flex-1 truncate">{entry.label}</span>
          </button>
        );
      })}
    </div>}
  </div>;
}
