import { forwardRef, type ReactNode } from 'react';
import { Brand, PlanoraMark } from '../components/Brand';
import { StatusBadge, type StatusType } from '../components/StatusBadge';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import { ServiceLogo } from '../../components/ServiceLogo';
import '../styles/auth.css';

export interface ConnectionCallbackFrameProps {
  /** Identifier of the service, e.g. 'gmail', 'mycalendar', 'mysheets', 'trello', etc. */
  serviceId?: string;
  /** Display name of the service, e.g. 'Gmail', 'Google Calendar', 'Google Sheets' */
  serviceName?: string;
  /** Primary title of the callback view */
  title: string;
  /** Subtitle or authenticated account context */
  subtitle?: ReactNode;
  /** Kicker badge text above heading */
  badge?: string;
  /** Status type for the top status indicator */
  statusType?: StatusType;
  /** Label for the status badge */
  statusLabel?: string;
  /** Error message or alert element */
  error?: ReactNode;
  /** Whether the callback is currently loading/processing */
  loading?: boolean;
  /** Status announcement text when loading */
  loadingText?: string;
  /** Main interactive content of the callback */
  children?: ReactNode;
  /** Primary and secondary CTA action buttons */
  actions?: ReactNode;
  /** Handler to navigate back to settings or previous view */
  onBackToSettings?: () => void;
  /** Label for the return link/button */
  backToSettingsLabel?: string;
  /** Whether to show the editorial panel on desktop viewports */
  showEditorial?: boolean;
  /** Additional CSS class names */
  className?: string;
  /** Card DOM identifier */
  cardId?: string;
}

export function CallbackEditorial({ badge = 'KẾT NỐI LIÊN DỊCH VỤ' }: { badge?: string }) {
  return (
    <aside className="planora-auth-editorial" aria-labelledby="planora-editorial-title">
      <div className="planora-editorial-top">
        <span className="planora-editorial-eyebrow">{badge}</span>
        <span className="planora-editorial-edition">P / 01</span>
      </div>
      <h2 id="planora-editorial-title">
        Điều lớn lao,
        <br />
        <em>từ một khởi đầu nhỏ.</em>
      </h2>
      <div className="planora-paper-art" aria-hidden="true">
        <svg viewBox="0 0 500 350" fill="none" aria-hidden="true">
          <ellipse
            cx="250"
            cy="300"
            rx="155"
            ry="13"
            fill="var(--planora-primary)"
            opacity=".08"
          />
          <g className="paper-art-stack">
            <path
              d="M83 220 251 271 425 191 257 133Z"
              fill="var(--planora-primary-soft)"
              stroke="var(--planora-border-strong)"
            />
            <path
              d="M82 201 250 252 425 173 257 115Z"
              fill="var(--planora-sidebar)"
              stroke="var(--planora-divider)"
            />
            <path
              d="M82 181 250 233 425 153 257 95Z"
              fill="var(--planora-paper)"
              stroke="var(--planora-divider)"
            />
            <path d="M250 233V171L425 153" fill="var(--planora-surface-inset)" />
            <path d="M250 233V171L425 153" stroke="var(--planora-divider)" />
            <path
              d="M135 176 249 205 367 154"
              stroke="var(--planora-muted)"
              strokeWidth="1.2"
              strokeDasharray="3 6"
            />
            <circle cx="135" cy="176" r="4" fill="var(--planora-primary)" />
            <circle cx="367" cy="154" r="4" fill="var(--planora-primary)" />
            <g transform="translate(216 55) rotate(-10 35 35)">
              <g className="paper-art-seal">
                <rect width="70" height="70" rx="18" fill="var(--planora-primary)" />
                <g transform="translate(14 13) scale(1.35)" color="var(--planora-on-primary)">
                  <PlanoraMark />
                </g>
              </g>
            </g>
          </g>
        </svg>
      </div>
      <p className="planora-editorial-footnote">
        Mỗi kết nối dịch vụ mở rộng không gian hành động tự chủ của tổ chức — an toàn, minh bạch và trong tầm kiểm soát.
      </p>
    </aside>
  );
}

/**
 * Planora Connection Callback Frame
 *
 * Khung giao diện callback kết nối liên dịch vụ chuẩn editorial Planora.
 * Đóng vai trò thuần túy trình bày giao diện (presentation-only), KHÔNG tiêu thụ hoặc mutate
 * OAuth state. Bảo toàn state machine, error handling và returnTo riêng của từng view.
 * Đạt chuẩn WCAG AA (tương phản >= 4.5:1, min tap target 44px, 100% SVG aria-hidden).
 */
