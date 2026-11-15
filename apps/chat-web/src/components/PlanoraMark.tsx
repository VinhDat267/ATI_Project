interface PlanoraMarkProps {
  className?: string;
  tone?: 'adaptive' | 'inverse';
}

/**
 * Canonical 3-piece geometric Planora "P" mark matching the Landing product film:
 *   A = vertical backbone pillar (x: 14..36, y: 10..90)
 *   B = workflow D-loop head     (x: 46..88, y: 10..56)
 *   D = signature orange dot     (cx: 68, cy: 79, r: 13)
 */
export function PlanoraMark({ className = 'w-7 h-7 shrink-0', tone = 'adaptive' }: PlanoraMarkProps) {
  const dotFill = tone === 'inverse' ? '#FF5701' : 'var(--planora-mark-dot, #FF5701)';
  return (
    <svg
      data-planora-mark="true"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 100 100"
      fill="none"
      className={className}
    >
      <rect x="14" y="10" width="22" height="80" rx="6" fill="currentColor" />
      <path d="M46 10 H65 A23 23 0 0 1 65 56 H46 Z" fill="currentColor" />
      <circle cx="68" cy="79" r="13" fill={dotFill} />
    </svg>
  );
}
