import { type ReactNode } from 'react';

export type StatusType = 'success' | 'pending' | 'error' | 'unknown';

export interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  icon?: ReactNode;
  className?: string;
}

const defaultStatusLabels: Record<StatusType, string> = {
  success: 'Hoàn tất',
  pending: 'Chờ duyệt',
  error: 'Thất bại',
  unknown: 'Chưa rõ',
};

function DefaultStatusIcon({ status }: { status: StatusType }) {
  switch (status) {
    case 'success':
      return (
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="planora-badge-icon"
          aria-hidden="true"
        >
          <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      );
    case 'pending':
      return (
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="planora-badge-icon"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.5" />
          <polyline points="8 4.5 8 8 10.5 9.5" />
        </svg>
      );
    case 'error':
      return (
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="planora-badge-icon"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.5" />
          <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" />
          <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" />
        </svg>
      );
    case 'unknown':
      return (
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="planora-badge-icon"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.5" />
          <path d="M6.5 6.5a1.5 1.5 0 0 1 2.8.6c0 1-.9 1.4-.9 1.9" />
          <line x1="8" y1="11.5" x2="8.01" y2="11.5" />
        </svg>
      );
  }
}

/**
 * Huy hiệu trạng thái ngữ nghĩa Planora
 */
export function StatusBadge({
  status,
  label,
  icon,
  className = '',
}: StatusBadgeProps) {
  const displayText = label ?? defaultStatusLabels[status];

  return (
    <span
      className={`planora-badge planora-badge-${status} ${className}`.trim()}
      role="status"
    >
      {icon ?? <DefaultStatusIcon status={status} />}
      <span>{displayText}</span>
    </span>
  );
}
