import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useApp } from "../../context";
import { Banner } from "../../components/Banner";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { LoadingState, ErrorState } from "../../components/States";
import { StatusPill } from "../../components/StatusPill";
import { routeToHash } from "../../../core/navigation.js";
import { shortId } from "../../../core/presentation.js";
import type { PilotRunDetailResponse } from "../../../core/pilot-contracts.js";

function CountdownTimer({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
      if (diff <= 0) {
        setSecondsLeft(0);
        clearInterval(timer);
        onExpired();
      } else {
        setSecondsLeft(diff);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, onExpired]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const formatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const isUrgent = secondsLeft < 120 && secondsLeft > 0;
  const isExpired = secondsLeft === 0;

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-body-sm font-semibold ${
        isExpired
          ? "bg-red-100 text-red-700"
          : isUrgent
            ? "bg-amber-100 text-amber-800 animate-pulse"
            : "bg-blue-50 text-blue-700"
      }`}
    >
      <Icon name="clock-alert" size={16} />
      <span>
        {isExpired ? "Hết hạn phê duyệt" : `Thời gian duyệt còn lại: ${formatted}`}
      </span>
    </div>
  );
}

export function PilotRunView({ runId }: { runId: string }) {
  const { transport, session } = useApp();
  const queryClient = useQueryClient();

  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  const {
    data: run,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["pilot-run", runId],
    queryFn: async ({ signal }) => {
      if (!transport.getPilotRun) {
        throw new Error("Transport không hỗ trợ getPilotRun");
      }
      return transport.getPilotRun(runId, signal);
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const transientStatuses = [
        "planning",
        "validating",
        "dry_running",
        "running",
        "replanning",
      ];
      if (status && transientStatuses.includes(status)) {
        return 2000;
      }
      return false;
    },
  });

  const effectiveRunId = run?.id || run?.runId || runId;
  const snapshotHash =
    run?.preview?.snapshotHash || run?.sourceRevision || run?.snapshotHash;
  const expiresAt = run?.preview?.expiresAt || run?.expiresAt;
  const isEffectivelyExpired =
    isExpired || (expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false);

  const handleDecision = async (decision: "approved" | "rejected") => {
    if (!snapshotHash) {
      setDecisionError("Không tìm thấy mã băm snapshot để xác thực phê duyệt");
      return;
    }

    if (!transport.approvePilotRun) {
      setDecisionError("Transport không hỗ trợ approvePilotRun");
      return;
    }

    setSubmittingDecision(true);
    setDecisionError(null);

    const scope = session.beginRequest();
    try {
      await transport.approvePilotRun(
        effectiveRunId,
        {
          snapshotHash,
          decision,
        },
        scope.signal,
      );

      // Cập nhật lại cache query
      await queryClient.invalidateQueries({ queryKey: ["pilot-run", runId] });
      await refetch();
    } catch (err: any) {
      setDecisionError(
        err?.message ||
          "Không thể gửi quyết định phê duyệt. Vui lòng kiểm tra lại kết nối và trạng thái lần chạy.",
      );
    } finally {
      scope.dispose();
      setSubmittingDecision(false);
    }
  };


  if (isLoading) {
    return <LoadingState label="Đang tải thông tin lần chạy Pilot..." />;
  }

  if (error || !run) {
    return (
      <ErrorState
        title="Không thể tải lần chạy Pilot"
        error={error ?? new Error("Lần chạy không tồn tại")}
      />
    );
  }


  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-8 px-6 py-8 xl:px-0">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-hairline pb-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-overline uppercase tracking-wider text-muted">
              Pilot Run · {shortId(effectiveRunId)}
            </span>
            <StatusPill status={run.status} />
          </div>
          <h1 className="m-0 text-headline-sm font-bold text-ink">
            {run.sourceSnapshot?.rawRequest
              ? run.sourceSnapshot.rawRequest.slice(0, 80)
              : (run.sourceKey ? `Yêu cầu điều phối ${run.sourceKey}` : `Yêu cầu điều phối ${shortId(effectiveRunId)}`)}
          </h1>
          <span className="text-caption text-muted">ID: {effectiveRunId}</span>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={routeToHash({ page: "pilot-new" })}
            className="inline-flex h-11 items-center gap-1.5 rounded-sm border border-hairline bg-canvas px-4 text-button-sm text-ink no-underline hover:bg-surface-soft"
          >
            <Icon name="refresh-cw" size={16} />
            Tạo yêu cầu mới
          </a>
        </div>
      </div>

      {decisionError ? (
        <Banner tone="danger" icon="circle-x" title="Lỗi phê duyệt">
          {decisionError}
        </Banner>
      ) : null}

      {/* Transient Processing Indicator */}
      {["planning", "validating", "dry_running", "running", "replanning"].includes(run.status) ? (
        <div className="flex items-center gap-3 rounded-md border border-hairline bg-surface-soft p-5">
          <Icon name="loader-circle" className="animate-spin text-primary" size={24} />
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-body-sm text-ink">Hệ thống đang xử lý yêu cầu...</span>
            <span className="text-caption text-muted">Dữ liệu đang được tự động cập nhật mỗi 2 giây.</span>
          </div>
        </div>
      ) : null}

      {/* BRANCH 1: Awaiting Approval (UC2) */}
      {run.status === "awaiting_approval" && run.preview ? (
        <section className="flex flex-col gap-6 rounded-md border-2 border-primary/30 bg-canvas p-6 shadow-card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-primary font-semibold text-title-md">
              <Icon name="hand" />
              <span>Bản xem trước kế hoạch tạo thẻ Trello (Awaiting Approval)</span>
            </div>
            {expiresAt ? (
              <CountdownTimer
                expiresAt={expiresAt}
                onExpired={() => {
                  setIsExpired(true);
                  void refetch();
                }}
              />
            ) : null}
          </div>

          <p className="m-0 text-body-md text-muted">
            Hệ thống đã đọc dữ liệu từ Google Sheets, xác thực checklist nghiệp vụ
            và AI đã chuẩn bị kế hoạch với đúng <strong>1 thao tác ghi duy nhất</strong>.
            Vui lòng kiểm tra thông tin dưới đây trước khi duyệt.
          </p>

          {/* Action Card Preview */}
          <div className="flex flex-col gap-3 rounded-sm border border-hairline bg-surface-soft p-5">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <span className="font-semibold text-body-sm text-ink">
                Hành động:{" "}
                <code className="text-primary">
                  {run.preview.actions[0]?.tool ?? "trello.create_card"}
                </code>
              </span>
              <span className="rounded bg-green-100 px-2 py-0.5 text-overline font-medium text-green-800">
                1 Remote Write
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-body-sm">
              <div>
                <span className="text-muted">Tiêu đề thẻ (Card Title):</span>
                <p className="m-0 font-semibold text-ink">
                  {String(run.preview.actions[0]?.args?.title ?? run.preview.actions[0]?.args?.name ?? "Không có tiêu đề")}
                </p>
              </div>
              <div>
                <span className="text-muted">Danh sách đích (Target List):</span>
                <p className="m-0 font-semibold text-ink">
                  {String(run.preview.actions[0]?.args?.listName ?? run.preview.actions[0]?.args?.idList ?? "To Do")}
                </p>
              </div>
              <div>
                <span className="text-muted">Hạn chót (Due Date):</span>
                <p className="m-0 font-semibold text-ink">
                  {String(run.preview.actions[0]?.args?.due ?? run.preview.actions[0]?.args?.dueDate ?? "Chưa đặt")}
                </p>
              </div>
              <div>
                <span className="text-muted">Người nhận (Assignee):</span>
                <p className="m-0 font-semibold text-ink">
                  {String(run.preview.actions[0]?.args?.idMembers ?? run.preview.actions[0]?.args?.assignee ?? "Chưa chỉ định")}
                </p>
              </div>
            </div>

            {(run.preview.actions[0]?.args?.desc || run.preview.actions[0]?.args?.description) ? (
              <div className="mt-2 border-t border-hairline pt-3 text-body-sm">
                <span className="text-muted">Mô tả chi tiết thẻ:</span>
                <div className="mt-1 whitespace-pre-wrap rounded bg-canvas p-3 font-mono text-caption text-ink">
                  {String(run.preview.actions[0]?.args?.desc ?? run.preview.actions[0]?.args?.description)}
                </div>
              </div>
            ) : null}
          </div>

          {/* Approval Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end pt-2">
            <Button
              variant="secondary"
              disabled={submittingDecision}
              onClick={() => handleDecision("rejected")}
            >
              <Icon name="ban" />
              Từ chối kế hoạch (Reject)
            </Button>
            <Button
              variant="primary"
              disabled={submittingDecision || isEffectivelyExpired}
              onClick={() => handleDecision("approved")}
            >
              {submittingDecision ? (
                <>
                  <Icon name="loader-circle" className="animate-spin" />
                  Đang xử lý tạo thẻ...
                </>
              ) : (
                <>
                  <Icon name="circle-check" />
                  Phê duyệt & Tạo thẻ Trello (Approve)
                </>
              )}
            </Button>
          </div>
        </section>
      ) : null}


      {/* BRANCH 2: Needs Input (UC1 Clarification) */}
      {run.status === "needs_input" ? (
        <Banner
          tone="planner"
          icon="message-circle-question"
          title="Yêu cầu cần làm rõ / Bổ sung thông tin (Checklist Needs Input)"
        >
          <div className="flex flex-col gap-2">
            {run.clarificationQuestion ? (
              <div className="rounded bg-canvas p-3 font-semibold text-ink border border-primary/20">
                {run.clarificationQuestion}
              </div>
            ) : null}
            <p className="m-0 text-body-md">
              Checklist nghiệp vụ phát hiện dữ liệu intake chưa đủ điều kiện để AI
              lập kế hoạch tự động:
            </p>
            {run.checklistResult?.missingFields &&
            run.checklistResult.missingFields.length > 0 ? (
              <ul className="m-0 pl-5 text-body-sm font-semibold text-ink">
                {run.checklistResult.missingFields.map((field) => (
                  <li key={field}>Trường thiếu thông tin: {field}</li>
                ))}
              </ul>
            ) : null}
            {run.checklistResult?.summary ? (
              <p className="m-0 text-caption text-muted">
                {run.checklistResult.summary}
              </p>
            ) : null}
            <div className="pt-2">
              <a
                href={routeToHash({ page: "pilot-new" })}
                className="inline-flex h-10 items-center rounded-sm bg-surface-soft px-3 text-button-sm text-ink no-underline hover:bg-surface-strong"
              >
                Chỉnh sửa và gửi lại yêu cầu
              </a>
            </div>
          </div>
        </Banner>
      ) : null}

      {/* BRANCH 3: Refused (UC1 Refusal) */}
      {run.status === "refused" ? (
        <Banner
          tone="danger"
          icon="message-circle-x"
          title="Hệ thống từ chối lập kế hoạch (Refusal)"
        >
          <div className="flex flex-col gap-2">
            {run.refusalReason ? (
              <div className="rounded bg-canvas p-3 font-semibold text-danger border border-danger/20">
                {run.refusalReason}
              </div>
            ) : null}
            <p className="m-0 text-body-md">
              Yêu cầu không thể thực thi tự động do không hợp lệ, thiếu Request ID,
              chứa chỉ thị không được hỗ trợ hoặc vi phạm chính sách kiểm soát.
            </p>
            {run.checklistResult?.summary ? (
              <p className="m-0 mt-2 text-caption text-muted">
                Chi tiết: {run.checklistResult.summary}
              </p>
            ) : null}
          </div>
        </Banner>
      ) : null}

      {/* BRANCH 4: Succeeded & Receipt */}
      {run.status === "succeeded" && run.receipt ? (
        <section className="flex flex-col gap-4 rounded-md border border-green-300 bg-green-50/40 p-6 shadow-card">
          <div className="flex items-center gap-2 text-green-800 font-semibold text-title-md">
            <Icon name="circle-check" size={22} />
            <span>Đã tạo thẻ Trello thành công (Confirmed Receipt)</span>
          </div>

          <div className="flex flex-col gap-2 rounded-sm border border-green-200 bg-canvas p-4 text-body-sm">
            {run.receipt.title ? (
              <div className="flex items-center justify-between">
                <span className="text-muted">Tiêu đề thẻ:</span>
                <span className="font-semibold text-ink">
                  {run.receipt.title}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <span className="text-muted">Mã thẻ Trello (Card ID):</span>
              <span className="font-mono font-semibold text-ink">
                {run.receipt.cardId}
              </span>
            </div>
            {run.receipt.intentKey ? (
              <div className="flex items-center justify-between">
                <span className="text-muted">Mã Intent Key:</span>
                <span className="font-mono text-ink">
                  {run.receipt.intentKey}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <span className="text-muted">Thời điểm xác nhận:</span>
              <span className="text-ink">
                {run.receipt.confirmedAt
                  ? new Date(run.receipt.confirmedAt).toLocaleString("vi-VN")
                  : (run.endedAt ? new Date(run.endedAt).toLocaleString("vi-VN") : "Đã xác nhận")}
              </span>
            </div>
            {(run.receipt.url || run.receipt.cardUrl) ? (
              <div className="pt-3 border-t border-hairline flex justify-end">
                <a
                  href={run.receipt.url || run.receipt.cardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center gap-2 rounded-sm bg-primary px-4 text-button-sm text-on-primary no-underline hover:bg-primary-hover"
                >
                  Mở thẻ trên Trello
                  <Icon name="arrow-right" size={16} />
                </a>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* BRANCH 4b: Succeeded Read-Only (0 writes) */}
      {run.status === "succeeded" && !run.receipt ? (
        <Banner tone="success" icon="circle-check" title="Thực thi hoàn tất">
          <p className="m-0 text-body-md">
            Yêu cầu đã được thực thi thành công. Không có thao tác ghi dữ liệu phát sinh (0 remote writes).
          </p>
        </Banner>
      ) : null}

      {/* BRANCH 5: Reconciliation Required (Safe Fail-Closed) */}
      {run.status === "reconciliation_required" ? (
        <Banner
          tone="unknown"
          icon="triangle-alert"
          title="Cần đối chiếu an toàn (Reconciliation Required)"
        >
          <div className="flex flex-col gap-2">
            <p className="m-0 text-body-md">
              Đã xảy ra sự cố mạng hoặc timeout sau khi gửi lệnh tạo thẻ đến
              Trello. Trạng thái đặt trước được chuyển sang <strong>unknown</strong>.
            </p>
            <p className="m-0 text-body-sm text-muted">
              Để bảo vệ bạn khỏi nguy cơ tạo trùng lặp nhiều thẻ cho cùng một yêu
              cầu, hệ thống <strong>tuyệt đối không tự động thử lại (Zero Blind Retry)</strong>.
              Vui lòng mở bảng Trello của bạn để kiểm tra xem thẻ đã xuất hiện hay chưa.
            </p>
          </div>
        </Banner>
      ) : null}

      {/* BRANCH 6: Expired */}
      {run.status === "expired" ? (
        <Banner
          tone="neutral"
          icon="clock-alert"
          title="Lần chạy đã hết hạn duyệt (Approval Expired)"
        >
          <p className="m-0 text-body-md">
            Kế hoạch xem trước chỉ có hiệu lực trong vòng 10 phút Server TTL. Quá
            thời hạn này, hệ thống tự động khóa kế hoạch để bảo đảm dữ liệu không bị
            sai lệch so với Google Sheets.
          </p>
        </Banner>
      ) : null}

      {/* BRANCH 7: Rejected */}
      {run.status === "rejected" ? (
        <Banner tone="neutral" icon="ban" title="Đã từ chối kế hoạch">
          <p className="m-0 text-body-md">
            Người vận hành đã từ chối bản xem trước. Không có thao tác ghi nào được
            thực hiện trên Trello.
          </p>
        </Banner>
      ) : null}

      {/* BRANCH 8: Failed */}
      {run.status === "failed" ? (
        <Banner tone="danger" icon="circle-x" title="Lần chạy thất bại">
          <div className="flex flex-col gap-2">
            <p className="m-0 text-body-md">
              {run.error ?? "Đã xảy ra sự cố trong quá trình thực thi lần chạy."}
            </p>
            <div className="pt-2">
              <a
                href={routeToHash({ page: "pilot-new" })}
                className="inline-flex h-10 items-center rounded-sm bg-surface-soft px-3 text-button-sm text-ink no-underline hover:bg-surface-strong"
              >
                Thử lại với yêu cầu mới
              </a>
            </div>
          </div>
        </Banner>
      ) : null}


      {/* Metadata Accordion / Tech Details */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Source Snapshot */}
        {run.sourceSnapshot ? (
          <div className="flex flex-col gap-3 rounded-md border border-hairline bg-canvas p-5">
            <h3 className="m-0 text-title-sm font-semibold text-ink">
              Dữ liệu nguồn (Google Sheets Intake)
            </h3>
            <div className="flex flex-col gap-2 text-body-sm">
              <div className="flex justify-between">
                <span className="text-muted">Mã yêu cầu:</span>
                <span className="font-semibold">{run.sourceSnapshot.requestId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Khách hàng:</span>
                <span>{run.sourceSnapshot.clientRef ?? "Chưa có"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Loại yêu cầu:</span>
                <span className="font-mono text-primary">
                  {run.sourceSnapshot.requestType ?? "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Hạn hoàn thành:</span>
                <span>{run.sourceSnapshot.dueDate ?? "Chưa có"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Trạng thái duyệt:</span>
                <span>{run.sourceSnapshot.decisionStatus ?? "Chưa có"}</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* AI Model Accounting */}
        {run.accounting ? (
          <div className="flex flex-col gap-3 rounded-md border border-hairline bg-canvas p-5">
            <h3 className="m-0 text-title-sm font-semibold text-ink">
              Hạch toán Chi phí AI (AI Token Accounting)
            </h3>
            <div className="flex flex-col gap-2 text-body-sm">
              <div className="flex justify-between">
                <span className="text-muted">Input Tokens:</span>
                <span className="font-mono">{run.accounting.inputTokens}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Output Tokens:</span>
                <span className="font-mono">{run.accounting.outputTokens}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Tổng token:</span>
                <span className="font-mono">
                  {run.accounting.inputTokens + run.accounting.outputTokens}
                </span>
              </div>
              <div className="flex justify-between border-t border-hairline pt-2 font-semibold">
                <span className="text-ink">Chi phí ước tính:</span>
                <span className="text-primary font-mono">
                  ${(run.accounting.costMicroUsd / 1_000_000).toFixed(6)} USD
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
