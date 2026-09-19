import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import type { RunDetail } from "../../../core/contracts.js";
import { runPresentation } from "../../../core/presentation.js";
import { runKeys } from "../../../core/queries.js";
import { useApp } from "../../context";
import { Button } from "../../components/Button";

/** Cooperative cancel: stops before the next step, never rolls back. */
export function CancelControl({ run }: { run: RunDetail }) {
  const { controllers, generation } = useApp();
  const queryClient = useQueryClient();
  const commandController = controllers.getRunCommands(run.run_id);
  const commandSnapshot = useSyncExternalStore(
    commandController.subscribe,
    commandController.getSnapshot,
    commandController.getSnapshot,
  );

  useEffect(() => {
    commandController.reconcileWithDetail(run);
  }, [run, commandController]);

  if (!runPresentation(run.status).canCancel) return null;

  const isPending =
    commandSnapshot.status === "submitting" && commandSnapshot.action === "cancel";
  const isLocked =
    commandSnapshot.status === "submitting" || commandSnapshot.status === "confirming";

  const handleCancel = async (): Promise<void> => {
    await commandController.cancel(run.time_zone);
    void queryClient.invalidateQueries({ queryKey: runKeys(generation).detail(run.run_id) });
    void queryClient.invalidateQueries({ queryKey: runKeys(generation).list });
    const runSync = controllers.getRunSync(run.run_id);
    void runSync.refresh();
  };

  return (
    <div className="flex flex-col items-center gap-0.5">
      <Button
        variant="link"
        size="inline"
        disabled={isLocked}
        onClick={() => void handleCancel()}
      >
        {isPending ? "Đang gửi yêu cầu huỷ…" : "Yêu cầu huỷ lần chạy"}
      </Button>
      <span
        className="text-caption text-muted"
        role={commandSnapshot.status === "error" ? "alert" : undefined}
      >
        {commandSnapshot.status === "error" && commandSnapshot.action === "cancel"
          ? "Chưa gửi được yêu cầu huỷ. Trạng thái đang được tải lại."
          : commandSnapshot.status === "confirming" && commandSnapshot.action === "cancel"
            ? "Đang kiểm tra kết quả yêu cầu huỷ từ máy chủ…"
            : "Huỷ sẽ dừng trước bước kế tiếp, không hoàn tác bước đã ghi"}
      </span>
    </div>
  );
}

