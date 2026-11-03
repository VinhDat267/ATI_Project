import { forwardRef, type ReactNode } from 'react';
import { PlanoraMark, Brand } from '../components/Brand';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import '../styles/auth.css';

export interface PlanoraAuthFrameProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  badge?: string;
  onClose?: () => void;
  showEditorial?: boolean;
  tabs?: ReactNode;
  className?: string;
}

/**
 * Editorial panel featuring Planora paper-art illustration and quiet notes
 */
export function PlanoraEditorial({ badge = 'MỘT KHOẢNG TRỐNG CHO Ý TƯỞNG' }: { badge?: string }) {
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
        <svg viewBox="0 0 500 350" fill="none">
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
            <path d="M251 136V161" stroke="var(--planora-muted)" strokeWidth="1.2" />
            <circle cx="251" cy="166" r="3" fill="var(--planora-primary)" />
          </g>
        </svg>
        <span className="paper-art-caption">một khởi đầu nhỏ. một hướng đi rõ.</span>
      </div>
      <div className="planora-editorial-quiet-note">
        <span className="planora-quiet-note-line" />
        <p>
          Bớt những việc rời rạc.
          <br />
          Thêm chỗ cho điều bạn muốn làm.
        </p>
      </div>
      <div className="planora-editorial-bottom">
        <span className="planora-brand-word">planora</span>
        <span>Từ ý tưởng đến hành động.</span>
      </div>
    </aside>
  );
}

/**
 * Planora Authentication Frame
 * Khung layout split/card thanh lịch chuẩn Planora, tích hợp thương hiệu Monogram, chuyển đổi theme sáng/tối.
 */
export const PlanoraAuthFrame = forwardRef<HTMLDivElement, PlanoraAuthFrameProps>(
  function PlanoraAuthFrame(
    {
      title,
      subtitle,
      children,
      footer,
      badge,
      onClose,
      showEditorial = true,
      tabs,
      className = '',
    },
    ref
  ) {
    return (
      <div className={`planora-auth-frame ${className}`.trim()} ref={ref}>
        <header className="planora-auth-top-nav">
          <Brand size="sm" onClick={onClose} />
          <div className="planora-auth-nav-actions">
            <ThemeToggle />
            {onClose && (
              <button
                type="button"
                className="planora-auth-close-btn"
                onClick={onClose}
                aria-label="Đóng cửa sổ"
                data-od-id="btn-close-auth"
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

        <div className={`planora-auth-main ${showEditorial ? 'has-editorial' : 'no-editorial'}`}>
          {showEditorial && <PlanoraEditorial badge={badge} />}

          <section className="planora-auth-card" aria-labelledby="planora-auth-title">
            {tabs && <div className="planora-auth-tabs">{tabs}</div>}

            <div className="planora-auth-header">
              <div className="planora-auth-kicker">
                <span className="planora-kicker-dot" aria-hidden="true" />
                <span className="planora-kicker-text">
                  {badge ?? 'KHÔNG GIAN LÀM VIỆC PLANORA'}
                </span>
              </div>
              <h1 id="planora-auth-title" className="planora-font-serif planora-auth-heading">
                {title}
              </h1>
              {subtitle && <div className="planora-auth-subtitle">{subtitle}</div>}
            </div>

            <div className="planora-auth-body">{children}</div>

            {footer && <div className="planora-auth-footer">{footer}</div>}
          </section>
        </div>
      </div>
    );
  }
);
export default PlanoraAuthFrame;
