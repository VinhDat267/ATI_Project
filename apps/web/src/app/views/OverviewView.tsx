import type { Reconciliation, RunDetail } from "../../core/contracts.js";
import { routeToHash } from "../../core/navigation.js";
import {
  formatClock,
  formatDateTime,
  formatRemaining,
  isTerminal,
} from "../../core/presentation.js";
import { ButtonLink } from "../components/Button";
import { Icon } from "../components/Icon";
import { RunRow } from "../components/RunRow";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { StatusPill } from "../components/StatusPill";
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
      ? `Hết hạn sau ${remaining.text}${run.approval ? ` (${formatClock(run.approval.expires_at, run.time_zone)})` : ""}`
      : "Đã hết thời hạn duyệt"
    : run.created_at
      ? `Tạo lúc ${formatDateTime(run.created_at, run.time_zone)}`
      : "";
  const detail = awaiting
    ? `${writes} thao tác ghi đang chờ quyết định.`
    : open === undefined
      ? "Chưa tải được kết quả đối chiếu. Mở để kiểm tra bảng đích."
      : `${open} thao tác ghi chưa thấy trên nơi nhận. Kiểm tra bảng đích trước khi tạo lại.`;
  const action = awaiting ? "Xem và duyệt" : "Mở đối chiếu";

  return (
    <li>
      <a
        href={routeToHash({ page: "run", id: run.run_id })}
        className="flex h-full flex-col gap-3 rounded-md border border-hairline p-6 no-underline hover:border-ink"
      >
        <span className="flex flex-wrap items-center gap-3">
          <StatusPill status={run.status} />
          <span className="tabular text-body-sm text-muted">{when}</span>
        </span>
        <h3 className="m-0 text-title-md">{run.source_prompt}</h3>
        <span className="text-body-md text-muted">{detail}</span>
        <span className="mt-1 inline-flex items-center gap-1.5 self-start text-button-sm underline underline-offset-3">
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
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-display-md-mobile desk:text-display-md">Tổng quan</h1>
        {list.data ? (
          <p className="m-0 text-body-md text-muted">
            {list.data.length} lần chạy đã tải · thời gian hiển thị là lúc tạo yêu cầu
          </p>
        ) : null}
      </div>
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
          title="Chưa có lần chạy nào"
          action={
            <ButtonLink href={routeToHash({ page: "new" })}>Tạo yêu cầu đầu tiên</ButtonLink>
          }
        >
          Mô tả việc cần làm; hệ thống lập kế hoạch và cho bạn xem trước trước khi ghi.
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
  const hasActive = runs.some((run) => !isTerminal(run.status));

  return (
    <>
      {header}

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
          {hasActive ? (
            <p className="m-0 flex items-start gap-2 text-body-sm text-muted">
              <Icon name="info" className="mt-0.5" />
              Mỗi lúc chỉ có một lần chạy hoạt động; yêu cầu mới được nhận sau khi lần chạy đang hoạt động kết thúc.
            </p>
          ) : null}
        </section>
      ) : null}

      {active.length > 0 ? (
        <section aria-labelledby="active-title" className="flex flex-col gap-2">
          <h2 id="active-title" className="m-0 text-headline-sm">
            Đang chạy
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
            Lần chạy gần đây
          </h2>
          <a href={routeToHash({ page: "history" })} className="inline-flex min-h-11 items-center text-button-sm">
            Xem tất cả
          </a>
        </div>
        {recent.length === 0 ? (
          <p className="m-0 text-body-md text-muted">Chưa có lần chạy nào kết thúc.</p>
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
