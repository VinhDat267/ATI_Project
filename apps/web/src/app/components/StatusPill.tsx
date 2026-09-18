import type { RunStatus } from "@wap/dsl/browser";
import { runPresentation } from "../../core/presentation.js";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";
import { TONE_CLASSES } from "./tone";

export function StatusPill({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const view = runPresentation(status);
  return (
    <span
      className={cn(
        "inline-flex h-6.5 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-badge",
        TONE_CLASSES[view.tone],
        className,
      )}
    >
      <Icon name={view.icon} size={14} />
      {view.label}
    </span>
  );
}
