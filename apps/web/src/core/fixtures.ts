import {
  ApprovalDecisionSchema,
  CreateRunSchema,
  EventPageSchema,
  LoginRequestSchema,
  PlannerResultSchema,
  ReconciliationSchema,
  RunAcceptedSchema,
  RunDetailSchema,
  RunStatusSchema,
  ServerSummaryListSchema,
  TraceSchema,
  WorkflowPlanSchema,
  type RunStatus,
} from "@wap/dsl/browser";
import type {
  CreateInput,
  DecisionInput,
  FixtureCall,
  RunAccepted,
  RunDetail,
  Servers,
  Transport,
} from "./contracts.js";
import type {
  PilotApproveInput,
  PilotApproveResponse,
  PilotCatalogResponse,
  PilotCheckInput,
  PilotCheckResponse,
  PilotCreateRunInput,
  PilotCreateRunResponse,
  PilotLookupInput,
  PilotLookupResponse,
  PilotRunDetailResponse,
} from "./pilot-contracts.js";
import { createWorld, WORLD_IDS, type WorldRun } from "../fixtures/world.js";

export const FIXTURE_RUN_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const FIXTURE_APPROVAL_ID = "33333333-3333-4333-8333-333333333333";
const FIXTURE_OPERATION_ID = "44444444-4444-4444-8444-444444444444";
const FIXTURE_HASH = "a".repeat(64);

const fullPlan = WorkflowPlanSchema.parse({
  version: "1.0",
  name: "Báo cáo tiến độ tuần",
  source_prompt: "Đọc bảng tiến độ và chuẩn bị báo cáo local.",
  inputs: {},
  steps: [
    {
      id: "read_progress",
      description: "Đọc các dòng tiến độ trong bảng nguồn",
      tool: {
        server: "task_hub",
        name: "list_cards",
        args: { board_id: "demo-board" },
      },
      depends_on: [],
      condition: null,
      retry: { max_attempts: 3, backoff: "exponential", initial_delay_ms: 500 },
      idempotency_key: null,
      side_effect: "read",
      on_error: "fail",
      timeout_ms: 30_000,
    },
    {
      id: "write_report",
      description: "Ghi bản sao vào bảng báo cáo local",
      tool: {
        server: "task_hub",
        name: "create_card",
        args: { board_id: "report-board", title: "${runtime.today}" },
      },
      depends_on: ["read_progress"],
      condition: null,
      retry: { max_attempts: 3, backoff: "exponential", initial_delay_ms: 500 },
      idempotency_key: "fixture-write-report",
      side_effect: "write",
      on_error: "fail",
      timeout_ms: 30_000,
    },
  ],
  outputs: { report_id: "${steps.write_report.id}" },
});

const plannerDraft = {
  version: "1.0" as const,
  name: fullPlan.name,
  source_prompt: fullPlan.source_prompt,
  inputs: {},
  steps: fullPlan.steps.map((step) => ({
    id: step.id,
    description: step.description,
    tool: step.tool,
    depends_on: step.depends_on,
    condition: step.condition,
    idempotency_key: step.idempotency_key,
    side_effect: step.side_effect,
    on_error: step.on_error,
  })),
  outputs: fullPlan.outputs,
};

const plannerPlan = PlannerResultSchema.parse({
  kind: "plan",
  plan: plannerDraft,
});

const approval = {
  id: FIXTURE_APPROVAL_ID,
  run_id: FIXTURE_RUN_ID,
  workflow_version_id: FIXTURE_VERSION_ID,
  snapshot_hash: FIXTURE_HASH,
  decision: "pending" as const,
  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  actions: [
    {
      step_id: "write_report",
      operation_id: FIXTURE_OPERATION_ID,
      server: "task_hub",
      tool: "create_card",
      policy_version: "b-local-1",
      resolved_args: { board_id: "report-board", title: "2026-09-15" },
      payload_hash: FIXTURE_HASH,
    },
  ],
};

const hasPlan = (status: RunStatus): boolean =>
  !["planning", "validating", "refused", "needs_input"].includes(status);

