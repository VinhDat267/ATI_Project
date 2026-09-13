/**
 * Sự kiện engine/frontend. Profile B dùng REST polling; WS envelopes là legacy.
 *
 * Cùng định dạng với bảng `run_events` và với endpoint
 * `GET /runs/{id}/events?since_seq=`. Nhờ vậy xem trực tiếp và xem lại
 * dùng chung một đường code ở frontend (FR-TRC-02, FR-TRC-05).
 *
 * Quy ước:
 *   - `seq` tăng dần, liên tục, trong phạm vi một run.
 *   - Client giữ `last_seq`. Thấy nhảy số → gọi REST lấy phần thiếu.
 *   - dryrun.ready là thông báo: client fetch RunDetail để lấy preview đầy đủ.
 */

import { z } from "zod";
import { SideEffectSchema, WorkflowPlanSchema } from "./schema.js";

/* ────────────────────────────────────────────────────────────
 * Enum dùng chung
 * ──────────────────────────────────────────────────────────── */

export const RunStatusSchema = z.enum([
  "planning",
  "validating",
  "dry_running",
  "awaiting_approval",
  "running",
  "replanning",
  "succeeded",
  "failed",
  "rejected",
  "cancelled",
  "expired",
  "refused",
  "needs_input",
  "reconciliation_required",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const StepStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "deduplicated",
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const ErrorClassSchema = z.enum([
  "transient", // Retry requires separate dispatch/outcome-certainty checks, especially for writes.
  "bad_args", // 400, validation error  → replan cục bộ
  "bad_tool", // 404, tool sai          → replan cục bộ
  "bad_assumption", // output rỗng/sai kiểu   → replan một phần
  "fatal", // không phục hồi được
]);
export type ErrorClass = z.infer<typeof ErrorClassSchema>;

/** Trạng thái kết thúc — không có sự kiện nào sau đó. */
export const TerminalRunStatusSchema = z.enum([
  "succeeded",
  "failed",
  "rejected",
  "cancelled",
  "expired",
  "refused",
  "needs_input",
  "reconciliation_required",
]);
export const TERMINAL_STATUSES: readonly RunStatus[] =
  TerminalRunStatusSchema.options;

/* ────────────────────────────────────────────────────────────
 * Payload theo từng loại sự kiện
 * ──────────────────────────────────────────────────────────── */

const base = { seq: z.number().int().nonnegative(), created_at: z.string() };

/** Trạng thái run thay đổi. Luôn phát khi status đổi. */
export const RunStatusEvent = z.object({
  ...base,
  type: z.literal("run.status"),
  payload: z.object({
    status: RunStatusSchema,
    previous: RunStatusSchema.nullable(),
  }),
});

/** Kế hoạch đã sinh và qua validate. Frontend vẽ sơ đồ DAG từ đây. */
export const PlanReadyEvent = z.object({
  ...base,
  type: z.literal("plan.ready"),
  payload: z.object({
    workflow_version_id: z.string(),
    version_no: z.number().int(),
    /** Khớp WorkflowPlanSchema — không lặp lại định nghĩa ở đây. */
    plan: WorkflowPlanSchema,
    /** Kết quả executionLayers(); frontend dùng trực tiếp để bố trí. */
    layers: z.array(z.array(z.string())),
    attempts: z.number().int(),
  }),
});

/** Một vòng validate thất bại. Hiển thị để người dùng thấy hệ thống đang tự sửa. */
export const ValidationFailedEvent = z.object({
  ...base,
  type: z.literal("validation.failed"),
  payload: z.object({
    attempt_no: z.number().int(),
    max_attempts: z.number().int(),
    layer: z.enum(["schema", "tool", "graph"]),
    issues: z.array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      }),
    ),
  }),
});

/** Dry-run xong, chờ duyệt. */
export const DryRunReadyEvent = z.object({
  ...base,
  type: z.literal("dryrun.ready"),
  payload: z.object({
    approval_id: z.string(),
    expires_at: z.string(),
    read_count: z.number().int(),
    write_count: z.number().int(),
  }),
});

export const StepStartedEvent = z.object({
  ...base,
  type: z.literal("step.started"),
  payload: z.object({
    step_id: z.string(),
    description: z.string(),
    tool: z.object({ server: z.string(), name: z.string() }),
    side_effect: SideEffectSchema,
    attempt_no: z.number().int(),
  }),
});

/** Bắt đầu một lần thử — kèm args đã resolve, rất hữu ích khi debug. */
export const StepAttemptEvent = z.object({
  ...base,
  type: z.literal("step.attempt"),
  payload: z.object({
    step_id: z.string(),
    attempt_no: z.number().int(),
    resolved_args: z.record(z.string(), z.unknown()),
  }),
});

