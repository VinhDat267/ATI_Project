export interface PlanoraMarkProps {
  size?: number | string;
  className?: string;
}

/**
 * Biểu tượng Monogram P của Planora kết hợp nét định hướng
 */
export function PlanoraMark({ size = 32, className = '' }: PlanoraMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      className={className}
    >
      <path
        d="M10 25V7h8a6 6 0 0 1 0 12h-8m0 6 13-13"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="10" cy="25" r="2" fill="currentColor" />
      <circle cx="23" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

export interface BrandProps {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  showSubtitle?: boolean;
  subtitle?: string;
  onClick?: () => void;
  label?: string;
  className?: string;
  href?: string;
}

/**
 * Nhận diện thương hiệu Planora
 */
export function Brand({
  size = 'md',
  showWordmark = true,
  showSubtitle = true,
  subtitle = 'Workflow workspace',
  onClick,
  label = 'Planora — trang chính',
  className = '',
  href,
}: BrandProps) {
  const content = (
    <>
      <span className="planora-brand-symbol">
        <PlanoraMark />
      </span>
      {showWordmark && (
        <span className="planora-brand-text">
          <span className="planora-brand-word">planora</span>
          {showSubtitle && <span className="planora-brand-sub">{subtitle}</span>}
        </span>
      )}
    </>
  );

  const rootClass = `planora-brand planora-brand-${size} ${className}`.trim();

  if (href) {
    return (
      <a href={href} className={rootClass} aria-label={label} onClick={onClick}>
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button type="button" className={rootClass} aria-label={label} onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <div className={rootClass} aria-label={label} role="banner">
      {content}
    </div>
  );
}

const serviceLogoFiles: Record<string, string> = {
  GitHub: '/logos/github.svg',
  Trello: '/logos/trello.svg',
  Slack: '/logos/slack.svg',
  'Google Sheets': '/logos/google-sheets.svg',
  'Google Calendar': '/logos/google-calendar.svg',
  Jira: '/logos/jira.svg',
  Telegram: '/logos/telegram.svg',
  Notion: '/logos/notion.png',
};

export interface ServiceLogoProps {
  name: string;
  size?: number;
  className?: string;
  alt?: string;
}

/**
 * Hiển thị logo chính thức của dịch vụ bên thứ ba tự host trong public/logos
 */
export function ServiceLogo({
  name,
  size = 20,
  className = '',
  alt = '',
}: ServiceLogoProps) {
  const normalized = name.trim().toLowerCase();
  const matchedKey = Object.keys(serviceLogoFiles).find(
    k => k.toLowerCase() === normalized
  );
  const asset = matchedKey ? serviceLogoFiles[matchedKey] : undefined;

  if (!asset) {
    return (
      <span
        className={`planora-service-fallback ${className}`}
        style={{
          width: size,
          height: size,
          display: 'inline-grid',
          placeItems: 'center',
          borderRadius: 4,
          backgroundColor: 'var(--planora-divider)',
          color: 'var(--planora-muted)',
          fontSize: Math.max(10, size * 0.5),
          fontWeight: 700,
        }}
        aria-hidden={!alt}
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={asset}
      alt={alt}
      aria-hidden={!alt}
      width={size}
      height={size}
      className={`planora-service-logo ${className}`.trim()}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}
