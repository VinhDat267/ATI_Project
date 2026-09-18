import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";

/**
 * Native disclosure for technical detail. Keyboard support comes from
 * <details>/<summary>; open state survives polling because the element is
 * keyed by a stable id in the caller.
 */
export function TechDisclosure({
  summary,
  hint,
  children,
  className,
}: {
  summary: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-button-sm [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <span className="flex items-center gap-2 font-mono text-mono-sm text-muted">
          {hint}
          <Icon
            name="chevron-down"
            className="text-ink transition-transform group-open:rotate-180"
          />
        </span>
      </summary>
      <div className="pb-3">{children}</div>
    </details>
  );
}

/** Raw value as text only (never HTML), wrapped inside its own scroll area. */
export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface-soft p-4 font-mono text-mono-md">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
