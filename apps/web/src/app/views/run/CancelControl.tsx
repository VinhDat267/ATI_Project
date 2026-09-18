import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RunDetail } from "../../../core/contracts.js";
import { runPresentation } from "../../../core/presentation.js";
import { runKeys } from "../../../core/queries.js";
import { useApp } from "../../context";
import { Button } from "../../components/Button";

/** Cooperative cancel: stops before the next step, never rolls back. */
export function CancelControl({ run }: { run: RunDetail }) {
  const { transport, generation } = useApp();
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => transport.cancel(run.run_id, new AbortController().signal),
    retry: 0,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: runKeys(generation).detail(run.run_id) });
      void queryClient.invalidateQueries({ queryKey: runKeys(generation).list });
    },
  });
  if (!runPresentation(run.status).canCancel) return null;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <Button variant="link" size="inline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
        {cancel.isPending ? "Đang gửi yêu cầu huỷ…" : "Yêu cầu huỷ lần chạy"}
      </Button>
      <span className="text-caption text-muted" role={cancel.isError ? "alert" : undefined}>
        {cancel.isError
          ? "Chưa gửi được yêu cầu huỷ. Trạng thái đang được tải lại."
          : "Huỷ sẽ dừng trước bước kế tiếp, không hoàn tác bước đã ghi"}
      </span>
    </div>
  );
}