/**
 * Thất bại và sắp thử lại.
 * Đây là sự kiện làm cơ chế retry TRỞ NÊN NHÌN THẤY ĐƯỢC trên UI
 * (FR-TRC-03) — thiếu nó thì công sức làm retry không ai thấy.
 */
export const StepRetryingEvent = z.object({
  ...base,
  type: z.literal("step.retrying"),
  payload: z.object({
    step_id: z.string(),
    attempt_no: z.number().int(),
    max_attempts: z.number().int(),
    error_message: z.string(),
    error_class: ErrorClassSchema,
    delay_ms: z.number().int(),
  }),
});

export const StepSucceededEvent = z.object({
  ...base,
  type: z.literal("step.succeeded"),
  payload: z.object({
    step_id: z.string(),
    attempts: z.number().int(),
    duration_ms: z.number().int(),
    /** Cắt bớt nếu quá lớn; UI gọi /trace khi cần bản đầy đủ. */
    output_preview: z.unknown().optional(),
    /** true khi bị bỏ qua do idempotency key đã dùng. */
    deduplicated: z.boolean().default(false),
  }),
});

export const StepFailedEvent = z.object({
  ...base,
  type: z.literal("step.failed"),
  payload: z.object({
    step_id: z.string(),
    attempts: z.number().int(),
    error_message: z.string(),
    error_class: ErrorClassSchema,
    on_error: z.enum(["fail", "continue", "replan"]),
  }),
});

/** Bỏ qua vì `condition` cho kết quả sai. */
export const StepSkippedEvent = z.object({
  ...base,
  type: z.literal("step.skipped"),
  payload: z.object({
    step_id: z.string(),
    condition: z.string(),
  }),
});

export const ReplanStartedEvent = z.object({
  ...base,
  type: z.literal("replan.started"),
  payload: z.object({
    failed_step_id: z.string(),
    error_class: ErrorClassSchema,
    /** local = chỉ sửa bước lỗi; partial = sinh lại từ bước lỗi; full = toàn bộ */
    scope: z.enum(["local", "partial", "full"]),
    replan_count: z.number().int(),
  }),
});

/** Kế hoạch mới đã áp dụng. Frontend vẽ lại DAG và tô đậm phần thay đổi. */
export const ReplanAppliedEvent = z.object({
  ...base,
  type: z.literal("replan.applied"),
  payload: z.object({
    workflow_version_id: z.string(),
    version_no: z.number().int(),
    plan: WorkflowPlanSchema,
    layers: z.array(z.array(z.string())),
    changed_step_ids: z.array(z.string()),
  }),
});

export const RunFinishedEvent = z.object({
  ...base,
  type: z.literal("run.finished"),
  payload: z.object({
    status: TerminalRunStatusSchema,
    duration_ms: z.number().int().nullable(),
    error_message: z.string().nullable(),
    outputs: z.record(z.string(), z.unknown()).default({}),
  }),
});

/* ────────────────────────────────────────────────────────────
 * Union
 * ──────────────────────────────────────────────────────────── */

export const RunEventSchema = z.discriminatedUnion("type", [
  RunStatusEvent,
  PlanReadyEvent,
  ValidationFailedEvent,
  DryRunReadyEvent,
  StepStartedEvent,
  StepAttemptEvent,
  StepRetryingEvent,
  StepSucceededEvent,
  StepFailedEvent,
  StepSkippedEvent,
  ReplanStartedEvent,
  ReplanAppliedEvent,
  RunFinishedEvent,
]);

export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent["type"];

/** Lấy đúng kiểu payload của một loại sự kiện. */
export type PayloadOf<T extends RunEventType> = Extract<
  RunEvent,
  { type: T }
>["payload"];

/* ────────────────────────────────────────────────────────────
 * Message từ client lên server
 * ──────────────────────────────────────────────────────────── */

export const ClientMessageSchema = z.discriminatedUnion("type", [
  /** Bám theo một run. `since_seq` để lấy lại phần đã bỏ lỡ. */
  z.object({
    type: z.literal("subscribe"),
    run_id: z.string(),
    since_seq: z.number().int().nonnegative().default(0),
  }),
  z.object({ type: z.literal("unsubscribe"), run_id: z.string() }),
  z.object({ type: z.literal("ping") }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("event"),
    run_id: z.string(),
    event: RunEventSchema,
  }),
  /** Xác nhận đăng ký, kèm seq hiện tại để client biết đã đồng bộ tới đâu. */
  z.object({
    type: z.literal("subscribed"),
    run_id: z.string(),
    current_seq: z.number().int(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
  z.object({ type: z.literal("pong") }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
