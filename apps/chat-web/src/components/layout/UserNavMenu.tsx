import React from 'react';
import type { User } from '../../types';

export interface UserNavMenuProps {
  user: User | null;
  onOpenSettings: () => void;
  onLogout: () => void;
}

export const UserNavMenu: React.FC<UserNavMenuProps> = ({
  user,
  onOpenSettings,
  onLogout,
}) => {
  const initials = user?.name
    ? user.name.slice(0, 2).toUpperCase()
    : user?.email
      ? user.email.slice(0, 2).toUpperCase()
      : 'AO';

  return (
    <div className="p-4 border-t border-zinc-200/70 bg-zinc-100/40 flex flex-col gap-2 shrink-0">
      <div className="flex items-center gap-2 overflow-hidden">
        <div className="w-8 h-8 rounded-full bg-[#0071e3]/10 text-[#0071e3] border border-blue-200 flex items-center justify-center font-bold text-xs shrink-0">
          {initials}
        </div>
        <div className="overflow-hidden flex-1 min-w-0">
          <div className="text-xs font-semibold text-zinc-900 truncate">
            {user?.name || user?.email || 'Người dùng'}
          </div>
          {user?.email && (
            <div className="text-[11px] text-zinc-500 truncate">{user.email}</div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-zinc-200/40">
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/60 px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
        >
          <span>⚙️</span>
          <span>Cài đặt</span>
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
        >
          <span>🚪</span>
          <span>Đăng xuất</span>
        </button>
      </div>
    </div>
  );
};
