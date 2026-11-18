import type { ReactNode } from 'react';

// Bước 5b: mọi thẻ kết nối dùng chung một bộ: bảng phẳng viền 1px (không đổ bóng), nút .ps-btn / .ps-btn-quiet của khung app,
// trạng thái là chữ màu kèm chấm (.ps-status). Kiểu nằm ở src/styles/app-shell.css.

export const CARD_CONTAINER_CLASS =
  'h-full rounded-xl border border-[#E3DACE] dark:border-[#3a312a] bg-white dark:bg-[#1A1613] p-5 sm:p-6 transition-colors text-[#1a0e08] dark:text-[#F3EEE8]';

export const PRIMARY_CONNECT_BTN = 'ps-btn';

export const SECONDARY_ACTION_BTN = 'ps-btn-quiet';

export const DANGER_GHOST_BTN = 'ps-btn-quiet ps-btn-danger';

export const CAPABILITY_PILL_CLASS =
  'inline-flex items-center rounded-md border border-[#E6DED3] dark:border-[#3a312a] bg-[#F8F4EE] dark:bg-[#221C18] px-2.5 py-1 text-xs font-medium text-[#4a4038] dark:text-[#D7CEC4]';

export type ConnectionBadgeTone = 'connected' | 'warning' | 'neutral' | 'error' | 'info';

export function connectionBadgeClass(tone: ConnectionBadgeTone): string {
  return `ps-status ps-status-${tone === 'info' ? 'warning' : tone}`;
}

export interface ServiceConnectionCardProps {
  id?: string;
  tabIndex?: number;
  icon: ReactNode;
  title: string;
  badgeText: string;
  badgeTone: ConnectionBadgeTone;
  description: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function ServiceConnectionCard({
  id,
  tabIndex,
  icon,
  title,
  badgeText,
  badgeTone,
  description,
  actions,
  children,
}: ServiceConnectionCardProps) {
  return (
    <div id={id} tabIndex={tabIndex} className={CARD_CONTAINER_CLASS}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0 flex-1">
          <div className="w-6 h-6 flex items-center justify-center shrink-0 mt-0.5" aria-hidden="true">
            {icon}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-[#1a0e08] dark:text-white leading-snug">
                {title}
              </h2>
              <span className={connectionBadgeClass(badgeTone)}>{badgeText}</span>
            </div>
            <div className="text-sm text-[#51463E] dark:text-[#9CA3AF] leading-relaxed">{description}</div>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
      </div>
      {children ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
}
