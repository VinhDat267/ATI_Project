import {
  EventPageSchema,
  PlannerResultSchema,
  ReconciliationSchema,
  RunDetailSchema,
  ServerSummaryListSchema,
  TraceSchema,
  WorkflowPlanSchema,
  type RunStatus,
} from "@wap/dsl/browser";
import type {
  EventPage,
  Reconciliation,
  RunDetail,
  Servers,
  TracePage,
} from "../core/contracts.js";

/**
 * Synthetic runs matching the “ATI Run Screens” design canvas. Every object is
 * parsed with the shared DSL schemas, so a fixture cannot drift from the API
 * contract without failing at startup. All names and rows are invented.
 */

type RunEvent = EventPage["events"][number];

export interface WorldRun {
  detail: RunDetail;
  trace: TracePage;
  events: RunEvent[];
  reconciliation: Reconciliation | null;
  suggestedPrompt?: string;
  failure?: { code: string; message: string; stepId: string };
}

export interface FixtureWorld {
  runs: WorldRun[];
  servers: Servers;
  checkedAt: string;
}

export const WORLD_IDS = {
  approval: "7c1e2a90-4b7d-4e2a-9f1c-2d8e6a0b5c13",
  reconcile: "2d94b7e1-5c3a-4f1e-9b2d-7a6c1e0f3b21",
  reconcileConfirmed: "3a6f0c52-8e1b-4d7a-a3c9-5b2e8f1d4c60",
  reconcileConflict: "4b8d2e71-6a0c-4f3b-b8e2-9c1a7d5f2e84",
  running: "5e2c9a14-3b8f-4d6e-a1c7-8f4b2d9e6a35",
  planning: "6f3d0b25-9c1e-4a7f-8b2d-4e7c1a5f9b62",
  expired: "0f7b52e3-8d41-4c6a-a2f9-3e5b7c9d1a04",
  failed: "91d2f6c8-2b5e-4a7d-8c3f-6e1a9b4d7f25",
  needsInput: "b81f0d24-7e3c-4b9a-9d2f-1a6c8e5b3f47",
  refused: "c3a86e19-4f2d-4a8b-b7e1-3c9d5a2f6e18",
  succeeded: "8a4e1c36-2d9f-4b5a-9e3c-7b1d6f8a2c47",
  rejected: "9b5f2d47-1e3a-4c6b-a8d4-2f9e7c3b5d18",
} as const;

const HASH = (seed: string): string =>
  (seed.replace(/[^0-9a-f]/g, "") + "0".repeat(64)).slice(0, 64);
