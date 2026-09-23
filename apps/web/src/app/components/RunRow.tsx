import type { Reconciliation, RunDetail } from "../../core/contracts.js";
import { routeToHash } from "../../core/navigation.js";
import {
  formatClock,
  formatDateTime,
  planCounts,
  shortId,
} from "../../core/presentation.js";
import { StatusPill } from "./StatusPill";

const SERVER_LABELS: Record<string, string> = {
  sheets: "Google Sheets",
  trello: "Trello",
  "pilot-gateway": "Cổng kết nối",
};

/** Secondary line built only from data the list already has (spec V04). */
export function runSubline(
  run: RunDetail,
  reconciliation?: Reconciliation,
): string {
  const planner = run.planner_result;
  if (planner?.kind === "refusal") return `Trợ lý AI phản hồi: “${planner.reason}”`;
  if (planner?.kind === "clarification") return `Trợ lý AI cần hỏi: “${planner.question}”`;
  if (!run.plan) return "Đang phân tích yêu cầu…";

  const { steps, writes } = planCounts(run);
  const servers = [...new Set(run.plan.steps.map((step) => step.tool.server))];
  const serverNames = servers.map((s) => SERVER_LABELS[s] || s).join(", ");
  const parts = [
    `${steps} bước`,
    writes > 0 ? `${writes} cập nhật dữ liệu` : "Chỉ tổng hợp thông tin",
    serverNames,
  ];
  if (run.status === "awaiting_approval" && run.approval) {
    parts.push(`Hạn duyệt: ${formatClock(run.approval.expires_at, run.time_zone).slice(0, 5)}`);
  }
  if (run.status === "expired" && run.approval) {
    parts.push(`Hết hạn lúc ${formatClock(run.approval.expires_at, run.time_zone)}`);
  }
  if (run.status === "reconciliation_required" && reconciliation) {
    const open = reconciliation.operations.filter((op) => op.receipt !== "confirmed").length;
    parts.push(
      open > 0 ? `${open} thay đổi cần kiểm tra lại` : "Đã đồng bộ an toàn",
    );
  }
  return parts.filter(Boolean).join(" · ");
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
        className="grid gap-x-6 gap-y-2 border-b border-hairline py-4 no-underline rounded-md transition-colors duration-150 hover:bg-surface-soft desk:grid-cols-[minmax(0,1fr)_auto] desk:px-4"
      >
        <span className="flex min-w-0 flex-col gap-1.5">
          <StatusPill status={run.status} className="self-start" />
          <span className="line-clamp-2 text-title-md">{run.source_prompt ?? "Không rõ yêu cầu"}</span>
          <span className="text-body-sm text-muted">{runSubline(run, reconciliation)}</span>
        </span>
        <span className="flex gap-3 text-body-sm text-muted desk:flex-col desk:items-end desk:gap-1">
          <span className="tabular">{created}</span>
          <span className="font-mono text-mono-sm">#{shortId(run.run_id)}</span>
        </span>
      </a>
    </li>
  );
}
