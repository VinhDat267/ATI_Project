import type { ReactNode } from 'react';

export const CARD_CONTAINER_CLASS =
  'rounded-2xl border border-[#E8E0D6] dark:border-[#3a312a] bg-white dark:bg-[#1A1613] p-5 sm:p-6 shadow-sm transition-colors text-[#1a0e08] dark:text-[#F3EEE8]';

export const PRIMARY_CONNECT_BTN =
  'inline-flex items-center justify-center rounded-lg bg-[#FF5701] hover:bg-[#E04D00] px-3.5 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50';

export const SECONDARY_ACTION_BTN =
  'inline-flex items-center justify-center rounded-lg border border-[#D1D5DB] dark:border-[#3a312a] bg-white dark:bg-[#221C18] hover:bg-[#F3F4F6] dark:hover:bg-[#312923] px-3 py-1.5 text-xs font-medium text-[#1a0e08] dark:text-[#F3EEE8] transition-colors disabled:opacity-50';

export const DANGER_GHOST_BTN =
  'inline-flex items-center justify-center rounded-lg border border-[#E5E7EB] dark:border-[#3a312a] bg-transparent hover:bg-red-50/60 dark:hover:bg-red-950/30 hover:border-red-200 dark:hover:border-red-900/50 px-3 py-1.5 text-xs font-medium text-[#51463E] dark:text-[#A39A90] hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50';

export const CAPABILITY_PILL_CLASS =
  'inline-flex items-center rounded-md border border-[#E6DED3] dark:border-[#3a312a] bg-[#F8F4EE] dark:bg-[#221C18] px-2.5 py-1 text-xs font-medium text-[#4a4038] dark:text-[#D7CEC4]';

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
  return 'inline-flex items-center gap-1.5 rounded-full bg-[#F3F4F6] dark:bg-[#221C18] border border-[#E5E7EB] dark:border-[#3a312a] px-2.5 py-0.5 text-xs font-medium text-[#51463E] dark:text-[#D7CEC4]';
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
          <div className="w-10 h-10 rounded-xl bg-[#F8F4EE] dark:bg-[#221C18] border border-[#E8E0D6] dark:border-[#3a312a] flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-[#1a0e08] dark:text-white leading-snug">
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
            <div className="text-sm text-[#51463E] dark:text-[#9CA3AF] leading-relaxed">{description}</div>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
      </div>
      {children ? <div className="mt-3 space-y-3">{children}</div> : null}
    </div>
  );
}