export function createFixtureScenario(status: RunStatus): RunDetail {
  const parsedStatus = RunStatusSchema.parse(status);
  const executable = hasPlan(parsedStatus);
  const plannerOutcome =
    parsedStatus === "refused"
      ? PlannerResultSchema.parse({
          kind: "refusal",
          reason:
            "Fixture chỉ minh họa công việc được phép trong phạm vi local.",
        })
      : parsedStatus === "needs_input"
        ? PlannerResultSchema.parse({
            kind: "clarification",
            question: "Bạn muốn dùng bảng nguồn nào cho báo cáo?",
          })
        : parsedStatus === "planning" || parsedStatus === "validating"
          ? null
          : plannerPlan;

  const detail = {
    run_id: FIXTURE_RUN_ID,
    status: parsedStatus,
    workflow_version_id: executable ? FIXTURE_VERSION_ID : null,
    plan: executable ? fullPlan : null,
    planner_result: plannerOutcome,
    approval:
      parsedStatus === "awaiting_approval"
        ? approval
        : parsedStatus === "rejected" || parsedStatus === "expired"
          ? { ...approval, decision: parsedStatus }
          : null,
    time_zone: "Asia/Ho_Chi_Minh",
    runtime: { today: "2026-09-15", now: "2026-09-15T08:00:00.000Z" },
    last_seq: parsedStatus === "planning" ? 1 : 3,
    source_prompt: fullPlan.source_prompt,
    created_at: "2026-09-15T08:00:00.000Z",
    read_outputs: { rows: 2 },
  };
  return RunDetailSchema.parse(detail);
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function resolveWithSignal<T>(value: T, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    queueMicrotask(() => {
      if (signal.aborted) {
        reject(abortError());
      } else {
        resolve(value);
      }
    });
  });
}

function resolveFactoryWithSignal<T>(
  factory: () => T,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  return resolveWithSignal(factory(), signal);
}

export interface FixtureHints {
  /** Planner suggestion shown on needs_input runs (fixture-only data). */
  suggestedPrompt(runId: string): string | null;
}

export interface FixtureTransport extends Transport, FixtureHints {
  readonly runId: string;
  readonly calls: FixtureCall[];
}

function notFound(): Error {
  return new Error("Synthetic run not found");
}

/**
 * Synthetic transport over the multi-run fixture world. A valid `scenario`
 * status (?scenario=… in the fixture build) adds the legacy single-run
 * scenario under FIXTURE_RUN_ID so earlier checks keep their meaning.
 */
