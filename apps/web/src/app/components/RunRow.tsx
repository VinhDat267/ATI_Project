import type { Reconciliation, RunDetail } from "../../core/contracts.js";
import { routeToHash } from "../../core/navigation.js";
import {
  formatClock,
  formatDateTime,
  planCounts,
  shortId,
} from "../../core/presentation.js";
import { StatusPill } from "./StatusPill";

/** Secondary line built only from data the list already has (spec V04). */
export function runSubline(
  run: RunDetail,
  reconciliation?: Reconciliation,
): string {
  const planner = run.planner_result;
  if (planner?.kind === "refusal") return `Hệ thống trả lời: “${planner.reason}”`;
  if (planner?.kind === "clarification") return `Hệ thống hỏi: “${planner.question}”`;
  if (!run.plan) return "Chưa có kế hoạch";

  const { steps, writes } = planCounts(run);
  const servers = [...new Set(run.plan.steps.map((step) => step.tool.server))];
  const parts = [
    `${steps} bước`,
    writes > 0 ? `${writes} thao tác ghi` : "chỉ đọc",
    servers.join(", "),
  ];
  if (run.status === "awaiting_approval" && run.approval) {
    parts.push(`Hết hạn duyệt lúc ${formatClock(run.approval.expires_at, run.time_zone).slice(0, 5)}`);
  }
  if (run.status === "expired" && run.approval) {
    parts.push(`hết hạn lúc ${formatClock(run.approval.expires_at, run.time_zone)}`);
  }
  if (run.status === "reconciliation_required" && reconciliation) {
    const open = reconciliation.operations.filter((op) => op.receipt !== "confirmed").length;
    parts.push(
      open > 0 ? `${open} thao tác ghi chưa rõ kết quả` : "đã xác nhận khi đối chiếu",
    );
  }
  return parts.join(" · ");
}

export function RunRow({
  run,
  reconciliation,
}: {
  run: RunDetail;
  reconciliation?: Reconciliation;
}) {
  const created = run.created_at
    ? formatDateTime(run.created_at, run.time_zone)
    : "Không rõ thời gian";
  return (
    <li>
      <a
        href={routeToHash({ page: "run", id: run.run_id })}
        className="grid gap-x-6 gap-y-2 border-b border-hairline py-4 no-underline hover:bg-surface-soft desk:grid-cols-[minmax(0,1fr)_auto] desk:px-3"
      >
        <span className="flex min-w-0 flex-col gap-1.5">
          <StatusPill status={run.status} className="self-start" />
          <span className="line-clamp-2 text-title-md">{run.source_prompt ?? "Không rõ yêu cầu"}</span>
          <span className="text-body-sm text-muted">{runSubline(run, reconciliation)}</span>
        </span>
        <span className="flex gap-3 text-body-sm text-muted desk:flex-col desk:items-end desk:gap-1">
          <span className="tabular">{created}</span>
          <span className="font-mono text-mono-sm">{shortId(run.run_id)}</span>
        </span>
      </a>
    </li>
  );
}
