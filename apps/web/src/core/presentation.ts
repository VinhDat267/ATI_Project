import { TERMINAL_STATUSES, type RunStatus } from "@wap/dsl/browser";
import type { RunDetail } from "./contracts.js";

export type Tone =
  | "progress"
  | "action"
  | "success"
  | "danger"
  | "unknown"
  | "neutral"
  | "planner";

export type StatusIcon =
  | "loader-circle"
  | "hand"
  | "refresh-cw"
  | "circle-check"
  | "circle-x"
  | "ban"
  | "circle-slash"
  | "clock-alert"
  | "message-circle-x"
  | "message-circle-question"
  | "triangle-alert";

export interface StatusPresentation {
  label: string;
  tone: Tone;
  icon: StatusIcon;
  terminal: boolean;
  canCancel: boolean;
  needsAttention: boolean;
}

type StatusRow = Pick<StatusPresentation, "label" | "tone" | "icon">;

// Labels, tones and icons follow the Run status table in DESIGN.md.
const STATUS_ROWS = {
  planning: { label: "Đang lập kế hoạch", tone: "progress", icon: "loader-circle" },
  validating: { label: "Đang kiểm tra kế hoạch", tone: "progress", icon: "loader-circle" },
  dry_running: { label: "Đang đọc dữ liệu xem trước", tone: "progress", icon: "loader-circle" },
  awaiting_approval: { label: "Chờ duyệt", tone: "action", icon: "hand" },
  running: { label: "Đang thực thi", tone: "progress", icon: "loader-circle" },
  replanning: { label: "Đang điều chỉnh kế hoạch", tone: "progress", icon: "refresh-cw" },
  succeeded: { label: "Hoàn tất", tone: "success", icon: "circle-check" },
  failed: { label: "Thất bại", tone: "danger", icon: "circle-x" },
  rejected: { label: "Đã từ chối ghi", tone: "neutral", icon: "ban" },
  cancelled: { label: "Đã huỷ", tone: "neutral", icon: "circle-slash" },
  expired: { label: "Hết hạn duyệt", tone: "neutral", icon: "clock-alert" },
  refused: { label: "Không thể lập kế hoạch", tone: "planner", icon: "message-circle-x" },
  needs_input: { label: "Cần bổ sung thông tin", tone: "planner", icon: "message-circle-question" },
  reconciliation_required: { label: "Cần đối chiếu", tone: "unknown", icon: "triangle-alert" },
} as const satisfies Record<RunStatus, StatusRow>;

const CANCELLABLE: ReadonlySet<RunStatus> = new Set([
  "planning",
  "validating",
  "dry_running",
  "awaiting_approval",
  "running",
  "replanning",
]);
const ATTENTION: ReadonlySet<RunStatus> = new Set([
  "awaiting_approval",
  "reconciliation_required",
]);
const TERMINAL: ReadonlySet<RunStatus> = new Set(TERMINAL_STATUSES);

export function runPresentation(status: RunStatus): StatusPresentation {
  return {
    ...STATUS_ROWS[status],
    terminal: TERMINAL.has(status),
    canCancel: CANCELLABLE.has(status),
    needsAttention: ATTENTION.has(status),
  };
}

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

export type HistoryGroup =
  | "all"
  | "attention"
  | "active"
  | "succeeded"
  | "unfinished";

export const HISTORY_GROUPS: ReadonlyArray<{ id: HistoryGroup; label: string }> =
  [
    { id: "all", label: "Tất cả" },
    { id: "attention", label: "Cần xử lý" },
    { id: "active", label: "Đang chạy" },
    { id: "succeeded", label: "Hoàn tất" },
    { id: "unfinished", label: "Không hoàn tất" },
  ];

export function historyGroupOf(
  status: RunStatus,
): Exclude<HistoryGroup, "all"> {
  if (ATTENTION.has(status)) return "attention";
  if (status === "succeeded") return "succeeded";
  if (TERMINAL.has(status)) return "unfinished";
  return "active";
}

export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function filterRuns(
  runs: RunDetail[],
  group: HistoryGroup,
  query: string,
): RunDetail[] {
  const needle = normalizeSearch(query);
  return runs.filter((run) => {
    if (group !== "all" && historyGroupOf(run.status) !== group) return false;
    if (!needle) return true;
    return (
      normalizeSearch(run.source_prompt ?? "").includes(needle) ||
      run.run_id.toLowerCase().startsWith(needle)
    );
  });
}

export function countByGroup(
  runs: RunDetail[],
): Record<HistoryGroup, number> {
  const counts: Record<HistoryGroup, number> = {
    all: runs.length,
    attention: 0,
    active: 0,
    succeeded: 0,
    unfinished: 0,
  };
  for (const run of runs) counts[historyGroupOf(run.status)] += 1;
  return counts;
}

export function attentionCount(runs: RunDetail[]): number {
  return runs.filter((run) => ATTENTION.has(run.status)).length;
}

export function shortId(runId: string): string {
  return runId.slice(0, 8);
}

function parts(iso: string, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(iso))) {
    out[part.type] = part.value;
  }
  return out;
}

/** "14:32:10" in the run's time zone. */
export function formatClock(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** "14:22, 17/09/2026" in the run's time zone. */
export function formatDateTime(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${p.hour}:${p.minute}, ${p.day}/${p.month}/${p.year}`;
}

export interface Remaining {
  text: string;
  spoken: string;
  urgent: boolean;
  expired: boolean;
}

const URGENT_MS = 2 * 60 * 1000;

export function formatRemaining(ms: number): Remaining {
  if (ms <= 0) {
    return { text: "00:00", spoken: "Đã hết hạn", urgent: true, expired: true };
  }
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return {
    text: `${pad(minutes)}:${pad(seconds)}`,
    spoken:
      minutes > 0 ? `${minutes} phút ${seconds} giây` : `${seconds} giây`,
    urgent: ms <= URGENT_MS,
    expired: false,
  };
}

/** Planned step and write counts, used on meta lines and history rows. */
export function planCounts(run: RunDetail): { steps: number; writes: number } {
  const steps = run.plan?.steps ?? [];
  return {
    steps: steps.length,
    writes: steps.filter((step) => step.side_effect === "write").length,
  };
}
