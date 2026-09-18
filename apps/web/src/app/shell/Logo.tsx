/** ATI wordmark with its node-graph mark (from the design canvas). */
export function Logo() {
  return (
    <span className="flex items-center gap-2.5 text-primary">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="currentColor" />
        <circle cx="10" cy="11" r="2.6" fill="#FFFFFF" />
        <circle cx="22" cy="11" r="2.6" fill="#FFFFFF" />
        <circle cx="16" cy="22" r="2.6" fill="#FFFFFF" />
        <path
          d="M12.8 11h6.4M11.4 13.4l3.2 6M20.6 13.4l-3.2 6"
          stroke="#FFFFFF"
          strokeOpacity="0.7"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-wordmark">ATI</span>
    </span>
  );
}
