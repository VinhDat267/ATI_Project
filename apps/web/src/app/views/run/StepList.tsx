import type { StepState, StepView } from "../../../core/steps.js";
import { formatClock } from "../../../core/presentation.js";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "../../components/Icon";

const STATE: Record<StepState, { label: string; icon: IconName; text: string; bubble: string }> = {
  done: { label: "Xong", icon: "circle-check", text: "text-success font-medium", bubble: "bg-success-subtle text-success border border-success/20" },
  running: { label: "Đang chạy", icon: "loader-circle", text: "text-progress font-medium", bubble: "bg-progress-subtle text-progress ring-2 ring-progress/30 animate-pulse" },
  waiting: { label: "Chờ", icon: "clock", text: "text-muted", bubble: "bg-surface-strong text-muted border border-hairline" },
  awaiting_approval: { label: "Chờ duyệt", icon: "clock", text: "text-action font-medium", bubble: "bg-action-subtle text-action border border-action/30" },
  unknown: { label: "Chưa rõ kết quả", icon: "triangle-alert", text: "text-unknown font-medium", bubble: "bg-unknown-subtle text-unknown" },
  failed: { label: "Thất bại", icon: "circle-x", text: "text-danger font-medium", bubble: "bg-danger-subtle text-danger" },
  not_run: { label: "Không chạy", icon: "circle-slash", text: "text-muted", bubble: "bg-surface-strong text-muted" },
};

function stepIcon(step: StepView): IconName {
  if (step.tool.includes("sheet")) return "table";
  if (step.tool.includes("message")) return "message";
  if (step.tool.includes("card")) return "kanban";
  if (step.server === "filesystem") return "file";
  return "book-open";
}

export function StepList({
  steps,
  timeZone,
}: {
  steps: StepView[];
  timeZone: string;
}) {
  return (
    <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
      {steps.map((step, index) => {
        const state = STATE[step.state];
        const kind = step.write ? "Cập nhật dữ liệu" : "Đọc dữ liệu";
        const when = step.startedAt ? ` · lúc ${formatClock(step.startedAt, timeZone)}` : "";
        return (
          <li
            key={step.id}
            className={cn(
              "grid-step rounded-md border bg-surface-soft p-4 shadow-card transition-all duration-150 hover:shadow-lg",
              step.write
                ? "border-action/30"
                : "border-hairline"
            )}
          >
            <span className={cn("flex size-11 items-center justify-center rounded-full shadow-xs", state.bubble)}>
              <Icon name={stepIcon(step)} size={20} />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-body-lg font-semibold text-ink">{step.description}</span>
              <span className="flex flex-wrap items-center gap-2 text-body-sm text-muted">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-overline font-semibold uppercase tracking-wider",
                    step.write ? "bg-action-subtle text-action" : "bg-success-subtle text-success"
                  )}
                >
                  {kind}
                </span>
                <span>Bước {index + 1}{when}{step.attemptError ? ` · ${step.attemptError}` : ""}</span>
              </span>
            </span>
            <span className={cn("inline-flex items-center gap-1.5 text-button-sm", state.text)}>
              <Icon name={state.icon} className={step.state === "running" ? "animate-spin" : undefined} />
              {state.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