const uuid = (prefix: string, n: number): string =>
  `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ZONE = "Asia/Ho_Chi_Minh";
const at = (iso: string, plusSeconds = 0): string =>
  new Date(Date.parse(iso) + plusSeconds * 1000).toISOString();

const MEMBERS = ["Nguyễn Minh An", "Trần Thu Hà", "Lê Quốc Việt", "Phạm Gia Bảo"];
const WEEK_ROWS: Record<number, string[][]> = {
  35: [
    ["Tuần 35", MEMBERS[0]!, "Phác thảo màn đăng nhập", "Hoàn thành"],
    ["Tuần 35", MEMBERS[1]!, "Đọc tài liệu API", "Hoàn thành"],
  ],
  36: [
    ["Tuần 36", MEMBERS[0]!, "Dựng khung API", "Hoàn thành"],
    ["Tuần 36", MEMBERS[1]!, "Viết kịch bản kiểm thử", "Đang làm"],
    ["Tuần 36", MEMBERS[2]!, "Chuẩn bị bảng tiến độ", "Hoàn thành"],
  ],
  37: [
    ["Tuần 37", MEMBERS[0]!, "Kết nối API đăng nhập với giao diện", "Hoàn thành"],
    ["Tuần 37", MEMBERS[1]!, "Viết kiểm thử luồng duyệt", "Đang làm"],
    ["Tuần 37", MEMBERS[2]!, "Dựng dữ liệu mẫu cho demo", "Hoàn thành"],
    ["Tuần 37", MEMBERS[3]!, "Soạn báo cáo giữa kỳ", "Đang làm"],
  ],
  38: [
    ["Tuần 38", MEMBERS[0]!, "Hoàn thiện API đăng nhập", "Hoàn thành"],
    ["Tuần 38", MEMBERS[1]!, "Viết kiểm thử phê duyệt", "Đang làm"],
    ["Tuần 38", MEMBERS[2]!, "Chuẩn bị dữ liệu demo local", "Hoàn thành"],
  ],
};

interface StepSpec {
  id: string;
  description: string;
  server?: string;
  tool: string;
  args: Record<string, unknown>;
  write: boolean;
  dependsOn?: string[];
}

function plan(name: string, prompt: string, steps: StepSpec[]): RunDetail["plan"] {
  return WorkflowPlanSchema.parse({
    version: "1.0",
    name,
    source_prompt: prompt,
    inputs: {},
    steps: steps.map((step) => ({
      id: step.id,
      description: step.description,
      tool: { server: step.server ?? "task_hub", name: step.tool, args: step.args },
      depends_on: step.dependsOn ?? [],
      condition: null,
      retry: { max_attempts: 3, backoff: "exponential", initial_delay_ms: 500 },
      idempotency_key: step.write ? `fixture-${step.id}` : null,
      side_effect: step.write ? "write" : "read",
      on_error: "fail",
      timeout_ms: 30_000,
    })),
    outputs: {},
  });
}

function weeklyReport(week: number, withNotice = true): { prompt: string; steps: StepSpec[]; message: string } {
  const rows = WEEK_ROWS[week]!;
  const message = `Đã cập nhật ${rows.length} dòng tiến độ tuần ${week} vào bảng Báo cáo tuần.`;
  const steps: StepSpec[] = [
    {
      id: "read_progress",
      description: `Đọc bảng “Tiến độ nhóm”, lọc tuần ${week}`,
      tool: "read_sheet_range",
      args: { spreadsheet_id: "tien-do-nhom", range: `Tuan${week}!A1:D10` },
      write: false,
    },
    {
      id: "append_report",
      description: `Thêm ${rows.length} dòng vào bảng “Báo cáo tuần”`,
      tool: "append_sheet_rows",
      args: {
        spreadsheet_id: "bao-cao-tuan",
        sheet_name: "Báo cáo tuần",
        rows: "${steps.read_progress.values}",
      },
      write: true,
      dependsOn: ["read_progress"],
    },
  ];
  if (withNotice) {
    steps.push({
      id: "notify_team",
      description: "Gửi thông báo vào kênh #nhom-ati",
      tool: "send_slack_message",
      args: { channel: "#nhom-ati", text: message },
      write: true,
      dependsOn: ["append_report"],
    });
  }
  return {
    prompt: withNotice
      ? `Chép tiến độ tuần ${week} từ “Tiến độ nhóm” sang “Báo cáo tuần”, rồi báo vào #nhom-ati`
      : `Chép tiến độ tuần ${week} sang “Báo cáo tuần”`,
    steps,
    message,
  };
}

function approvalFor(
  runId: string,
  versionId: string,
  decision: "pending" | "approved" | "rejected" | "expired",
  expiresAt: string,
  actions: Array<{ stepId: string; tool: string; args: Record<string, unknown> }>,
): NonNullable<RunDetail["approval"]> {
  return {
    id: uuid(runId.slice(0, 8), 3),
    run_id: runId,
    workflow_version_id: versionId,
    snapshot_hash: HASH(runId + "aa"),
    decision,
    expires_at: expiresAt,
    actions: actions.map((action, index) => ({
      step_id: action.stepId,
      operation_id: uuid(runId.slice(0, 8), 10 + index),
      server: "task_hub",
      tool: action.tool,
      policy_version: "b-local-1",
      resolved_args: action.args as Record<string, never>,
      payload_hash: HASH(runId + String(index) + "bb"),
    })),
  };
}

type Certainty = "before_dispatch" | "known_not_applied" | "confirmed" | "unknown";

interface AttemptSpec {
  stepId: string;
  tool: string;
  args: Record<string, unknown>;
  certainty: Certainty;
  startedAt: string;
  endedAt: string | null;
  result?: unknown;
  error?: { cls: "transient" | "bad_args" | "bad_tool" | "fatal"; message: string };
  operationId?: string | null;
}

