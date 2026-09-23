import type { Reconciliation, RunDetail } from "../../core/contracts.js";
import { routeToHash } from "../../core/navigation.js";
import {
  formatDateTime,
  formatRemaining,
  isTerminal,
} from "../../core/presentation.js";
import { ButtonLink } from "../components/Button";
import { Icon } from "../components/Icon";
import { RunRow } from "../components/RunRow";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { StatusPill } from "../components/StatusPill";
import { cn } from "@/lib/cn";
import { useAttention, useNow, useRuns } from "../hooks";

function AttentionCard({
  run,
  reconciliation,
  now,
}: {
  run: RunDetail;
  reconciliation?: Reconciliation;
  now: number;
}) {
  const awaiting = run.status === "awaiting_approval";
  const writes = run.approval?.actions.length ?? 0;
  const open = reconciliation?.operations.filter((op) => op.receipt !== "confirmed").length;
  const remaining =
    awaiting && run.approval
      ? formatRemaining(Date.parse(run.approval.expires_at) - now)
      : null;
  const when = awaiting
    ? remaining && !remaining.expired
      ? `Còn ${remaining.text}`
      : "Đã hết hạn"
    : run.created_at
      ? formatDateTime(run.created_at, run.time_zone)
      : "";
  const detail = awaiting
    ? `${writes} thay đổi dữ liệu đang chờ bạn xem và phê duyệt.`
    : open === undefined
      ? "Đang chờ đồng bộ kết quả. Mở để kiểm tra."
      : `${open} cập nhật chưa thể xác nhận trên bảng đích. Vui lòng kiểm tra.`;
  const action = awaiting ? "Xem & duyệt" : "Kiểm tra ngay";

  return (
    <li>
      <a
        href={routeToHash({ page: "run", id: run.run_id })}
        aria-label={`${action}: ${run.source_prompt} (${awaiting ? "Chờ phê duyệt" : "Cần đối chiếu"}${when ? `, ${when}` : ""})`}
        className={cn(
          "flex h-full flex-col gap-3 rounded-md bg-surface-soft p-6 no-underline shadow-card transition-all duration-200 hover:shadow-lg",
          awaiting
            ? "border-2 border-action/60 bg-surface-soft hover:border-action"
            : "border border-hairline hover:border-ink"
        )}
      >
        <span className="flex flex-wrap items-center gap-3">
          <StatusPill status={run.status} />
          <span className="tabular text-body-sm text-muted">{when}</span>
        </span>
        <h3 className="m-0 line-clamp-2 text-title-md">{run.source_prompt}</h3>
        <span className="text-body-md text-muted">{detail}</span>
        <span
          className={cn(
            "mt-1 inline-flex items-center gap-1.5 self-start text-button-sm font-semibold underline underline-offset-3",
            awaiting ? "text-action" : "text-ink"
          )}
        >
          {action}
          <Icon name="arrow-right" />
        </span>
      </a>
    </li>
  );
}

