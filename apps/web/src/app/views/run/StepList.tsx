import type { StepState, StepView } from "../../../core/steps.js";
import { formatClock } from "../../../core/presentation.js";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "../../components/Icon";

const STATE: Record<StepState, { label: string; icon: IconName; text: string; bubble: string }> = {
  done: { label: "Xong", icon: "circle-check", text: "text-success", bubble: "bg-surface-strong text-ink" },
  running: { label: "Đang chạy", icon: "loader-circle", text: "text-progress", bubble: "bg-progress-subtle text-progress" },
  waiting: { label: "Chờ", icon: "clock", text: "text-muted", bubble: "bg-surface-strong text-ink" },
  awaiting_approval: { label: "Chờ duyệt", icon: "clock", text: "text-action", bubble: "bg-action-subtle text-action" },
  unknown: { label: "Chưa rõ kết quả", icon: "triangle-alert", text: "text-unknown", bubble: "bg-unknown-subtle text-unknown" },
  failed: { label: "Thất bại", icon: "circle-x", text: "text-danger", bubble: "bg-danger-subtle text-danger" },
  not_run: { label: "Không chạy", icon: "circle-slash", text: "text-neutral", bubble: "bg-neutral-subtle text-neutral" },
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
    <ol className="m-0 flex list-none flex-col gap-5 p-0">
      {steps.map((step, index) => {
        const state = STATE[step.state];
        const kind = step.write ? "ghi" : "đọc";
        const when = step.startedAt ? ` · lúc ${formatClock(step.startedAt, timeZone)}` : "";
        return (
          <li key={step.id} className="grid-step">
            <span className={cn("flex size-12 items-center justify-center rounded-full", state.bubble)}>
              <Icon name={stepIcon(step)} size={20} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body-lg font-medium">{step.description}</span>
              <span className="text-body-sm text-muted">
                Bước {index + 1} · {kind}
                {when}
                {step.attemptError ? ` · ${step.attemptError}` : ""}
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
