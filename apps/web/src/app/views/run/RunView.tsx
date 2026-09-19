import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { EventPage, Reconciliation, RunDetail, TracePage } from "../../../core/contracts.js";
import { routeToHash } from "../../../core/navigation.js";
import {
  formatClock,
  formatDateTime,
  planCounts,
  runPresentation,
  shortId,
} from "../../../core/presentation.js";
import {
  reconciliationQuery,
} from "../../../core/queries.js";
import { recoveryFor, type ReceiptKind } from "../../../core/recovery.js";
import { stepViews } from "../../../core/steps.js";
import { summarizeAction } from "../../../core/writes.js";
import { useApp } from "../../context";
import { Banner } from "../../components/Banner";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { ErrorState, LoadingState } from "../../components/States";
import { StatusPill } from "../../components/StatusPill";
import { JsonBlock, TechDisclosure } from "../../components/TechDisclosure";
import { CancelControl } from "./CancelControl";
import { DecisionCard } from "./DecisionCard";
import { ReconciliationSection } from "./ReconciliationSection";
import { RecoveryActions } from "./RecoveryActions";
import { StepList } from "./StepList";
import { WriteCard } from "./WriteCard";

type RunEvent = EventPage["events"][number];

function Section({ title, children, last = false }: { title: string; children: ReactNode; last?: boolean }) {
  return (
    <section className={last ? "flex flex-col gap-4 pt-8" : "flex flex-col gap-5 border-b border-hairline py-8"}>
      <h2 className="m-0 text-headline-sm">{title}</h2>
      {children}
    </section>
  );
}

function eventLine(event: RunEvent, run: RunDetail): string | null {
  const step = (id: string) => run.plan?.steps.find((s) => s.id === id)?.description ?? id;
  switch (event.type) {
    case "run.status":
      return `Trạng thái: ${runPresentation(event.payload.status).label}`;
    case "plan.ready":
      return `Kế hoạch v${event.payload.version_no} hợp lệ`;
    case "validation.failed":
      return `Kế hoạch chưa hợp lệ (lần ${event.payload.attempt_no}/${event.payload.max_attempts}), đang sửa`;
    case "dryrun.ready":
      return "Bản xem trước sẵn sàng, chờ duyệt";
    case "step.started":
      return `Bắt đầu: ${step(event.payload.step_id)}`;
    case "step.retrying":
      return `Thử lại: ${step(event.payload.step_id)} (${event.payload.error_message})`;
    case "step.succeeded":
      return `Xong: ${step(event.payload.step_id)}`;
    case "step.failed":
      return `Lỗi ở ${step(event.payload.step_id)}: ${event.payload.error_message}`;
    case "step.skipped":
      return `Không chạy: ${step(event.payload.step_id)} (${event.payload.condition})`;
    case "replan.started":
      return "Đang điều chỉnh kế hoạch";
    case "replan.applied":
      return `Áp dụng kế hoạch v${event.payload.version_no}`;
    case "run.finished":
      return `Lần chạy kết thúc: ${runPresentation(event.payload.status).label.toLowerCase()}`;
    default:
      return null;
  }
}

