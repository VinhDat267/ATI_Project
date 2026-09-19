import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RunDetail } from "../../../core/contracts.js";
import { formatClock, formatRemaining } from "../../../core/presentation.js";
import { runKeys } from "../../../core/queries.js";
import { summarizeAction, type WriteSummary } from "../../../core/writes.js";
import { cn } from "@/lib/cn";
import { useApp } from "../../context";
import { Banner } from "../../components/Banner";
import { Button } from "../../components/Button";
import { Icon, type IconName } from "../../components/Icon";
import { useNow } from "../../hooks";
import { CancelControl } from "./CancelControl";

const MILESTONES = [9, 5, 2, 1];

function writeIcon(write: WriteSummary): IconName {
  switch (write.kind) {
    case "sheet":
      return "table";
    case "message":
      return "message";
    case "card":
    case "move":
      return "kanban";
    case "file":
      return "file";
    default:
      return "send";
  }
}

/**
 * Decision card, option B (DESIGN.md): what you are about to write is the
 * largest element; the timer is one line above the approve button.
 */
export function DecisionCard({ run }: { run: RunDetail }) {
  const { controllers, generation } = useApp();
  const queryClient = useQueryClient();
  const commandController = controllers.getRunCommands(run.run_id);
  const commandSnapshot = useSyncExternalStore(
    commandController.subscribe,
    commandController.getSnapshot,
    commandController.getSnapshot,
  );
  const approval = run.approval!;
  const writes = approval.actions.map((action) => summarizeAction(action));
  const now = useNow(1000);
  const remainingMs = Date.parse(approval.expires_at) - now;
  const remaining = formatRemaining(remainingMs);
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef<number | null>(null);

  useEffect(() => {
    commandController.reconcileWithDetail(run);
  }, [run, commandController]);

  // Screen readers hear milestones (9/5/2/1 min, expiry), never every second.
  useEffect(() => {
    if (remaining.expired) {
      if (announced.current !== 0) {
        announced.current = 0;
        setAnnouncement("Đã hết thời hạn duyệt");
      }
      return;
    }
    const minutesLeft = Math.ceil(remainingMs / 60_000);
    if (MILESTONES.includes(minutesLeft) && announced.current !== minutesLeft) {
      announced.current = minutesLeft;
      setAnnouncement(`Còn khoảng ${minutesLeft} phút để duyệt`);
    }
  }, [remainingMs, remaining.expired]);

  // When the server-side deadline passes, re-read the run instead of guessing.
  useEffect(() => {
    if (remaining.expired) {
      void queryClient.invalidateQueries({ queryKey: runKeys(generation).detail(run.run_id) });
    }
  }, [remaining.expired, queryClient, generation, run.run_id]);

  const handleDecide = async (decision: "approved" | "rejected"): Promise<void> => {
    const detail = await commandController.decide(
      {
        approval_id: approval.id,
        workflow_version_id: approval.workflow_version_id,
        snapshot_hash: approval.snapshot_hash,
        decision,
      },
      run.time_zone,
    );
    if (detail) {
      queryClient.setQueryData(runKeys(generation).detail(run.run_id), detail);
      void queryClient.invalidateQueries({ queryKey: runKeys(generation).list });
      const runSync = controllers.getRunSync(run.run_id);
      void runSync.refresh();
    } else {
      void queryClient.invalidateQueries({ queryKey: runKeys(generation).detail(run.run_id) });
      const runSync = controllers.getRunSync(run.run_id);
      void runSync.refresh();
    }
  };

  const isSubmitting = commandSnapshot.status === "submitting";
  const isConfirming = commandSnapshot.status === "confirming";
  const locked = isSubmitting || isConfirming || remaining.expired;
  const pendingDecision = isSubmitting
    ? commandSnapshot.action === "approve"
      ? "approved"
      : "rejected"
    : null;

  return (
    <section
      aria-label="Quyết định ghi"
      className="flex flex-col gap-5 rounded-md border border-hairline bg-canvas p-6 shadow-card"
    >
      <div id="write-summary" className="flex flex-col gap-3.5">
        <span className="text-body-md text-muted">Bạn sắp ghi</span>
        <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
          {writes.map((write, index) => (
            <li key={write.operationId ?? index} className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-action-subtle text-action">
                <Icon name={writeIcon(write)} size={18} />
              </span>
              <span className="text-headline-sm-mobile desk:text-headline-sm">{write.sentence}</span>
            </li>
          ))}
        </ul>
      </div>

      {commandSnapshot.status === "confirming" ? (
        <Banner tone="unknown" icon="triangle-alert" title="Chưa xác nhận được quyết định đã được xử lý hay chưa" live>
          Máy chủ không phản hồi khi gửi quyết định{commandSnapshot.lostAt ? ` lúc ${commandSnapshot.lostAt}` : ""}. Hệ thống không tự gửi lại để tránh ghi trùng. Trạng thái lần chạy đang được kiểm tra tự động.
        </Banner>
      ) : commandSnapshot.status === "error" ? (
        <Banner tone="danger" icon="circle-x" title="Chưa gửi được quyết định" live>
          {commandSnapshot.error?.message ??
            "Trạng thái lần chạy đang được tải lại. Nếu bản xem trước đã hết hạn hoặc đã có quyết định khác, trang sẽ cập nhật theo máy chủ."}
        </Banner>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <div
          id="expiry"
          className={cn(
            "flex items-center gap-2.5 rounded-sm px-0.5",
            remaining.urgent && !remaining.expired && "bg-action-subtle px-3 py-2 text-action",
          )}
        >
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              remaining.urgent ? "bg-canvas" : "bg-surface-strong",
            )}
          >
            <Icon name={remaining.urgent ? "hourglass" : "clock"} />
          </span>
          <span className="flex flex-col">
            <span role="timer" aria-label={remaining.expired ? "Đã hết thời hạn duyệt" : `Còn ${remaining.spoken} để duyệt`} className="tabular text-title-md">
              {remaining.expired
                ? "Đã hết thời hạn duyệt"
                : remaining.urgent
                  ? `Sắp hết hạn · còn ${remaining.text}`
                  : `Còn ${remaining.text}`}
            </span>
            <span className="tabular text-caption text-muted">
              Hết hạn lúc {formatClock(approval.expires_at, run.time_zone)} theo máy chủ
            </span>
          </span>
          <span aria-live="polite" className="sr-only">
            {announcement}
          </span>
        </div>
        <Button
          aria-describedby="write-summary expiry"
          disabled={locked}
          onClick={() => void handleDecide("approved")}
        >
          {pendingDecision === "approved" ? "Đang gửi…" : `Duyệt ${writes.length} thao tác ghi`}
        </Button>
        <Button variant="secondary" disabled={locked} onClick={() => void handleDecide("rejected")}>
          {pendingDecision === "rejected" ? "Đang gửi…" : "Từ chối ghi"}
        </Button>
        <span className="text-center text-body-sm text-muted">
          Bạn sẽ thấy kết quả từng bước sau khi duyệt
        </span>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-hairline pt-4 text-body-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted">Múi giờ</span>
          <span>{run.time_zone}</span>
        </div>
      </div>
      <CancelControl run={run} />
    </section>
  );
}