export const ConnectionCallbackFrame = forwardRef<HTMLDivElement, ConnectionCallbackFrameProps>(
  function ConnectionCallbackFrame(
    {
      serviceId,
      serviceName,
      title,
      subtitle,
      badge = 'KẾT NỐI LIÊN DỊCH VỤ',
      statusType,
      statusLabel,
      error,
      loading = false,
      loadingText = 'Đang xử lý kết nối…',
      children,
      actions,
      onBackToSettings,
      backToSettingsLabel = 'Về Kết nối dịch vụ',
      showEditorial = true,
      className = '',
      cardId = 'connection-callback-card',
    },
    ref
  ) {
    return (
      <div className={`planora-auth-frame planora-callback-frame ${className}`.trim()} ref={ref}>
        {/* Thanh điều hướng trên cùng */}
        <header className="planora-auth-top-nav">
          <Brand size="sm" onClick={onBackToSettings} />
          <div className="planora-auth-nav-actions">
            <ThemeToggle />
            {onBackToSettings && (
              <button
                type="button"
                className="planora-auth-close-btn"
                onClick={onBackToSettings}
                aria-label="Đóng"
                title={backToSettingsLabel}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </header>

        {/* Thân trang callback */}
        <div className={`planora-auth-main ${showEditorial ? 'has-editorial' : 'no-editorial'}`}>
          {showEditorial && <CallbackEditorial badge={badge} />}

          <section
            id={cardId}
            className="planora-auth-card planora-callback-card"
            aria-labelledby="callback-title"
          >
            {/* Header thông tin dịch vụ */}
            <div className="planora-auth-header">
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <div className="planora-auth-kicker">
                  <span className="planora-kicker-dot" aria-hidden="true" />
                  <span className="planora-kicker-text">{badge}</span>
                </div>
                {statusType && (
                  <StatusBadge
                    status={statusType}
                    label={statusLabel}
                    className="planora-callback-status-badge"
                  />
                )}
              </div>

              <div className="flex items-center gap-3 mt-1">
                {serviceId && (
                  <div
                    className="w-10 h-10 rounded-xl bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] flex items-center justify-center flex-shrink-0 shadow-xs"
                    title={serviceName}
                  >
                    <ServiceLogo service={serviceId} className="w-6 h-6" />
                  </div>
                )}
                <h1
                  id="callback-title"
                  className="planora-font-serif planora-auth-heading text-2xl sm:text-3xl font-semibold text-[var(--planora-text)]"
                >
                  {title}
                </h1>
              </div>

              {subtitle && (
                <div className="planora-auth-subtitle mt-2 text-sm text-[var(--planora-muted)]">
                  {subtitle}
                </div>
              )}
            </div>

            {/* Thân nội dung chính */}
            <div className="planora-auth-body v3-space-y-4">
              {/* Thông báo trạng thái loading */}
              {loading && !error && (
                <div className="p-4 rounded-xl bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] flex items-center gap-3">
                  <svg
                    className="w-5 h-5 animate-spin text-[var(--planora-primary)] flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <p role="status" className="text-sm font-medium text-[var(--planora-text)]">
                    {loadingText}
                  </p>
                </div>
              )}

              {/* Thông báo lỗi */}
              {error && (
                <div className="p-4 rounded-xl bg-[var(--planora-error-bg,#FEF2F2)] border border-[var(--planora-error-border,#FECACA)] text-sm text-[var(--planora-error-text,#991B1B)]">
                  {typeof error === 'string' ? <p role="alert">{error}</p> : error}
                </div>
              )}

              {/* Khối tương tác (chọn lịch, bảng tính, v.v.) */}
              {children}
            </div>

            {/* Chân trang và các nút hành động */}
            {(actions || onBackToSettings) && (
              <div className="planora-auth-footer flex flex-col gap-3 pt-4 border-t border-[var(--planora-divider)]">
                {actions}
                {onBackToSettings && (
                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={onBackToSettings}
                      className="text-xs text-[var(--planora-primary)] hover:underline font-medium inline-flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-[var(--planora-primary)]"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M10 19l-7-7m0 0l7-7m-7 7h18"
                        />
                      </svg>
                      <span>{backToSettingsLabel}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Chữ ký chân trang Planora */}
            <div className="mt-6 pt-3 text-center text-[11px] text-[var(--planora-muted)] border-t border-[var(--planora-divider)]">
              Planora — Nền tảng điều phối công việc liên dịch vụ · 2026
            </div>
          </section>
        </div>
      </div>
    );
  }
);

export default ConnectionCallbackFrame;