function trace(runId: string, versionId: string | null, attempts: AttemptSpec[]): TracePage {
  return TraceSchema.parse({
    run_id: runId,
    next_cursor: null,
    attempts: attempts.map((attempt, index) => ({
      attempt_id: uuid(runId.slice(0, 8), 100 + index),
      step_id: attempt.stepId,
      attempt_no: 1,
      workflow_version_id: versionId,
      evidence: "complete",
      tool_snapshot: {
        server: "task_hub",
        name: attempt.tool,
        policy_version: "b-local-1",
        artifact_hash: HASH(attempt.tool + "cc"),
        input_schema: {},
        output_schema: {},
      },
      operation_id: attempt.operationId ?? null,
      resolved_args: attempt.args,
      result: attempt.result ?? null,
      outcome_certainty: attempt.certainty,
      error_class: attempt.error?.cls ?? null,
      error_message: attempt.error?.message ?? null,
      started_at: attempt.startedAt,
      ended_at: attempt.endedAt,
    })),
  });
}

function events(list: Array<[string, RunEvent["type"], Record<string, unknown>]>): RunEvent[] {
  const page = EventPageSchema.parse({
    next_seq: list.length,
    events: list.map(([createdAt, type, payload], index) => ({
      seq: index + 1,
      created_at: createdAt,
      type,
      payload,
    })),
  });
  return page.events;
}

const statusEvent = (
  createdAt: string,
  status: RunStatus,
  previous: RunStatus | null,
): [string, RunEvent["type"], Record<string, unknown>] => [
  createdAt,
  "run.status",
  { status, previous },
];

function detail(input: {
  id: string;
  status: RunStatus;
  prompt: string;
  createdAt: string;
  plan?: RunDetail["plan"];
  planner?: RunDetail["planner_result"];
  approval?: RunDetail["approval"];
  lastSeq: number;
  readOutputs?: Record<string, unknown>;
}): RunDetail {
  const hasPlan = input.plan !== undefined && input.plan !== null;
  return RunDetailSchema.parse({
    run_id: input.id,
    status: input.status,
    workflow_version_id: hasPlan ? uuid(input.id.slice(0, 8), 2) : null,
    plan: input.plan ?? null,
    planner_result: input.planner ?? null,
    approval: input.approval ?? null,
    time_zone: ZONE,
    runtime: { today: input.createdAt.slice(0, 10), now: input.createdAt },
    last_seq: input.lastSeq,
    source_prompt: input.prompt,
    created_at: input.createdAt,
    read_outputs: input.readOutputs ?? {},
  });
}

function reconcileRun(
  id: string,
  receipt: "not_observed" | "confirmed" | "conflict",
): WorldRun {
  const report = weeklyReport(37);
  const created = "2026-09-16T09:02:30.000Z";
  const workflowPlan = plan("Báo cáo tiến độ tuần 37", report.prompt, report.steps);
  const versionId = uuid(id.slice(0, 8), 2);
  const approval = approvalFor(id, versionId, "approved", at(created, 600), [
    {
      stepId: "append_report",
      tool: "append_sheet_rows",
      args: { spreadsheet_id: "bao-cao-tuan", sheet_name: "Báo cáo tuần", rows: WEEK_ROWS[37] },
    },
    { stepId: "notify_team", tool: "send_slack_message", args: { channel: "#nhom-ati", text: report.message } },
  ]);
  const operationId = approval.actions[0]!.operation_id;
  const readArgs = report.steps[0]!.args;
  return {
    detail: detail({
      id,
      status: "reconciliation_required",
      prompt: report.prompt,
      createdAt: created,
      plan: workflowPlan,
      approval,
      lastSeq: 7,
      readOutputs: { read_progress: { values: WEEK_ROWS[37]!, row_count: 4 } },
    }),
    trace: trace(id, versionId, [
      { stepId: "read_progress", tool: "read_sheet_range", args: readArgs, certainty: "confirmed", startedAt: at(created, 10), endedAt: at(created, 11), result: { row_count: 4 } },
      {
        stepId: "append_report",
        tool: "append_sheet_rows",
        args: approval.actions[0]!.resolved_args,
        certainty: "unknown",
        startedAt: "2026-09-16T09:05:11.000Z",
        endedAt: "2026-09-16T09:05:41.000Z",
        error: { cls: "transient", message: "Hết thời gian chờ phản hồi của nơi nhận" },
        operationId,
      },
    ]),
    events: events([
      statusEvent(created, "planning", null),
      [at(created, 20), "dryrun.ready", { approval_id: approval.id, expires_at: approval.expires_at, read_count: 1, write_count: 2 }],
      statusEvent(at(created, 21), "awaiting_approval", "dry_running"),
      statusEvent("2026-09-16T09:04:58.000Z", "running", "awaiting_approval"),
      [ "2026-09-16T09:05:41.000Z", "step.failed", { step_id: "append_report", attempts: 1, error_message: "Hết thời gian chờ phản hồi của bước 2", error_class: "transient", on_error: "fail" } ],
      [ "2026-09-16T09:05:48.000Z", "step.skipped", { step_id: "notify_team", condition: "bước 2 chưa rõ kết quả" } ],
      [ "2026-09-16T09:05:48.000Z", "run.finished", { status: "reconciliation_required", duration_ms: 50_000, error_message: null, outputs: {} } ],
    ]),
    reconciliation: ReconciliationSchema.parse({
      run_id: id,
      read_only: true,
      operations: [
        {
          operation_id: operationId,
          step_id: "append_report",
          state: receipt === "confirmed" ? "succeeded" : "unknown",
          receiver_mode: "local_transaction",
          receipt,
          result: null,
          dispatch_marker: "present",
        },
      ],
    }),
  };
}