function Activity({ run, events }: { run: RunDetail; events: RunEvent[] | undefined }) {
  const lines = (events ?? [])
    .map((event) => ({ event, text: eventLine(event, run) }))
    .filter((line): line is { event: RunEvent; text: string } => line.text !== null)
    .reverse();
  return (
    <Section title="Hoạt động" last>
      {lines.length === 0 ? (
        <p className="m-0 text-body-md text-muted">Chưa có hoạt động nào được ghi nhận.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3.5 p-0 text-body-md">
          {lines.map(({ event, text }, index) => (
            <li key={event.seq} className="grid-timeline">
              <span className="tabular text-muted">{formatClock(event.created_at, run.time_zone)}</span>
              <span className={index === 0 ? "font-semibold" : undefined}>{text}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function StatusBanner({ run, trace, reconciliation }: { run: RunDetail; trace?: TracePage; reconciliation?: Reconciliation }) {
  const planner = run.planner_result;
  switch (run.status) {
    case "planning":
    case "validating":
    case "dry_running":
    case "replanning":
      return (
        <Banner tone="progress" icon="loader-circle" title={`${runPresentation(run.status).label}…`} live>
          Chưa có gì bị ghi. Trang tự cập nhật; bạn sẽ được xem trước trước khi duyệt.
        </Banner>
      );
    case "awaiting_approval":
      return (
        <Banner tone="action" icon="hand" title="Hệ thống đang chờ bạn quyết định">
          Dữ liệu đã được đọc và bản xem trước đã sẵn sàng. Chưa có gì bị ghi cho tới khi bạn duyệt.
        </Banner>
      );
    case "running":
      return (
        <Banner tone="progress" icon="loader-circle" title="Đang thực thi các bước đã duyệt" live>
          Chỉ bản xem trước bạn đã duyệt được thực hiện. Huỷ sẽ dừng trước bước kế tiếp, không hoàn tác bước đã ghi.
        </Banner>
      );
    case "succeeded":
      return (
        <Banner tone="success" icon="circle-check" title="Hoàn tất">
          Mọi bước đã chạy xong và nơi nhận đã xác nhận các thao tác ghi.
        </Banner>
      );
    case "failed": {
      const failed = trace?.attempts.find((a) => a.error_message);
      return (
        <Banner tone="danger" icon="circle-x" title={failed ? `Thất bại: ${failed.error_message}` : "Lần chạy thất bại"}>
          {failed?.outcome_certainty === "known_not_applied"
            ? "Công cụ trả lỗi đã biết và xác nhận thao tác đó chưa được ghi. Hệ thống không tự thử lại."
            : "Hệ thống không tự thử lại. Xem chi tiết lỗi bên dưới."}
        </Banner>
      );
    }
    case "rejected":
      return (
        <Banner tone="neutral" icon="ban" title="Bạn đã từ chối ghi — không có thao tác ghi nào được thực hiện">
          Bản xem trước chỉ còn để xem lại.
        </Banner>
      );
    case "cancelled":
      return (
        <Banner tone="neutral" icon="circle-slash" title="Lần chạy đã huỷ">
          Các bước đã xong trước khi huỷ vẫn giữ nguyên; huỷ không hoàn tác thao tác đã ghi.
        </Banner>
      );
    case "expired":
      return (
        <Banner tone="neutral" icon="clock-alert" title="Thời hạn duyệt đã hết — không có thao tác ghi nào được thực hiện">
          Bản xem trước chỉ còn để xem lại. Muốn chạy, dùng lại yêu cầu này: hệ thống đọc lại dữ liệu và lập bản xem trước mới.
        </Banner>
      );
    case "refused":
      return (
        <Banner tone="planner" icon="message-circle-x" title="Hệ thống không lập được kế hoạch cho yêu cầu này">
          {planner?.kind === "refusal" ? `“${planner.reason}”` : null}
        </Banner>
      );
    case "needs_input":
      return (
        <Banner tone="planner" icon="message-circle-question" title="Hệ thống cần thêm thông tin trước khi lập kế hoạch">
          {planner?.kind === "clarification" ? `“${planner.question}”` : null}
        </Banner>
      );
    case "reconciliation_required": {
      const ops = reconciliation?.operations ?? [];
      if (ops.length > 0 && ops.every((op) => op.receipt === "confirmed")) {
        return (
          <Banner tone="success" icon="circle-check" title="Đã đối chiếu: thao tác ghi đã vào nơi nhận">
            Không cần ghi lại. Lần chạy vẫn mang trạng thái “Cần đối chiếu” vì lúc chạy máy chủ không nhận được xác nhận, và các bước sau đó đã không chạy.
          </Banner>
        );
      }
      const open = ops.filter((op) => op.receipt !== "confirmed").length;
      return (
        <Banner tone="unknown" icon="triangle-alert" title={open > 0 ? `Có ${open} thao tác ghi chưa rõ kết quả` : "Có thao tác ghi chưa rõ kết quả"}>
          Lệnh ghi đã được gửi nhưng máy chủ không nhận được xác nhận. Hệ thống không tự gửi lại để tránh ghi trùng.
        </Banner>
      );
    }
    default: {
      const exhaustive: never = run.status;
      return exhaustive;
    }
  }
}

function SummaryRail({
  run,
  trace,
  reconciliation,
  onEvidence,
}: {
  run: RunDetail;
  trace?: TracePage;
  reconciliation?: Reconciliation;
  onEvidence(): void;
}) {
  const { hints } = useApp();
  const view = runPresentation(run.status);
  const steps = stepViews(run, trace);
  const done = steps.filter((s) => s.state === "done").length;
  const unknown = steps.filter((s) => s.state === "unknown").length;
  const failed = steps.findIndex((s) => s.state === "failed");
  const openOps = reconciliation?.operations.filter((op) => op.receipt !== "confirmed") ?? [];
  const pendingWrites = (run.approval?.actions ?? [])
    .filter((action) => openOps.some((op) => op.operation_id === action.operation_id))
    .map((action) => summarizeAction(action));
  const plan = recoveryFor(run, {
    receipts: reconciliation ? reconciliation.operations.map((op) => op.receipt as ReceiptKind) : null,
    pendingWrites,
    suggestedPrompt: hints.suggestedPrompt(run.run_id),
  });

  const cells: Array<[string, string, string?]> = [];
  if (run.plan) {
    cells.push(["XONG", `${done} / ${steps.length} bước`]);
    if (unknown > 0) cells.push(["CHƯA RÕ", `${unknown} bước`, "text-unknown"]);
    else if (failed >= 0) cells.push(["THẤT BẠI", `Bước ${failed + 1}`, "text-danger"]);
    else cells.push(["ĐÃ GHI", run.status === "succeeded" ? `${planCounts(run).writes} thao tác` : "Chưa ghi gì"]);
  } else {
    cells.push(["KẾ HOẠCH", "Không có"], ["ĐÃ GHI", "Chưa ghi gì"]);
  }

  return (
    <section aria-label="Tóm tắt lần chạy" className="flex flex-col gap-5 rounded-md border border-hairline bg-canvas p-6 shadow-card">
      <div className="flex flex-col gap-1">
        <span className="text-body-md text-muted">Tóm tắt lần chạy</span>
        <span className="text-headline-sm">{view.label}</span>
        {run.created_at ? (
          <span className="tabular text-body-sm text-muted">Tạo lúc {formatDateTime(run.created_at, run.time_zone)}</span>
        ) : null}
      </div>
      <dl className="m-0 grid grid-cols-2 overflow-hidden rounded-sm border border-border-control">
        {cells.map(([label, value, tone], index) => (
          <div key={label} className={index % 2 === 0 ? "flex flex-col gap-0.5 border-r border-border-control px-3 py-2.5" : "flex flex-col gap-0.5 px-3 py-2.5"}>
            <dt className="text-overline">{label}</dt>
            <dd className={`m-0 text-body-md ${tone ? `font-semibold ${tone}` : ""}`}>{value}</dd>
          </div>
        ))}
        {reconciliation ? (
          <div className="col-span-2 flex flex-col gap-0.5 border-t border-border-control px-3 py-2.5">
            <dt className="text-overline">XÁC NHẬN KHI ĐỐI CHIẾU</dt>
            <dd className={`m-0 text-body-md font-semibold ${openOps.length > 0 ? "text-unknown" : "text-success"}`}>
              {reconciliation.operations.length - openOps.length} / {reconciliation.operations.length} thao tác
            </dd>
          </div>
        ) : null}
      </dl>

      {view.terminal ? <RecoveryActions plan={plan} /> : null}
      <Button variant="secondary" block onClick={onEvidence}>
        Xem chứng cứ
      </Button>

      <div className="flex flex-col gap-2.5 border-t border-hairline pt-4 text-body-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted">Múi giờ</span>
          <span>{run.time_zone}</span>
        </div>
        <TechDisclosure summary="Chi tiết kỹ thuật">
          <dl className="m-0 flex flex-col gap-1 font-mono text-mono-sm">
            <div>run_id: {run.run_id}</div>
            <div>workflow_version_id: {run.workflow_version_id ?? "—"}</div>
            <div>last_seq: {run.last_seq}</div>
          </dl>
        </TechDisclosure>
      </div>
      {!view.terminal ? <CancelControl run={run} /> : null}
    </section>
  );
}

/** V05 — one run: plan, what will be/was written, decision, recovery. */
export function RunView({ runId }: { runId: string }) {
  const { transport, generation, hints, controllers } = useApp();
  const runSync = controllers.getRunSync(runId);
  const traceController = controllers.getTrace(runId);

  useEffect(() => {
    runSync.start();
    return () => runSync.stop();
  }, [runSync]);

  const syncSnapshot = useSyncExternalStore(
    runSync.subscribe,
    runSync.getSnapshot,
    runSync.getSnapshot,
  );

  const traceSnapshot = useSyncExternalStore(
    traceController.subscribe,
    traceController.getSnapshot,
    traceController.getSnapshot,
  );

  const run = syncSnapshot.detail;
  const events = syncSnapshot.eventState.events;

  useEffect(() => {
    if (run) {
      void traceController.loadInitial();
    }
  }, [run?.run_id, traceController]);

  const reconciliation = useQuery({
    ...reconciliationQuery(transport, generation, runId),
    enabled: run?.status === "reconciliation_required",
  });
  const evidenceRef = useRef<HTMLElement>(null);

  const back = (
    <a
      href={routeToHash({ page: "history" })}
      aria-label="Quay lại Lần chạy"
      className="flex size-11 items-center justify-center rounded-full bg-surface-strong text-ink"
    >
      <Icon name="arrow-left" />
    </a>
  );

  if (!run) {
    if (syncSnapshot.error) {
      return (
        <>
          {back}
          <h1 className="m-0 text-display-md-mobile desk:text-display-md">Không mở được lần chạy</h1>
          <ErrorState
            title="Lần chạy không tồn tại hoặc không thuộc phiên này"
            error={syncSnapshot.error}
            onRetry={() => void runSync.refresh()}
          />
        </>
      );
    }
    return (
      <>
        {back}
        <LoadingState label="Đang tải lần chạy…" />
      </>
    );
  }

  const traceData: TracePage = {
    run_id: runId,
    attempts: traceSnapshot.attempts,
    next_cursor: traceSnapshot.nextCursor,
  };
  const counts = planCounts(run);
  const steps = stepViews(run, traceData);
  const writes = (run.approval?.actions ?? []).map((action) => ({ action, write: summarizeAction(action) }));
  const failedAttempt = traceSnapshot.attempts.find((a) => a.error_message);
  const suggestion = hints.suggestedPrompt(run.run_id);
  const showEvidence = (): void => {
    const node = evidenceRef.current;
    if (!node) return;
    node.querySelector("details")?.setAttribute("open", "");
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    node.focus();
  };

  return (
    <>
      {back}
      <div className="flex flex-col gap-2.5">
        <h1 className="m-0 max-w-215 text-display-md-mobile desk:text-display-md">{run.source_prompt ?? "Lần chạy"}</h1>
        <div className="flex flex-wrap items-center gap-2.5 text-body-sm text-muted">
          <StatusPill status={run.status} />
          {run.created_at ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular">Tạo lúc {formatDateTime(run.created_at, run.time_zone)}</span>
            </>
          ) : null}
          {run.plan ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {counts.steps} bước, {counts.writes} thao tác ghi
              </span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span className="font-mono text-mono-md">{shortId(run.run_id)}</span>
        </div>
      </div>

      <div className="mt-2 grid gap-10 desk:grid-run">
        <div className="flex min-w-0 flex-col">
          <StatusBanner run={run} trace={traceData} reconciliation={reconciliation.data} />

          {run.status === "reconciliation_required" ? (
            <ReconciliationSection run={run} trace={traceData} query={reconciliation} />
          ) : null}

          {run.status === "needs_input" ? (
            <Section title="Việc tiếp theo">
              <p className="m-0 max-w-measure text-body-lg">
                Lần chạy này đã kết thúc và không tạo kế hoạch nào, nên không có gì bị ghi. Hãy gửi lại yêu cầu có bổ sung thông tin còn thiếu.
              </p>
              {suggestion ? (
                <div className="flex flex-col gap-1.5 rounded-md bg-surface-soft px-4.5 py-4 text-body-lg">
                  <span className="text-body-sm text-muted">Câu gợi ý</span>
                  {suggestion}
                </div>
              ) : null}
            </Section>
          ) : null}

          {run.status === "refused" ? (
            <Section title="Vì sao">
              <p className="m-0 max-w-measure text-body-lg">
                Hệ thống chỉ dùng các công cụ local đã được duyệt: bảng tính, thẻ công việc, tin nhắn và tệp. Việc nằm ngoài các công cụ này sẽ bị từ chối thay vì đoán cách làm.
              </p>
              <a href={routeToHash({ page: "tools" })} className="inline-flex min-h-11 items-center self-start text-button-sm">
                Xem Công cụ &amp; kết nối
              </a>
            </Section>
          ) : null}

          {run.plan ? (
            <Section title={run.status === "awaiting_approval" ? `Kế hoạch gồm ${steps.length} bước` : "Kết quả từng bước"}>
              <StepList steps={steps} timeZone={run.time_zone} />
            </Section>
          ) : null}

          {writes.length > 0 && (run.status === "awaiting_approval" || run.status === "expired" || run.status === "rejected") ? (
            <Section title={run.status === "awaiting_approval" ? "Những gì sẽ được ghi" : "Bản xem trước (không được thực hiện)"}>
              {run.status === "awaiting_approval" ? (
                <p className="-mt-3 m-0 text-body-md text-muted">Đúng nội dung dưới đây sẽ được gửi đi. Không thể sửa trên giao diện.</p>
              ) : null}
              {writes.map(({ action, write }) => (
                <WriteCard key={action.operation_id} write={write} args={action.resolved_args} />
              ))}
            </Section>
          ) : null}

          {run.status === "failed" && failedAttempt ? (
            <Section title="Chi tiết lỗi">
              <dl className="m-0 flex flex-col">
                {[
                  ["Loại lỗi", failedAttempt.error_class ?? "—"],
                  ["Kết quả ghi", failedAttempt.outcome_certainty === "known_not_applied" ? "Chắc chắn chưa ghi" : "Chưa rõ"],
                  ["Thông điệp", failedAttempt.error_message ?? "—"],
                ].map(([label, value]) => (
                  <div key={label} className="grid gap-1 border-b border-hairline-soft py-3 desk:grid-cols-[200px_minmax(0,1fr)] desk:gap-4">
                    <dt className="text-body-md text-muted">{label}</dt>
                    <dd className="m-0 text-body-md">{value}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          ) : null}

          <section
            ref={evidenceRef}
            tabIndex={-1}
            aria-labelledby="evidence-title"
            className="flex flex-col gap-3 border-b border-hairline py-8 outline-none"
          >
            <h2 id="evidence-title" className="m-0 text-headline-sm">
              Chứng cứ
            </h2>
            <TechDisclosure summary={`${traceSnapshot.attempts.length} lần thử đã ghi nhận`}>
              <div className="flex flex-col gap-3">
                {traceSnapshot.attempts.length > 0 ? (
                  <JsonBlock value={traceSnapshot.attempts} />
                ) : traceSnapshot.isLoading ? (
                  <p className="m-0 text-body-sm text-muted">Đang tải chứng cứ…</p>
                ) : (
                  <p className="m-0 text-body-sm text-muted">Chưa có lần thử nào.</p>
                )}
                {traceSnapshot.hasMore ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="self-start"
                    disabled={traceSnapshot.isLoadingMore}
                    onClick={() => void traceController.loadMore()}
                  >
                    {traceSnapshot.isLoadingMore ? "Đang tải thêm…" : "Tải thêm chứng cứ"}
                  </Button>
                ) : null}
                {traceSnapshot.error ? (
                  <p className="m-0 text-body-sm text-danger">{traceSnapshot.error.message}</p>
                ) : null}
              </div>
            </TechDisclosure>
          </section>

          <Activity run={run} events={events} />
        </div>

        <aside className="flex flex-col gap-4 desk:sticky desk:top-6">
          {run.status === "awaiting_approval" && run.approval?.decision === "pending" ? (
            <DecisionCard run={run} />
          ) : (
            <SummaryRail run={run} trace={traceData} reconciliation={reconciliation.data} onEvidence={showEvidence} />
          )}
          {run.status === "awaiting_approval" ? (
            <p className="m-0 flex items-start gap-2 px-2 text-caption text-muted">
              <Icon name="shield-check" className="mt-0.5" />
              Nếu dữ liệu nguồn thay đổi, hãy tạo yêu cầu mới thay vì duyệt bản này.
            </p>
          ) : null}
        </aside>
      </div>
    </>
  );
}
