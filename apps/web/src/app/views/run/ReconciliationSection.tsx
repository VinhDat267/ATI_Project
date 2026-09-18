import type { UseQueryResult } from "@tanstack/react-query";
import type { Reconciliation, RunDetail, TracePage } from "../../../core/contracts.js";
import { formatClock } from "../../../core/presentation.js";
import { summarizeAction } from "../../../core/writes.js";
import { cn } from "@/lib/cn";
import { Button } from "../../components/Button";
import { Icon, type IconName } from "../../components/Icon";
import { ErrorState, LoadingState } from "../../components/States";
import { JsonBlock, TechDisclosure } from "../../components/TechDisclosure";
import { WritePayload } from "./WriteCard";

type Receipt = Reconciliation["operations"][number]["receipt"];

const RECEIPT: Record<Receipt, { line: string; label: string; icon: IconName; tone: string; how: string[] }> = {
  confirmed: {
    line: "Nơi nhận xác nhận đã ghi — không cần ghi lại",
    label: "Đã xác nhận",
    icon: "circle-check",
    tone: "bg-success-subtle text-success",
    how: [],
  },
  not_observed: {
    line: "Chưa thấy trên nơi nhận — kiểm tra bảng đích trước khi tạo lại",
    label: "Chưa thấy",
    icon: "triangle-alert",
    tone: "bg-unknown-subtle text-unknown",
    how: [
      "Mở nơi nhận và tìm đúng nội dung như bảng trên.",
      "Trả lời “Đã thấy” hoặc “Không thấy” ở phần Tóm tắt lần chạy. Hệ thống điền sẵn yêu cầu mới theo câu trả lời.",
    ],
  },
  conflict: {
    line: "Nơi nhận có dữ liệu khác với nội dung đã gửi — kiểm tra thủ công",
    label: "Không khớp",
    icon: "circle-x",
    tone: "bg-danger-subtle text-danger",
    how: [
      "Hệ thống chỉ giữ nội dung đã gửi, không có bản sao dữ liệu hiện tại ở nơi nhận.",
      "Mở nơi nhận, so từng dòng với bảng trên, rồi trả lời câu hỏi ở phần Tóm tắt lần chạy.",
    ],
  },
  not_supported: {
    line: "Nơi nhận không hỗ trợ đối chiếu tự động — cần tự kiểm tra",
    label: "Không hỗ trợ",
    icon: "triangle-alert",
    tone: "bg-unknown-subtle text-unknown",
    how: [
      "Mở nơi nhận và tìm đúng nội dung như bảng trên.",
      "Trả lời “Đã thấy” hoặc “Không thấy” ở phần Tóm tắt lần chạy.",
    ],
  },
};

const RECEIVER_MODE: Record<Reconciliation["operations"][number]["receiver_mode"], string> = {
  local_transaction: "giao dịch local",
  receiver_idempotent: "nơi nhận chống ghi trùng",
  non_idempotent: "không chống ghi trùng",
};

export function ReconciliationSection({
  run,
  trace,
  query,
}: {
  run: RunDetail;
  trace: TracePage | undefined;
  query: UseQueryResult<Reconciliation>;
}) {
  const checkedAt = query.dataUpdatedAt
    ? formatClock(new Date(query.dataUpdatedAt).toISOString(), run.time_zone)
    : null;
  return (
    <section aria-labelledby="recon-title" className="flex flex-col gap-5 border-b border-hairline py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="recon-title" className="m-0 text-headline-sm">
            Đối chiếu từng thao tác ghi
          </h2>
          {checkedAt ? <span className="tabular text-body-sm text-muted">Kiểm tra lúc {checkedAt}</span> : null}
        </div>
        <Button variant="secondary" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
          <Icon name="refresh-cw" className={cn(query.isFetching && "animate-spin")} />
          {query.isFetching ? "Đang tải…" : "Tải lại kết quả đối chiếu"}
        </Button>
      </div>

      {query.isPending ? (
        <LoadingState label="Đang tải kết quả đối chiếu…" />
      ) : query.isError ? (
        <ErrorState title="Không tải được kết quả đối chiếu" error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.operations.length === 0 ? (
        <p className="m-0 text-body-md text-muted">Máy chủ chưa ghi nhận thao tác ghi nào cho lần chạy này.</p>
      ) : (
        query.data.operations.map((op) => {
          const receipt = RECEIPT[op.receipt];
          const action = run.approval?.actions.find((a) => a.operation_id === op.operation_id);
          const write = action ? summarizeAction(action) : null;
          const sentAt = trace?.attempts.find((a) => a.operation_id === op.operation_id)?.started_at;
          return (
            <article key={op.operation_id} className="overflow-hidden rounded-md border border-hairline">
              <div className="flex flex-col gap-0.5 px-5 pt-4">
                <h3 className="m-0 text-title-md">{write?.sentence ?? `Thao tác ghi ở bước ${op.step_id}`}</h3>
                <span className="font-mono text-mono-sm text-muted">
                  Bước {op.step_id} · {action ? `${action.server}.${action.tool}` : "không có bản xem trước"}
                </span>
              </div>
              <p className={cn("mx-5 mt-4 flex items-center gap-2 rounded-sm px-3 py-2 text-button-sm", receipt.tone)}>
                <Icon name={receipt.icon} />
                {receipt.line}
              </p>
              <dl className="m-0 grid grid-cols-1 gap-3 px-5 py-4 desk:grid-cols-3">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-overline">ĐÃ GỬI LÚC</dt>
                  <dd className="tabular m-0 text-body-md">{sentAt ? formatClock(sentAt, run.time_zone) : "Không rõ"}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-overline">NƠI NHẬN</dt>
                  <dd className="m-0 text-body-md">
                    {action?.server ?? "Không rõ"} · {RECEIVER_MODE[op.receiver_mode]}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-overline">BIÊN NHẬN</dt>
                  <dd className="m-0 text-body-md font-semibold">{receipt.label}</dd>
                </div>
              </dl>
              {write ? (
                <div className="flex flex-col gap-2 px-5 pb-4">
                  <span className="text-body-sm text-muted">Nội dung đã gửi</span>
                  <div className="overflow-hidden rounded-sm border border-hairline">
                    <WritePayload write={write} />
                  </div>
                </div>
              ) : null}
              {receipt.how.length > 0 ? (
                <div className="mx-5 mb-4 flex flex-col gap-1.5 rounded-sm bg-surface-soft px-4 py-3.5 text-body-sm">
                  <span className="font-semibold">Cách kiểm tra</span>
                  <ol className="m-0 flex flex-col gap-0.5 pl-5">
                    {receipt.how.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
              <div className="border-t border-hairline-soft px-5">
                <TechDisclosure summary="Chi tiết kỹ thuật" hint={`${op.operation_id.slice(0, 8)}… · ${op.receipt}`}>
                  <JsonBlock value={op} />
                </TechDisclosure>
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}