export function createWorld(now: Date): FixtureWorld {
  const nowIso = now.toISOString();
  const runs: WorldRun[] = [];

  // Chờ duyệt — tuần 38, còn 8:41.
  {
    const id = WORLD_IDS.approval;
    const report = weeklyReport(38);
    const created = at(nowIso, -60);
    const versionId = uuid(id.slice(0, 8), 2);
    const approval = approvalFor(id, versionId, "pending", at(nowIso, 521), [
      {
        stepId: "append_report",
        tool: "append_sheet_rows",
        args: { spreadsheet_id: "bao-cao-tuan", sheet_name: "Báo cáo tuần", rows: WEEK_ROWS[38] },
      },
      { stepId: "notify_team", tool: "send_slack_message", args: { channel: "#nhom-ati", text: report.message } },
    ]);
    runs.push({
      detail: detail({
        id,
        status: "awaiting_approval",
        prompt: report.prompt,
        createdAt: created,
        plan: plan("Báo cáo tiến độ tuần 38", report.prompt, report.steps),
        approval,
        lastSeq: 4,
        readOutputs: { read_progress: { values: WEEK_ROWS[38]!, row_count: 3 } },
      }),
      trace: trace(id, versionId, [
        { stepId: "read_progress", tool: "read_sheet_range", args: report.steps[0]!.args, certainty: "confirmed", startedAt: at(created, 24), endedAt: at(created, 25), result: { row_count: 3 } },
      ]),
      events: events([
        statusEvent(created, "planning", null),
        [at(created, 12), "plan.ready", { workflow_version_id: versionId, version_no: 1, plan: plan("Báo cáo tiến độ tuần 38", report.prompt, report.steps), layers: [["read_progress"], ["append_report"], ["notify_team"]], attempts: 1 }],
        statusEvent(at(created, 24), "dry_running", "validating"),
        [at(created, 33), "dryrun.ready", { approval_id: approval.id, expires_at: approval.expires_at, read_count: 1, write_count: 2 }],
      ]),
      reconciliation: null,
    });
  }

  runs.push(reconcileRun(WORLD_IDS.reconcile, "not_observed"));
  runs.push(reconcileRun(WORLD_IDS.reconcileConfirmed, "confirmed"));
  runs.push(reconcileRun(WORLD_IDS.reconcileConflict, "conflict"));

  // Đang thực thi.
  {
    const id = WORLD_IDS.running;
    const prompt = "Chuyển các thẻ đã xong trên board_a sang cột Hoàn thành";
    const created = at(nowIso, -180);
    const steps: StepSpec[] = [
      { id: "list_done", description: "Liệt kê thẻ đã xong trên board_a", tool: "list_cards", args: { board_id: "board_a", list_name: "Đã xong" }, write: false },
      { id: "move_done", description: "Chuyển thẻ sang cột Hoàn thành", tool: "move_card", args: { card_id: "card_17", target_list: "Hoàn thành" }, write: true, dependsOn: ["list_done"] },
    ];
    const versionId = uuid(id.slice(0, 8), 2);
    runs.push({
      detail: detail({
        id,
        status: "running",
        prompt,
        createdAt: created,
        plan: plan("Dọn cột thẻ đã xong", prompt, steps),
        approval: approvalFor(id, versionId, "approved", at(created, 600), [
          { stepId: "move_done", tool: "move_card", args: { card_id: "card_17", target_list: "Hoàn thành" } },
        ]),
        lastSeq: 5,
      }),
      trace: trace(id, versionId, [
        { stepId: "list_done", tool: "list_cards", args: steps[0]!.args, certainty: "confirmed", startedAt: at(created, 20), endedAt: at(created, 21), result: { count: 1 } },
        { stepId: "move_done", tool: "move_card", args: steps[1]!.args, certainty: "before_dispatch", startedAt: at(nowIso, -5), endedAt: null },
      ]),
      events: events([
        statusEvent(created, "planning", null),
        statusEvent(at(created, 30), "awaiting_approval", "dry_running"),
        statusEvent(at(created, 90), "running", "awaiting_approval"),
        [at(created, 91), "step.succeeded", { step_id: "list_done", attempts: 1, duration_ms: 900, deduplicated: false }],
        [at(nowIso, -5), "step.started", { step_id: "move_done", description: "Chuyển thẻ sang cột Hoàn thành", tool: { server: "task_hub", name: "move_card" }, side_effect: "write", attempt_no: 1 }],
      ]),
      reconciliation: null,
    });
  }

  // Đang lập kế hoạch.
  {
    const id = WORLD_IDS.planning;
    const created = at(nowIso, -8);
    runs.push({
      detail: detail({ id, status: "planning", prompt: "Liệt kê thẻ đã xong tuần này trên board_a", createdAt: created, lastSeq: 1 }),
      trace: trace(id, null, []),
      events: events([statusEvent(created, "planning", null)]),
      reconciliation: null,
    });
  }

  // Hoàn tất — tuần 35.
  {
    const id = WORLD_IDS.succeeded;
    const report = weeklyReport(35);
    const created = "2026-09-09T02:10:00.000Z";
    const versionId = uuid(id.slice(0, 8), 2);
    const approval = approvalFor(id, versionId, "approved", at(created, 600), [
      { stepId: "append_report", tool: "append_sheet_rows", args: { spreadsheet_id: "bao-cao-tuan", sheet_name: "Báo cáo tuần", rows: WEEK_ROWS[35] } },
      { stepId: "notify_team", tool: "send_slack_message", args: { channel: "#nhom-ati", text: report.message } },
    ]);
    runs.push({
      detail: detail({ id, status: "succeeded", prompt: report.prompt, createdAt: created, plan: plan("Báo cáo tiến độ tuần 35", report.prompt, report.steps), approval, lastSeq: 6 }),
      trace: trace(id, versionId, [
        { stepId: "read_progress", tool: "read_sheet_range", args: report.steps[0]!.args, certainty: "confirmed", startedAt: at(created, 15), endedAt: at(created, 16), result: { row_count: 2 } },
        { stepId: "append_report", tool: "append_sheet_rows", args: approval.actions[0]!.resolved_args, certainty: "confirmed", startedAt: at(created, 120), endedAt: at(created, 121), result: { appended_count: 2 }, operationId: approval.actions[0]!.operation_id },
        { stepId: "notify_team", tool: "send_slack_message", args: approval.actions[1]!.resolved_args, certainty: "confirmed", startedAt: at(created, 122), endedAt: at(created, 123), result: { channel: "#nhom-ati" }, operationId: approval.actions[1]!.operation_id },
      ]),
      events: events([
        statusEvent(created, "planning", null),
        statusEvent(at(created, 30), "awaiting_approval", "dry_running"),
        statusEvent(at(created, 110), "running", "awaiting_approval"),
        [at(created, 121), "step.succeeded", { step_id: "append_report", attempts: 1, duration_ms: 800, deduplicated: false }],
        [at(created, 123), "step.succeeded", { step_id: "notify_team", attempts: 1, duration_ms: 600, deduplicated: false }],
        [at(created, 124), "run.finished", { status: "succeeded", duration_ms: 124_000, error_message: null, outputs: {} }],
      ]),
      reconciliation: null,
    });
  }

  // Hết hạn duyệt — tuần 36.
  {
    const id = WORLD_IDS.expired;
    const report = weeklyReport(36);
    const created = "2026-09-14T07:48:07.000Z";
    const versionId = uuid(id.slice(0, 8), 2);
    const approval = approvalFor(id, versionId, "expired", "2026-09-14T07:58:31.000Z", [
      { stepId: "append_report", tool: "append_sheet_rows", args: { spreadsheet_id: "bao-cao-tuan", sheet_name: "Báo cáo tuần", rows: WEEK_ROWS[36] } },
      { stepId: "notify_team", tool: "send_slack_message", args: { channel: "#nhom-ati", text: report.message } },
    ]);
    const prompt = "Chép tiến độ tuần 36 sang “Báo cáo tuần”";
    runs.push({
      detail: detail({ id, status: "expired", prompt, createdAt: created, plan: plan("Báo cáo tiến độ tuần 36", prompt, report.steps), approval, lastSeq: 4 }),
      trace: trace(id, versionId, [
        { stepId: "read_progress", tool: "read_sheet_range", args: report.steps[0]!.args, certainty: "confirmed", startedAt: at(created, 14), endedAt: at(created, 15), result: { row_count: 3 } },
      ]),
      events: events([
        statusEvent(created, "planning", null),
        statusEvent("2026-09-14T07:48:31.000Z", "awaiting_approval", "dry_running"),
        statusEvent("2026-09-14T07:58:31.000Z", "expired", "awaiting_approval"),
        ["2026-09-14T07:58:31.000Z", "run.finished", { status: "expired", duration_ms: null, error_message: null, outputs: {} }],
      ]),
      reconciliation: null,
    });
  }

  // Thất bại — kênh cũ không còn trong dữ liệu local.
  {
    const id = WORLD_IDS.failed;
    const prompt = "Gửi danh sách thẻ quá hạn vào kênh #thong-bao-cu";
    const created = "2026-09-14T10:05:10.000Z";
    const steps: StepSpec[] = [
      { id: "list_overdue", description: "Liệt kê thẻ quá hạn của board_a", tool: "list_cards", args: { board_id: "board_a", until: "2026-09-14" }, write: false },
      { id: "post_overdue", description: "Gửi danh sách vào kênh #thong-bao-cu", tool: "send_slack_message", args: { channel: "#thong-bao-cu", text: "4 thẻ quá hạn trên board_a" }, write: true, dependsOn: ["list_overdue"] },
    ];
    const versionId = uuid(id.slice(0, 8), 2);
    const approval = approvalFor(id, versionId, "approved", at(created, 600), [
      { stepId: "post_overdue", tool: "send_slack_message", args: { channel: "#thong-bao-cu", text: "4 thẻ quá hạn trên board_a" } },
    ]);
    const message = "Kênh “#thong-bao-cu” không có trong dữ liệu local.";
    runs.push({
      detail: detail({ id, status: "failed", prompt, createdAt: created, plan: plan("Báo thẻ quá hạn", prompt, steps), approval, lastSeq: 5 }),
      trace: trace(id, versionId, [
        { stepId: "list_overdue", tool: "list_cards", args: steps[0]!.args, certainty: "confirmed", startedAt: "2026-09-14T10:05:22.000Z", endedAt: "2026-09-14T10:05:23.000Z", result: { count: 4 } },
        { stepId: "post_overdue", tool: "send_slack_message", args: approval.actions[0]!.resolved_args, certainty: "known_not_applied", startedAt: "2026-09-14T10:05:29.000Z", endedAt: "2026-09-14T10:05:30.000Z", error: { cls: "bad_args", message: `CHANNEL_NOT_FOUND: ${message}` }, operationId: approval.actions[0]!.operation_id },
      ]),
      events: events([
        statusEvent(created, "planning", null),
        statusEvent("2026-09-14T10:05:20.000Z", "running", "awaiting_approval"),
        ["2026-09-14T10:05:23.000Z", "step.succeeded", { step_id: "list_overdue", attempts: 1, duration_ms: 700, deduplicated: false }],
        ["2026-09-14T10:05:30.000Z", "step.failed", { step_id: "post_overdue", attempts: 1, error_message: message, error_class: "bad_args", on_error: "fail" }],
        ["2026-09-14T10:05:31.000Z", "run.finished", { status: "failed", duration_ms: 21_000, error_message: message, outputs: {} }],
      ]),
      reconciliation: null,
      failure: { code: "CHANNEL_NOT_FOUND", message, stepId: "post_overdue" },
    });
  }

  // Cần bổ sung thông tin.
  {
    const id = WORLD_IDS.needsInput;
    const prompt = "Tạo thẻ nhắc hạn nộp slide cho từng thành viên";
    const created = "2026-09-16T04:12:05.000Z";
    runs.push({
      detail: detail({
        id,
        status: "needs_input",
        prompt,
        createdAt: created,
        planner: PlannerResultSchema.parse({ kind: "clarification", question: "Tạo thẻ trên board nào và hạn nộp là ngày nào?" }),
        lastSeq: 2,
      }),
      trace: trace(id, null, []),
      events: events([
        statusEvent(created, "planning", null),
        ["2026-09-16T04:12:18.000Z", "run.finished", { status: "needs_input", duration_ms: 13_000, error_message: null, outputs: {} }],
      ]),
      reconciliation: null,
      suggestedPrompt: "Tạo thẻ nhắc hạn nộp slide cho từng thành viên trên board_a, hạn 20/09/2026.",
    });
  }

  // Không thể lập kế hoạch.
  {
    const id = WORLD_IDS.refused;
    const created = "2026-09-14T03:20:01.000Z";
    runs.push({
      detail: detail({
        id,
        status: "refused",
        prompt: "Dịch tài liệu hướng dẫn sang tiếng Nhật",
        createdAt: created,
        planner: PlannerResultSchema.parse({ kind: "refusal", reason: "Không có công cụ dịch văn bản trong danh sách hiện có." }),
        lastSeq: 2,
      }),
      trace: trace(id, null, []),
      events: events([
        statusEvent(created, "planning", null),
        ["2026-09-14T03:20:09.000Z", "run.finished", { status: "refused", duration_ms: 8_000, error_message: null, outputs: {} }],
      ]),
      reconciliation: null,
    });
  }

  // Đã từ chối ghi.
  {
    const id = WORLD_IDS.rejected;
    const prompt = "Tạo thẻ “Nộp báo cáo giữa kỳ” trong Backlog cho nhóm";
    const created = "2026-09-12T08:30:00.000Z";
    const steps: StepSpec[] = [
      { id: "create_task", description: "Tạo thẻ “Nộp báo cáo giữa kỳ” trong Backlog", tool: "create_card", args: { board_id: "board_a", list_name: "Backlog", title: "Nộp báo cáo giữa kỳ" }, write: true },
    ];
    const versionId = uuid(id.slice(0, 8), 2);
    runs.push({
      detail: detail({
        id,
        status: "rejected",
        prompt,
        createdAt: created,
        plan: plan("Tạo thẻ báo cáo", prompt, steps),
        approval: approvalFor(id, versionId, "rejected", at(created, 600), [
          { stepId: "create_task", tool: "create_card", args: steps[0]!.args },
        ]),
        lastSeq: 3,
      }),
      trace: trace(id, versionId, []),
      events: events([
        statusEvent(created, "planning", null),
        statusEvent(at(created, 20), "awaiting_approval", "dry_running"),
        [at(created, 95), "run.finished", { status: "rejected", duration_ms: null, error_message: null, outputs: {} }],
      ]),
      reconciliation: null,
    });
  }

  // Keep last_seq honest: it always equals the number of synthetic events.
  for (const run of runs) {
    run.detail = RunDetailSchema.parse({ ...run.detail, last_seq: run.events.length });
  }

  runs.sort((a, b) =>
    (b.detail.created_at ?? "").localeCompare(a.detail.created_at ?? ""),
  );

  return {
    runs,
    checkedAt: at(nowIso, -40),
    servers: ServerSummaryListSchema.parse([
      { slug: "task_hub", status: "connected", policy_version: "b-local-1" },
      { slug: "filesystem", status: "disconnected", policy_version: null },
    ]),
  };
}