/** V02 — what needs the user now, then recent runs (board OverviewSoft). */
export function OverviewView() {
  const list = useRuns();
  const attention = useAttention();
  const now = useNow(1000);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="m-0 text-display-md-mobile desk:text-display-md">Tổng quan</h1>
      <ButtonLink href={routeToHash({ page: "new" })} size="sm">
        <Icon name="plus" />
        Tạo yêu cầu
      </ButtonLink>
    </div>
  );

  if (list.isPending) {
    return (
      <>
        {header}
        <LoadingState label="Đang tải các lần chạy…" />
      </>
    );
  }
  if (list.isError) {
    return (
      <>
        {header}
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      </>
    );
  }

  const runs = list.data;
  if (runs.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon="message"
          title="Chưa có công việc nào"
          action={
            <ButtonLink href={routeToHash({ page: "new" })}>Tạo yêu cầu đầu tiên</ButtonLink>
          }
        >
          Tạo yêu cầu đầu tiên để trợ lý AI bắt đầu tự động hoá công việc giúp bạn.
        </EmptyState>
      </>
    );
  }

  const attentionIds = new Set(attention.runs.map((run) => run.run_id));
  const active = runs.filter(
    (run) => !isTerminal(run.status) && !attentionIds.has(run.run_id),
  );
  const recent = runs
    .filter((run) => !attentionIds.has(run.run_id) && isTerminal(run.status))
    .slice(0, 6);

  const totalRuns = runs.length;
  const awaitingCount = runs.filter((r) => r.status === "awaiting_approval").length;
  const successCount = runs.filter((r) => r.status === "succeeded").length;
  const reconcileCount = runs.filter((r) => r.status === "reconciliation_required").length;

  return (
    <>
      {header}

      <div className="grid grid-cols-2 gap-3.5 desk:grid-cols-4">
        {/* Tổng công việc */}
        <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-soft p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-overline uppercase tracking-wider text-muted">Tổng công việc</span>
            <span className="flex size-7 items-center justify-center rounded-full bg-surface-strong text-muted">
              <Icon name="file" size={14} />
            </span>
          </div>
          <span className="text-display-md-mobile font-semibold tabular text-ink desk:text-display-md">
            {totalRuns}
          </span>
        </div>

        {/* Chờ phê duyệt */}
        <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-soft p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-overline uppercase tracking-wider text-action">Chờ phê duyệt</span>
            <span className="flex size-7 items-center justify-center rounded-full bg-action-subtle text-action">
              <Icon name="shield-check" size={14} />
            </span>
          </div>
          <span className="text-display-md-mobile font-semibold tabular text-action desk:text-display-md">
            {awaitingCount}
          </span>
        </div>

        {/* Đã hoàn thành */}
        <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-soft p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-overline uppercase tracking-wider text-success">Đã hoàn thành</span>
            <span className="flex size-7 items-center justify-center rounded-full bg-success-subtle text-success">
              <Icon name="circle-check" size={14} />
            </span>
          </div>
          <span className="text-display-md-mobile font-semibold tabular text-success desk:text-display-md">
            {successCount}
          </span>
        </div>

        {/* Cần kiểm tra lại */}
        <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-soft p-4 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-overline uppercase tracking-wider text-muted">Cần kiểm tra lại</span>
            <span
              className={cn(
                "flex size-7 items-center justify-center rounded-full",
                reconcileCount > 0 ? "bg-danger-subtle text-danger" : "bg-surface-strong text-muted",
              )}
            >
              <Icon name="triangle-alert" size={14} />
            </span>
          </div>
          <span
            className={cn(
              "text-display-md-mobile font-semibold tabular desk:text-display-md",
              reconcileCount > 0 ? "text-danger" : "text-muted",
            )}
          >
            {reconcileCount}
          </span>
        </div>
      </div>

      {/* Quick Launch Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <a
          href={routeToHash({ page: "new" })}
          className="group flex items-center justify-between rounded-md border border-hairline bg-surface-soft p-4 no-underline shadow-card transition-all hover:border-ink hover:shadow-lg"
        >
          <div className="flex items-center gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
              <Icon name="sparkles" size={18} />
            </span>
            <div className="flex flex-col">
              <span className="text-title-md font-semibold text-ink group-hover:text-primary">
                Tạo yêu cầu với Trợ lý AI
              </span>
              <span className="text-body-sm text-muted">
                Nhập mô tả bằng ngôn ngữ tự nhiên để AI lập kế hoạch
              </span>
            </div>
          </div>
          <Icon name="arrow-right" size={16} className="text-muted transition-transform group-hover:translate-x-1 group-hover:text-ink" />
        </a>

        <a
          href={routeToHash({ page: "pilot-new" })}
          className="group flex items-center justify-between rounded-md border border-hairline bg-surface-soft p-4 no-underline shadow-card transition-all hover:border-action hover:shadow-lg"
        >
          <div className="flex items-center gap-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-action text-on-primary">
              <Icon name="kanban" size={18} />
            </span>
            <div className="flex flex-col">
              <span className="text-title-md font-semibold text-ink group-hover:text-action">
                Điều phối mẫu Google Sheets → Trello
              </span>
              <span className="text-body-sm text-muted">
                Quy trình chuẩn hoá với bộ kiểm tra checklist tự động
              </span>
            </div>
          </div>
          <Icon name="arrow-right" size={16} className="text-muted transition-transform group-hover:translate-x-1 group-hover:text-action" />
        </a>
      </div>

      {attention.runs.length > 0 ? (
        <section aria-labelledby="attention-title" className="flex flex-col gap-4">
          <h2 id="attention-title" className="m-0 text-headline-sm">
            Cần xử lý
          </h2>
          <ul className="m-0 grid list-none gap-4 p-0 desk:grid-cols-2">
            {attention.runs.map((run) => (
              <AttentionCard
                key={run.run_id}
                run={run}
                reconciliation={attention.reconciliation.get(run.run_id)}
                now={now}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {active.length > 0 ? (
        <section aria-labelledby="active-title" className="flex flex-col gap-2">
          <h2 id="active-title" className="m-0 text-headline-sm">
            Đang xử lý
          </h2>
          <ul className="m-0 list-none p-0">
            {active.map((run) => (
              <RunRow key={run.run_id} run={run} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="recent-title" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <h2 id="recent-title" className="m-0 text-headline-sm">
            Công việc gần đây
          </h2>
          <a href={routeToHash({ page: "history" })} className="inline-flex min-h-11 items-center text-button-sm">
            Xem tất cả
          </a>
        </div>
        {recent.length === 0 ? (
          <p className="m-0 text-body-md text-muted">Chưa có công việc nào hoàn thành gần đây.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {recent.map((run) => (
              <RunRow
                key={run.run_id}
                run={run}
                reconciliation={attention.reconciliation.get(run.run_id)}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
