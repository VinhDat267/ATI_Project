import type { RunDetail } from "./contracts.js";
import type { OriginReason, RequestDraft } from "./draft.js";
import type { WriteSummary } from "./writes.js";

export type ReceiptKind =
  | "confirmed"
  | "conflict"
  | "not_observed"
  | "not_supported";

export interface RecoveryOption {
  id: "seen" | "not_seen" | "differs";
  label: string;
  effect: string;
  /** null: the answer opens guidance in place instead of the composer. */
  draft: RequestDraft | null;
}

export type RecoveryPlan =
  | { kind: "question"; prompt: string; options: RecoveryOption[]; note: string }
  | {
      kind: "primary";
      label: string;
      note: string;
      draft: RequestDraft;
      secondary: { label: string; draft: RequestDraft } | null;
    }
  | { kind: "none" };

export interface RecoveryContext {
  /** Receipts of the run's write operations, when reconciliation loaded. */
  receipts: ReceiptKind[] | null;
  /** Writes whose outcome is not confirmed (from the approved preview). */
  pendingWrites: WriteSummary[];
  /** Planner suggestion for needs_input runs, when one exists. */
  suggestedPrompt?: string | null;
}

export const RECOVERY_NOTE =
  "Câu trả lời chỉ dùng để điền sẵn yêu cầu mới. Lần chạy này vẫn ở trạng thái “Cần đối chiếu”.";

function draft(run: RunDetail, prompt: string, reason: OriginReason): RequestDraft {
  return { prompt, origin: { runId: run.run_id, reason } };
}

/**
 * The message a run still owes after its writes landed: "Báo vào #kênh rằng
 * …", taken from the plan's send_slack_message step. null when the plan never
 * notifies anyone.
 */
export function messageOnlyPromptFor(run: RunDetail): string | null {
  const step = run.plan?.steps.find(
    (candidate) =>
      candidate.tool.server === "task_hub" &&
      candidate.tool.name === "send_slack_message",
  );
  const preview = run.approval?.actions.find(
    (action) => action.tool === "send_slack_message",
  );
  const args = preview?.resolved_args ?? step?.tool.args;
  const channel = typeof args?.channel === "string" ? args.channel : null;
  const text = typeof args?.text === "string" ? args.text : null;
  if (!channel || !text || text.includes("${")) return null;
  const clause = text.trim().replace(/[.。!]+$/u, "");
  const lowered = clause.charAt(0).toLowerCase() + clause.slice(1);
  return `Báo vào ${channel} rằng ${lowered}`;
}

function questionFor(
  run: RunDetail,
  context: RecoveryContext,
  withDiffers: boolean,
): RecoveryPlan {
  const sheet =
    context.pendingWrites.length === 1 &&
    context.pendingWrites[0]?.kind === "sheet"
      ? context.pendingWrites[0]
      : null;
  const prompt = sheet
    ? withDiffers
      ? `Trên bảng ${sheet.target}, ${sheet.count} dòng đã gửi đang thế nào?`
      : `Trên bảng ${sheet.target} đã có ${sheet.count} dòng đã gửi chưa?`
    : "Trên nơi nhận đã có dữ liệu của thao tác ghi này chưa?";
  const messageOnly = messageOnlyPromptFor(run);
  const messageTarget = messageOnly?.match(/^Báo vào (\S+)/u)?.[1];

  const seen: RecoveryOption = {
    id: "seen",
    label: withDiffers
      ? "Đã thấy, đúng như đã gửi"
      : sheet
        ? `Đã thấy đủ ${sheet.count} dòng`
        : "Đã thấy đủ",
    effect: messageOnly
      ? `Tạo yêu cầu chỉ gửi thông báo vào ${messageTarget}`
      : "Không cần ghi lại",
    draft: messageOnly ? draft(run, messageOnly, "reconcile_seen") : null,
  };
  const notSeen: RecoveryOption = {
    id: "not_seen",
    label: "Không thấy",
    effect: sheet
      ? `Tạo lại đủ yêu cầu: thêm ${sheet.count} dòng${messageOnly ? " và gửi thông báo" : ""}`
      : "Tạo lại đủ yêu cầu",
    draft: draft(run, run.source_prompt ?? "", "reconcile_not_seen"),
  };
  const options = [seen, notSeen];
  if (withDiffers) {
    options.push({
      id: "differs",
      label: "Thấy nhưng khác nội dung",
      effect: "Không tạo lại. Xem cách sửa bên dưới",
      draft: null,
    });
  }
  return { kind: "question", prompt, options, note: RECOVERY_NOTE };
}

/** Next step offered on a finished run (DESIGN.md, Recovery). */
export function recoveryFor(
  run: RunDetail,
  context: RecoveryContext,
): RecoveryPlan {
  const prompt = run.source_prompt ?? "";
  switch (run.status) {
    case "reconciliation_required": {
      const receipts = context.receipts ?? [];
      if (receipts.length > 0 && receipts.every((r) => r === "confirmed")) {
        const messageOnly = messageOnlyPromptFor(run);
        if (!messageOnly) return { kind: "none" };
        return {
          kind: "primary",
          label: "Tạo yêu cầu chỉ gửi thông báo",
          note: "Điền sẵn tin nhắn báo nhóm. Các dòng đã có sẽ không bị ghi lại.",
          draft: draft(run, messageOnly, "reconcile_confirmed"),
          secondary: null,
        };
      }
      return questionFor(run, context, receipts.includes("conflict"));
    }
    case "expired":
      return {
        kind: "primary",
        label: "Dùng lại yêu cầu này",
        note: "Hệ thống đọc lại dữ liệu và lập bản xem trước mới",
        draft: draft(run, prompt, "expired"),
        secondary: {
          label: "Tạo yêu cầu trống",
          draft: { prompt: "", origin: null },
        },
      };
    case "failed":
      return {
        kind: "primary",
        label: "Dùng lại yêu cầu này",
        note: "Mở màn tạo với câu cũ để bạn sửa trước khi gửi",
        draft: draft(run, prompt, "failed"),
        secondary: {
          label: "Tạo yêu cầu trống",
          draft: { prompt: "", origin: null },
        },
      };
    case "needs_input": {
      const suggested = context.suggestedPrompt ?? null;
      if (suggested) {
        return {
          kind: "primary",
          label: "Dùng câu gợi ý này",
          note: "Mở màn tạo với câu gợi ý. Bạn sửa được trước khi gửi.",
          draft: draft(run, suggested, "needs_input"),
          secondary: {
            label: "Dùng lại câu gốc",
            draft: draft(run, prompt, "needs_input"),
          },
        };
      }
      return {
        kind: "primary",
        label: "Dùng lại câu gốc",
        note: "Bổ sung thông tin còn thiếu rồi gửi lại",
        draft: draft(run, prompt, "needs_input"),
        secondary: null,
      };
    }
    default:
      return { kind: "none" };
  }
}
