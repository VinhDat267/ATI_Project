import type { ReactNode } from 'react';

export const CARD_CONTAINER_CLASS =
  'rounded-2xl border border-[#E7E7E2] dark:border-[#374151] bg-white dark:bg-[#111827] p-5 sm:p-6 shadow-sm transition-colors text-[#111827] dark:text-white';

export const PRIMARY_CONNECT_BTN =
  'inline-flex items-center justify-center rounded-lg bg-[#FF5701] hover:bg-[#E04D00] px-3.5 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50';

export const SECONDARY_ACTION_BTN =
  'inline-flex items-center justify-center rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] bg-white dark:bg-[#262626] hover:bg-[#F3F4F6] dark:hover:bg-[#303030] px-3 py-1.5 text-xs font-medium text-[#111827] dark:text-[#F3F4F6] transition-colors disabled:opacity-50';

export const DANGER_GHOST_BTN =
  'inline-flex items-center justify-center rounded-lg border border-[#E5E7EB] dark:border-[#3F3F46] bg-transparent hover:bg-red-50/60 dark:hover:bg-red-950/30 hover:border-red-200 dark:hover:border-red-900/50 px-3 py-1.5 text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF] hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50';

export const CAPABILITY_PILL_CLASS =
  'inline-flex items-center rounded-md border border-[#E5E5E0] dark:border-[#3A3A3A] bg-[#F8F8F6] dark:bg-[#262626] px-2.5 py-1 text-xs font-medium text-[#374151] dark:text-[#D1D5DB]';

export type ConnectionBadgeTone = 'connected' | 'warning' | 'neutral' | 'error' | 'info';

export function connectionBadgeClass(tone: ConnectionBadgeTone): string {
  if (tone === 'connected') {
    return 'inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200';
  }
  if (tone === 'warning' || tone === 'info') {
    return 'inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/60 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200';
  }
  if (tone === 'error') {
    return 'inline-flex items-center gap-1.5 rounded-full bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/60 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:text-red-200';
  }
  return 'inline-flex items-center gap-1.5 rounded-full bg-[#F3F4F6] dark:bg-[#2A2A2A] border border-[#E5E7EB] dark:border-[#3F3F46] px-2.5 py-0.5 text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF]';
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
          <div className="w-10 h-10 rounded-xl bg-[#F8F8F6] dark:bg-[#262626] border border-[#E7E7E2] dark:border-[#3A3A3A] flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-[#111827] dark:text-white leading-snug">
                {title}
              </h2>
              <span className={connectionBadgeClass(badgeTone)}>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    badgeTone === 'connected'
                      ? 'bg-emerald-600 dark:bg-emerald-400'
                      : badgeTone === 'warning'
                        ? 'bg-amber-600 dark:bg-amber-400'
                        : 'bg-[#9CA3AF]'
                  }`}
                />
                {badgeText}
              </span>
            </div>
            <div className="text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed">{description}</div>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
      </div>
      {children ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
}
