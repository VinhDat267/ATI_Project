import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useApp } from "../../context";
import { Banner } from "../../components/Banner";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { LoadingState, ErrorState } from "../../components/States";
import { StatusPill } from "../../components/StatusPill";
import { TechDisclosure } from "../../components/TechDisclosure";
import { routeToHash } from "../../../core/navigation.js";
import { shortId } from "../../../core/presentation.js";

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
          ? "bg-danger-subtle text-danger"
          : isUrgent
            ? "bg-action-subtle text-action animate-pulse"
            : "bg-surface-strong text-ink"
      }`}
    >
      <Icon name="clock-alert" size={16} />
      <span>
        {isExpired ? "Đã hết thời hạn duyệt" : `Thời gian duyệt còn lại: ${formatted}`}
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
        throw new Error("Hệ thống không hỗ trợ getPilotRun");
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
  const snapshotHash = run?.preview?.snapshotHash;
  const approvalId = run?.preview?.approvalId;
  const versionId = run?.preview?.versionId;
  const expiresAt = run?.preview?.expiresAt || run?.expiresAt;
  const isEffectivelyExpired =
    isExpired || (expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false);

  const handleDecision = async (decision: "approved" | "rejected") => {
    if (!snapshotHash || !approvalId || !versionId) {
      setDecisionError("Không tìm thấy approval hợp lệ để phê duyệt");
      return;
    }

    if (!transport.approvePilotRun) {
      setDecisionError("Hệ thống không hỗ trợ thao tác phê duyệt");
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
          approvalId,
          versionId,
          decision,
        },
        scope.signal,
      );

      await queryClient.invalidateQueries({ queryKey: ["pilot-run", runId] });
      await refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDecisionError(
        msg || "Không thể gửi quyết định phê duyệt. Vui lòng kiểm tra lại kết nối.",
      );
    } finally {
      scope.dispose();
      setSubmittingDecision(false);
    }
  };

  if (isLoading) {
    return <LoadingState label="Đang tải thông tin quy trình điều phối…" />;
  }

  if (error || !run) {
    return (
      <ErrorState
        error={error ?? new Error("Không tìm thấy thông tin lần chạy")}
        onRetry={() => void refetch()}
      />
    );
  }

  const primaryAction = run.preview?.actions?.[0];
  const cardTitle = String(
    primaryAction?.args?.title ?? primaryAction?.args?.name ?? "Không có tiêu đề",
  );
  const targetList = String(
    primaryAction?.args?.listName ?? primaryAction?.args?.idList ?? "To Do",
  );
  const dueDate = String(
    primaryAction?.args?.due ?? primaryAction?.args?.dueDate ?? "Chưa đặt hạn",
  );
  const assignee = String(
    primaryAction?.args?.idMembers ?? primaryAction?.args?.assignee ?? "Chưa chỉ định",
  );
  const cardDesc = primaryAction?.args?.desc || primaryAction?.args?.description;

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6 px-6 py-6 xl:px-0">
      {/* Top Header */}
      <div className="flex flex-col gap-4 border-b border-hairline pb-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-overline uppercase tracking-wider text-muted">
              Quy trình tự động · {shortId(effectiveRunId)}
            </span>
            <StatusPill status={run.status} />
          </div>
          <h1 className="m-0 text-display-md-mobile desk:text-display-md font-semibold text-ink">
            {run.sourceSnapshot?.rawRequest
              ? run.sourceSnapshot.rawRequest.slice(0, 90)
              : (run.sourceKey ? `Điều phối yêu cầu ${run.sourceKey}` : `Điều phối yêu cầu ${shortId(effectiveRunId)}`)}
          </h1>
          <span className="text-caption text-muted">Mã định danh: {effectiveRunId}</span>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={routeToHash({ page: "pilot-new" })}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-hairline bg-surface-soft px-4 text-button-sm text-ink no-underline shadow-card transition-all hover:border-ink hover:shadow-lg"
          >
            <Icon name="plus" size={16} />
            <span>Tạo yêu cầu mới</span>
          </a>
        </div>
      </div>

      {decisionError ? (
        <Banner tone="danger" icon="circle-x" title="Lỗi gửi quyết định">
          {decisionError}
        </Banner>
      ) : null}

      {/* Transient Processing Indicator */}
      {["planning", "validating", "dry_running", "running", "replanning"].includes(run.status) ? (
        <div className="flex items-center gap-3.5 rounded-md border border-hairline bg-surface-soft p-5 shadow-card">
          <Icon name="loader-circle" className="animate-spin text-primary" size={24} />
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-body-md text-ink">Hệ thống đang chuẩn bị kế hoạch…</span>
            <span className="text-caption text-muted">Dữ liệu đang được tự động đồng bộ và cập nhật mỗi 2 giây.</span>
          </div>
        </div>
      ) : null}

      {/* BRANCH 1: Awaiting Approval (UC2) */}
      {run.status === "awaiting_approval" && run.preview ? (
        <section
          aria-label="Cổng phê duyệt kế hoạch"
          className="flex flex-col gap-5 rounded-md border-2 border-action/70 bg-surface-soft p-6 shadow-card"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5 text-action font-semibold text-headline-sm-mobile desk:text-headline-sm">
              <Icon name="hand" size={22} />
              <span>Kế hoạch đề xuất: Tạo thẻ công việc trên Trello</span>
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

          <p className="m-0 text-body-md text-muted max-w-measure">
            Hệ thống đã đọc dữ liệu từ Google Sheets, xác thực đầy đủ các điều kiện nghiệp vụ và chuẩn bị kế hoạch với đúng <strong>1 thẻ mới trên Trello</strong>. Vui lòng kiểm tra nội dung trước khi bấm phê duyệt.
          </p>

          {/* Action Card Preview */}
          <div className="flex flex-col gap-4 rounded-sm border border-hairline bg-canvas p-5">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <span className="text-overline uppercase tracking-wider text-muted font-semibold">
                Thao tác thực hiện: Tạo thẻ công việc
              </span>
              <span className="rounded-full bg-success-subtle px-2.5 py-0.5 text-overline font-semibold text-success">
                Đúng 1 thao tác tạo mới
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-body-md">
              <div className="flex flex-col gap-1">
                <span className="text-caption text-muted font-medium">Tên công việc:</span>
                <p className="m-0 font-semibold text-ink text-title-md">
                  {cardTitle}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-caption text-muted font-medium">Cột danh sách Trello:</span>
                <p className="m-0 font-semibold text-ink">
                  {targetList}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-caption text-muted font-medium">Thời hạn hoàn thành:</span>
                <p className="m-0 font-semibold text-ink">
                  {dueDate}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-caption text-muted font-medium">Người phụ trách:</span>
                <p className="m-0 font-semibold text-ink">
                  {assignee}
                </p>
              </div>
            </div>

            {cardDesc ? (
              <div className="border-t border-hairline pt-3 flex flex-col gap-1">
                <span className="text-caption text-muted font-medium">Mô tả nội dung thẻ:</span>
                <div className="rounded-sm bg-surface-soft p-3.5 text-body-sm text-ink whitespace-pre-wrap border border-hairline">
                  {String(cardDesc)}
                </div>
              </div>
            ) : null}
          </div>

          {/* Approval Controls */}
          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              disabled={submittingDecision}
              onClick={() => handleDecision("rejected")}
            >
              <Icon name="ban" />
              <span>Từ chối thực hiện</span>
            </Button>
            <Button
              variant="primary"
              disabled={submittingDecision || isEffectivelyExpired}
              onClick={() => handleDecision("approved")}
              className="h-12 px-6"
            >
              {submittingDecision ? (
                <>
                  <Icon name="loader-circle" className="animate-spin" />
                  <span>Đang xử lý tạo thẻ…</span>
                </>
              ) : (
                <>
                  <Icon name="circle-check" />
                  <span>Phê duyệt &amp; Tạo thẻ ngay</span>
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
          title="Cần bổ sung thêm thông tin trước khi thực hiện"
        >
          <div className="flex flex-col gap-3">
            {run.clarificationQuestion ? (
              <div className="rounded-sm bg-canvas p-4 font-semibold text-ink border border-planner/30">
                {run.clarificationQuestion}
              </div>
            ) : null}
            <p className="m-0 text-body-md">
              Hệ thống phát hiện dữ liệu yêu cầu từ Google Sheets chưa đủ điều kiện để tạo thẻ tự động:
            </p>
            {run.checklistResult?.missingFields &&
            run.checklistResult.missingFields.length > 0 ? (
              <ul className="m-0 pl-5 text-body-sm font-semibold text-ink">
                {run.checklistResult.missingFields.map((field) => (
                  <li key={field}>
                    Thông tin còn thiếu: {field === "due_date" ? "Thời hạn hoàn thành" : field === "dimensions" ? "Thông số kích thước" : field === "target_url" ? "Đường dẫn trang web" : field}
                  </li>
                ))}
              </ul>
            ) : null}
            {run.checklistResult?.summary ? (
              <p className="m-0 text-caption text-muted">
                Chi tiết: {run.checklistResult.summary}
              </p>
            ) : null}
            <div className="pt-2">
              <a
                href={routeToHash({ page: "pilot-new" })}
                className="inline-flex h-11 items-center gap-1.5 rounded-sm bg-surface-soft px-4 text-button-sm text-ink no-underline border border-hairline hover:border-ink"
              >
                <Icon name="refresh-cw" size={16} />
                <span>Bổ sung thông tin &amp; gửi lại</span>
              </a>
            </div>
          </div>
        </Banner>
      ) : null}

      {/* BRANCH 3: Refused (UC1 Refusal) */}
      {run.status === "refused" ? (
        <Banner
          tone="danger"
          icon="ban"
          title="Không thể lập kế hoạch thực hiện"
        >
          <div className="flex flex-col gap-2">
            {run.refusalReason ? (
              <div className="rounded-sm bg-canvas p-4 font-semibold text-danger border border-danger/30">
                {run.refusalReason}
              </div>
            ) : null}
            <p className="m-0 text-body-md">
              Yêu cầu không thể thực thi tự động do thiếu mã định danh hợp lệ, chỉ thị công việc chưa được hỗ trợ hoặc vi phạm quy tắc an toàn.
            </p>
            {run.checklistResult?.summary ? (
              <p className="m-0 text-caption text-muted">
                Chi tiết: {run.checklistResult.summary}
              </p>
            ) : null}
            <div className="pt-2">
              <a
                href={routeToHash({ page: "pilot-new" })}
                className="inline-flex h-11 items-center gap-1.5 rounded-sm bg-surface-soft px-4 text-button-sm text-ink no-underline border border-hairline hover:border-ink"
              >
                <span>Thử lại với yêu cầu khác</span>
              </a>
            </div>
          </div>
        </Banner>
      ) : null}

      {/* BRANCH 4: Succeeded & Receipt */}
      {run.status === "succeeded" && run.receipt ? (
        <section
          aria-label="Xác nhận hoàn thành"
          className="flex flex-col gap-4 rounded-md border border-success/30 bg-surface-soft p-6 shadow-card"
        >
          <div className="flex items-center gap-2.5 text-success font-semibold text-headline-sm-mobile desk:text-headline-sm">
            <Icon name="circle-check" size={24} />
            <span>Đã tạo thẻ công việc thành công trên Trello</span>
          </div>

          <div className="flex flex-col gap-3 rounded-sm border border-hairline bg-canvas p-5 text-body-md">
            {run.receipt.title ? (
              <div className="flex items-center justify-between border-b border-hairline pb-2.5">
                <span className="text-muted">Tên thẻ:</span>
                <span className="font-semibold text-ink">
                  {run.receipt.title}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between border-b border-hairline pb-2.5">
              <span className="text-muted">Mã thẻ Trello:</span>
              <span className="font-mono font-semibold text-ink">
                {run.receipt.cardId}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Thời điểm xác nhận:</span>
              <span className="text-ink">
                {run.receipt.confirmedAt
                  ? new Date(run.receipt.confirmedAt).toLocaleString("vi-VN")
                  : (run.endedAt ? new Date(run.endedAt).toLocaleString("vi-VN") : "Đã xác nhận")}
              </span>
            </div>

            {(run.receipt.url || run.receipt.cardUrl) ? (
              <div className="pt-4 border-t border-hairline flex justify-end">
                <a
                  href={run.receipt.url || run.receipt.cardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center gap-2 rounded-sm bg-primary px-5 text-button-sm text-on-primary no-underline hover:bg-primary-hover shadow-card"
                >
                  <span>Mở thẻ trên Trello</span>
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
            Yêu cầu tra cứu đã hoàn thành thành công. Không có thao tác ghi dữ liệu nào phát sinh trên hệ thống đích.
          </p>
        </Banner>
      ) : null}

      {/* BRANCH 5: Reconciliation Required (Safe Fail-Closed) */}
      {run.status === "reconciliation_required" ? (
        <Banner
          tone="unknown"
          icon="triangle-alert"
          title="Cần đối chiếu kết quả trên Trello"
        >
          <div className="flex flex-col gap-2">
            <p className="m-0 text-body-md">
              Đã xảy ra sự cố mạng hoặc thời gian chờ sau khi gửi yêu cầu tạo thẻ đến Trello.
            </p>
            <p className="m-0 text-body-sm text-muted">
              Để bảo vệ bạn khỏi nguy cơ tạo trùng lặp thẻ công việc, hệ thống <strong>không tự động thử lại</strong>. Vui lòng mở bảng Trello của bạn để kiểm tra xem thẻ đã xuất hiện hay chưa.
            </p>
          </div>
        </Banner>
      ) : null}

      {/* BRANCH 6: Expired */}
      {run.status === "expired" ? (
        <Banner
          tone="neutral"
          icon="clock-alert"
          title="Kế hoạch đã hết thời hạn duyệt"
        >
          <p className="m-0 text-body-md">
            Bản xem trước có hiệu lực trong vòng 10 phút. Quá thời hạn này, hệ thống tự động khóa kế hoạch để bảo đảm dữ liệu không bị sai lệch so với Google Sheets.
          </p>
        </Banner>
      ) : null}

      {/* BRANCH 7: Rejected */}
      {run.status === "rejected" ? (
        <Banner tone="neutral" icon="ban" title="Đã từ chối thực hiện">
          <p className="m-0 text-body-md">
            Bạn đã từ chối bản xem trước này. Không có thao tác nào được thực hiện trên Trello.
          </p>
        </Banner>
      ) : null}

      {/* BRANCH 8: Failed */}
      {run.status === "failed" ? (
        <Banner tone="danger" icon="circle-x" title="Quy trình gặp sự cố">
          <div className="flex flex-col gap-2">
            <p className="m-0 text-body-md">
              {run.error ?? "Đã xảy ra sự cố trong quá trình thực thi."}
            </p>
            <div className="pt-2">
              <a
                href={routeToHash({ page: "pilot-new" })}
                className="inline-flex h-11 items-center gap-1.5 rounded-sm bg-surface-soft px-4 text-button-sm text-ink no-underline border border-hairline hover:border-ink"
              >
                <span>Thử lại với yêu cầu mới</span>
              </a>
            </div>
          </div>
        </Banner>
      ) : null}

      {/* Technical Metadata & Audit Section (Wrapped cleanly in TechDisclosure) */}
      <TechDisclosure
        summary="Thông tin nguồn &amp; Chi phí AI"
        hint="Chi tiết kỹ thuật"
        className="rounded-md border border-hairline bg-surface-soft p-4 shadow-card"
      >
        <div className="grid grid-cols-1 gap-6 pt-3 md:grid-cols-2">
          {/* Source Snapshot */}
          {run.sourceSnapshot ? (
            <div className="flex flex-col gap-2 rounded-sm border border-hairline bg-canvas p-4">
              <h3 className="m-0 text-title-md font-semibold text-ink">
                Dữ liệu Google Sheets
              </h3>
              <div className="flex flex-col gap-2 text-body-sm">
                <div className="flex justify-between border-b border-hairline pb-1.5">
                  <span className="text-muted">Mã yêu cầu:</span>
                  <span className="font-semibold">{run.sourceSnapshot.requestId}</span>
                </div>
                <div className="flex justify-between border-b border-hairline pb-1.5">
                  <span className="text-muted">Khách hàng:</span>
                  <span>{run.sourceSnapshot.clientRef ?? "Chưa có"}</span>
                </div>
                <div className="flex justify-between border-b border-hairline pb-1.5">
                  <span className="text-muted">Loại yêu cầu:</span>
                  <span className="font-mono text-primary font-medium">
                    {run.sourceSnapshot.requestType ?? "N/A"}
                  </span>
                </div>
                <div className="flex justify-between border-b border-hairline pb-1.5">
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
            <div className="flex flex-col gap-2 rounded-sm border border-hairline bg-canvas p-4">
              <h3 className="m-0 text-title-md font-semibold text-ink">
                Chi phí Token AI
              </h3>
              <div className="flex flex-col gap-2 text-body-sm">
                <div className="flex justify-between border-b border-hairline pb-1.5">
                  <span className="text-muted">Token đầu vào:</span>
                  <span className="font-mono">{run.accounting.inputTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-b border-hairline pb-1.5">
                  <span className="text-muted">Token đầu ra:</span>
                  <span className="font-mono">{run.accounting.outputTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-b border-hairline pb-1.5">
                  <span className="text-muted">Tổng token:</span>
                  <span className="font-mono font-medium">
                    {(run.accounting.inputTokens + run.accounting.outputTokens).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between pt-1 font-semibold">
                  <span className="text-ink">Chi phí ước tính:</span>
                  <span className="text-action font-mono">
                    ${(run.accounting.costMicroUsd / 1_000_000).toFixed(6)} USD
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </TechDisclosure>
    </div>
  );
}