export function createFixtureTransport(
  requestedStatus?: string,
): FixtureTransport {
  const world = createWorld(new Date());
  const runs: WorldRun[] = [...world.runs];
  const statusResult = RunStatusSchema.safeParse(requestedStatus);
  if (statusResult.success) {
    runs.unshift({
      detail: createFixtureScenario(statusResult.data),
      trace: TraceSchema.parse({
        run_id: FIXTURE_RUN_ID,
        attempts: [],
        next_cursor: null,
      }),
      events: [],
      reconciliation: null,
    });
  }
  const calls: FixtureCall[] = [];
  const record = (method: FixtureCall["method"], path: string): void => {
    calls.push({ method, path });
  };
  const find = (id: string): WorldRun => {
    const run = runs.find((candidate) => candidate.detail.run_id === id);
    if (!run) throw notFound();
    return run;
  };
  let created = 0;
  let createdPilot = 0;
  const pilotRuns = new Map<string, PilotRunDetailResponse>();
  const samplePilotId = "pilot-sample-01";
  pilotRuns.set(samplePilotId, {
    id: samplePilotId,
    runId: samplePilotId,
    userId: "00000000-0000-4000-8000-000000000001",
    profile: "pilot-v2",
    status: "awaiting_approval",
    sourceKey: "sheet-pilot-001/tab-001/REQ-2026-001",
    sourceRevision: "rev-fixture-01",
    sourceSnapshot: {
      requestId: "REQ-2026-001",
      clientRef: "CR-9042",
      requestType: "task_create",
      rawRequest: "Tạo thẻ công việc hoàn thiện báo cáo tài chính Q3 trên Trello",
      deliverable: "Thẻ Trello kèm deadline",
      dueDate: "2026-10-05",
      decisionStatus: "confirmed",
    },
    checklistResult: {
      valid: true,
      unconfirmedBusiness: false,
      missingFields: [],
      summary: "Yêu cầu đầy đủ thông tin, đã qua thẩm định tự động.",
    },
    preview: {
      snapshotHash: "b".repeat(64),
      actions: [
        {
          tool: "trello.create_card",
          sideEffect: "write",
          args: {
            boardId: "board-pilot-01",
            listName: "Cần làm",
            title: "[REQ-2026-001] Hoàn thiện báo cáo tài chính Q3",
            desc: "Yêu cầu tự động trích xuất từ bảng tính Google Sheets.",
            due: "2026-10-05T17:00:00.000Z",
          },
        },
      ],
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    },
    receipt: null,
    accounting: {
      inputTokens: 1250,
      outputTokens: 380,
      costMicroUsd: 450,
    },
    clarificationQuestion: null,
    refusalReason: null,
    error: null,
    createdAt: new Date().toISOString(),
    endedAt: null,
  });

  return {
    runId: statusResult.success ? FIXTURE_RUN_ID : WORLD_IDS.approval,
    calls,
    suggestedPrompt(runId) {
      return (
        runs.find((run) => run.detail.run_id === runId)?.suggestedPrompt ?? null
      );
    },
    async login(email, password, signal) {
      record("POST", "/auth/login");
      LoginRequestSchema.parse({ email, password });
      return resolveWithSignal("fixture-session-token", signal);
    },
    async me(signal) {
      record("GET", "/auth/me");
      return resolveWithSignal(
        {
          user_id: "00000000-0000-4000-8000-000000000001",
          email: "demo@local.invalid",
          display_name: "Demo local",
          roles: ["user"],
        },
        signal,
      );
    },
    async logout(signal) {
      record("POST", "/auth/logout");
      await resolveWithSignal(undefined, signal);
    },
    startOidcLogin() {
      throw new Error("OIDC chỉ dành cho live transport");
    },
    async list(signal) {
      record("GET", "/runs");
      return resolveFactoryWithSignal(
        () => runs.map((run) => RunDetailSchema.parse(run.detail)),
        signal,
      );
    },
    async servers(signal) {
      record("GET", "/servers");
      return resolveFactoryWithSignal(
        () => ServerSummaryListSchema.parse(world.servers),
        signal,
      );
    },
    async create(input: CreateInput, signal) {
      record("POST", "/runs");
      const parsed = CreateRunSchema.parse(input);
      created += 1;
      const id = `e5a0c7d3-0000-4000-8000-${String(created).padStart(12, "0")}`;
      const now = new Date().toISOString();
      runs.unshift({
        detail: RunDetailSchema.parse({
          run_id: id,
          status: "planning",
          workflow_version_id: null,
          plan: null,
          planner_result: null,
          approval: null,
          time_zone: parsed.time_zone,
          runtime: { today: now.slice(0, 10), now },
          last_seq: 0,
          source_prompt: parsed.source_prompt,
          created_at: now,
          read_outputs: {},
        }),
        trace: TraceSchema.parse({
          run_id: id,
          attempts: [],
          next_cursor: null,
        }),
        events: [],
        reconciliation: null,
      });
      return resolveFactoryWithSignal(
        () => RunAcceptedSchema.parse({ run_id: id, status: "planning" }),
        signal,
      );
    },
    async detail(id, signal) {
      record("GET", `/runs/${id}`);
      const run = find(id);
      return resolveFactoryWithSignal(
        () => RunDetailSchema.parse(run.detail),
        signal,
      );
    },
    async events(id, since, signal) {
      record("GET", `/runs/${id}/events?since_seq=${since}`);
      const run = find(id);
      return resolveFactoryWithSignal(
        () =>
          EventPageSchema.parse({
            events: run.events.filter((event) => event.seq > since),
            next_seq: Math.max(since, run.events.length),
          }),
        signal,
      );
    },
    async decide(id, input: DecisionInput, signal) {
      record("POST", `/runs/${id}/approval`);
      const run = find(id);
      ApprovalDecisionSchema.parse(input);
      const approval = run.detail.approval;
      if (
        run.detail.status !== "awaiting_approval" ||
        !approval ||
        approval.id !== input.approval_id ||
        approval.snapshot_hash !== input.snapshot_hash ||
        approval.workflow_version_id !== input.workflow_version_id
      ) {
        throw new Error("Synthetic approval conflict");
      }
      run.detail = RunDetailSchema.parse({
        ...run.detail,
        status: input.decision === "approved" ? "running" : "rejected",
        approval: { ...approval, decision: input.decision },
      });
      return resolveFactoryWithSignal(() => run.detail, signal);
    },
    async cancel(id, signal) {
      record("POST", `/runs/${id}/cancel`);
      const run = find(id);
      run.detail = RunDetailSchema.parse({
        ...run.detail,
        status: "cancelled",
      });
      await resolveWithSignal(undefined, signal);
    },
    async trace(id, cursor, signal) {
      record("GET", `/runs/${id}/trace${cursor ? `?cursor=${cursor}` : ""}`);
      const run = find(id);
      return resolveFactoryWithSignal(
        () => TraceSchema.parse(run.trace),
        signal,
      );
    },
    async reconciliation(id, signal) {
      record("GET", `/runs/${id}/reconciliation`);
      const run = find(id);
      return resolveFactoryWithSignal(
        () =>
          ReconciliationSchema.parse(
            run.reconciliation ?? {
              run_id: id,
              read_only: true,
              operations: [],
            },
          ),
        signal,
      );
    },

    async createPilotRun(input, signal) {
      record("POST", "/pilot/v2/runs");
      const runId = `pilot-run-${++createdPilot}`;
      const previewHash = "b".repeat(64);
      const expiresAt = new Date(Date.now() + 600000).toISOString();
      const detail: PilotRunDetailResponse = {
        id: runId,
        runId,
        userId: "00000000-0000-4000-8000-000000000001",
        profile: "pilot-v2",
        status: "awaiting_approval",
        sourceKey: `${input.spreadsheetId}/${input.tabId}/${input.requestId}`,
        sourceRevision: "rev-fixture-01",
        sourceSnapshot: {
          requestId: input.requestId,
          clientRef: "CR-AUTO",
          requestType: "task_create",
          rawRequest: input.userPrompt,
          deliverable: "Thẻ công việc",
          dueDate: "2026-10-01",
          decisionStatus: "confirmed",
        },
        checklistResult: {
          valid: true,
          unconfirmedBusiness: false,
          missingFields: [],
          summary: "Yêu cầu hợp lệ và đã qua kiểm tra checklist.",
        },
        preview: {
          snapshotHash: previewHash,
          actions: [
            {
              tool: "trello.create_card",
              sideEffect: "write",
              args: {
                boardId: "board-pilot-01",
                listName: "Cần làm",
                title: `[${input.requestId}] ${input.userPrompt.slice(0, 50)}`,
                desc: input.userPrompt,
                due: "2026-10-01T17:00:00.000Z",
              },
            },
          ],
          expiresAt,
        },
        receipt: null,
        accounting: {
          inputTokens: 1100,
          outputTokens: 320,
          costMicroUsd: 390,
        },
        clarificationQuestion: null,
        refusalReason: null,
        error: null,
        createdAt: new Date().toISOString(),
        endedAt: null,
      };
      pilotRuns.set(runId, detail);
      return resolveWithSignal(
        {
          runId,
          status: "awaiting_approval",
          preview: detail.preview ?? undefined,
          snapshotHash: previewHash,
          expiresAt,
        },
        signal,
      );
    },

    async getPilotRun(id, signal) {
      record("GET", `/pilot/v2/runs/${id}`);
      const run = pilotRuns.get(id);
      if (!run) throw notFound();
      return resolveWithSignal(run, signal);
    },

    async approvePilotRun(id, input, signal) {
      record("POST", `/pilot/v2/runs/${id}/approve`);
      const run = pilotRuns.get(id);
      if (!run) throw notFound();
      if (input.decision === "approved") {
        run.status = "succeeded";
        run.endedAt = new Date().toISOString();
        run.receipt = {
          cardId: `trello-card-${Date.now()}`,
          url: "https://trello.com/c/fixture-confirmed-card",
          listId: "list-fixture-todo",
          boardId: "board-pilot-01",
          confirmedAt: new Date().toISOString(),
        };
        return resolveWithSignal(
          {
            status: "succeeded",
            receipt: run.receipt,
          },
          signal,
        );
      }
      run.status = "rejected";
      run.endedAt = new Date().toISOString();
      return resolveWithSignal({ status: "rejected" }, signal);
    },

    async getPilotCatalog(signal) {
      record("GET", "/pilot/v2/catalog");
      return resolveWithSignal(
        {
          profile: "pilot-v2",
          tools: [
            {
              name: "google_sheets.read_rows",
              description: "Đọc dòng dữ liệu từ Google Sheets trong phạm vi đã phê duyệt",
              sideEffect: "read",
            },
            {
              name: "trello.get_card",
              description: "Tra cứu thông tin và trạng thái thẻ công việc trên Trello",
              sideEffect: "read",
            },
            {
              name: "trello.create_card",
              description: "Tạo thẻ công việc mới trên bảng Trello chỉ định (Cần duyệt)",
              sideEffect: "write",
            },
          ],
        },
        signal,
      );
    },

    async checkPilotRequest(input, signal) {
      record("POST", "/pilot/v2/check");
      return resolveWithSignal(
        {
          status: "checked",
          sourceKey: `${input.spreadsheetId}/${input.tabId}/${input.requestId}`,
          sourceRevision: "rev-fixture-01",
          checklistResult: {
            valid: true,
            unconfirmedBusiness: false,
            missingFields: [],
            conflicts: [],
            evidences: { request_id: input.requestId },
            summary: "Checklist hợp lệ.",
          },
          summary: "Yêu cầu đạt tiêu chuẩn xử lý.",
          clarificationQuestion: null,
          refusalReason: null,
        },
        signal,
      );
    },

    async lookupPilotCard(input, signal) {
      record("POST", "/pilot/v2/lookup");
      return resolveWithSignal(
        {
          status: "found",
          sourceKey: `${input.spreadsheetId}/${input.tabId}/${input.requestId}`,
          card: {
            id: "card-fixture-lookup",
            name: `Thẻ ${input.requestId}`,
            description: "Thẻ đã được tìm thấy trên Trello",
            listId: "list-fixture-todo",
            due: null,
            members: [],
            url: "https://trello.com/c/fixture-lookup-card",
          },
        },
        signal,
      );
    },
  };
}
