import { useEffect, useId, useRef, useState } from 'react';
import type { User } from '../../types';
export interface UserNavMenuProps {
  user: User | null; onOpenSettings: () => void; onLogout: () => void;
  onManageUsers?: () => void; onOpenAccount?: () => void; navigate?: (path: string) => void;
}
export function avatarInitials(user: User | null) {
  const words = user?.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return words.length ? `${words[0][0]}${words.length > 1 ? words.at(-1)![0] : ''}`.toLocaleUpperCase('vi-VN') : user?.email?.[0]?.toUpperCase() || 'AO';
}
export function UserNavMenu({ user, onOpenSettings, onLogout, onManageUsers, onOpenAccount, navigate }: UserNavMenuProps) {
  const [open, setOpen] = useState(false);
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
  const entries: [string, (() => void) | undefined][] = [
    ['Nhật ký điều phối', () => navigate?.('/history')], ['Kết nối dịch vụ', onOpenSettings], ['Cẩm nang', () => navigate?.('/guide')], ['Tài khoản', onOpenAccount],
    ...(user?.role === 'admin' ? [['Quản lý người dùng', onManageUsers] as [string, (() => void) | undefined]] : []),
    ['Chính sách an toàn', () => navigate?.('/privacy')], ['Đăng xuất', onLogout],
  ];
  return <div ref={container} className="relative">
    <button ref={trigger} type="button" aria-label={`Menu người dùng: ${user?.name || user?.email || 'Người dùng'}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-primary-tint text-primary-text font-semibold"
      onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>{avatarInitials(user)}</button>
    {open && <div id={id} role="menu" aria-label="Người dùng" className="absolute right-0 top-full mt-2 z-50 w-72 rounded-2xl border border-border bg-surface p-2 shadow-xl"
      onKeyDown={event => {
        const all = items(), index = all.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); all[event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
        } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
        else if (event.key === 'Tab') setOpen(false);
      }}>
      <div className="px-3 py-2 border-b border-border mb-1"><p className="font-semibold truncate">{user?.name || user?.email || 'Người dùng'}</p>{user?.email && <p className="text-sm text-text-secondary truncate">{user.email}</p>}</div>
      {entries.map(([label, action]) => <button key={label} type="button" role="menuitem" tabIndex={-1} className={`w-full min-h-10 px-3 py-2 text-left rounded-lg hover:bg-surface-raised ${label === 'Đăng xuất' ? 'text-danger-text' : 'text-text'}`} onClick={() => select(action)}>{label}</button>)}
    </div>}
  </div>;
}
