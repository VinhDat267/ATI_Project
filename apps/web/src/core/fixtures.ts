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

export interface FixtureTransport extends Transport {
  readonly runId: string;
  readonly calls: FixtureCall[];
}

export function createFixtureTransport(
  requestedStatus?: string,
): FixtureTransport {
  const statusResult = RunStatusSchema.safeParse(requestedStatus ?? "planning");
  const status: RunStatus = statusResult.success
    ? statusResult.data
    : "planning";
  let currentStatus = status;
  const calls: FixtureCall[] = [];
  const record = (method: FixtureCall["method"], path: string): void => {
    calls.push({ method, path });
  };
  const detail = (): RunDetail => createFixtureScenario(currentStatus);

  return {
    runId: FIXTURE_RUN_ID,
    calls,
    async login(email, password, signal) {
      record("POST", "/auth/login");
      LoginRequestSchema.parse({ email, password });
      return resolveWithSignal("fixture-session-token", signal);
    },
    async list(signal) {
      record("GET", "/runs");
      return resolveFactoryWithSignal(
        () => [RunDetailSchema.parse(detail())],
        signal,
      );
    },
    async servers(signal) {
      record("GET", "/servers");
      return resolveFactoryWithSignal(
        () =>
          ServerSummaryListSchema.parse([
            {
              slug: "task_hub",
              status: "connected",
              policy_version: "b-local-1",
            },
            {
              slug: "filesystem",
              status: "disconnected",
              policy_version: null,
            },
          ]),
        signal,
      );
    },
    async create(input: CreateInput, signal) {
      record("POST", "/runs");
      const parsed = CreateRunSchema.parse(input);
      void parsed;
      currentStatus = "planning";
      return resolveFactoryWithSignal(
        () =>
          RunAcceptedSchema.parse({
            run_id: FIXTURE_RUN_ID,
            status: "planning",
          }),
        signal,
      );
    },
    async detail(id, signal) {
      record("GET", `/runs/${id}`);
      if (id !== FIXTURE_RUN_ID) {
        throw new Error("Synthetic run not found");
      }
      return resolveFactoryWithSignal(detail, signal);
    },
    async events(id, since, signal) {
      record("GET", `/runs/${id}/events?since_seq=${since}`);
      if (id !== FIXTURE_RUN_ID) {
        throw new Error("Synthetic run not found");
      }
      return resolveFactoryWithSignal(
        () =>
          EventPageSchema.parse({ events: [], next_seq: detail().last_seq }),
        signal,
      );
    },
    async decide(id, input: DecisionInput, signal) {
      record("POST", `/runs/${id}/approval`);
      if (id !== FIXTURE_RUN_ID) {
        throw new Error("Synthetic run not found");
      }
      ApprovalDecisionSchema.parse(input);
      currentStatus = input.decision === "approved" ? "running" : "rejected";
      return resolveFactoryWithSignal(detail, signal);
    },
    async cancel(id, signal) {
      record("POST", `/runs/${id}/cancel`);
      if (id !== FIXTURE_RUN_ID) {
        throw new Error("Synthetic run not found");
      }
      currentStatus = "cancelled";
      await resolveWithSignal(undefined, signal);
    },
    async trace(id, cursor, signal) {
      record("GET", `/runs/${id}/trace${cursor ? `?cursor=${cursor}` : ""}`);
      if (id !== FIXTURE_RUN_ID) {
        throw new Error("Synthetic run not found");
      }
      return resolveFactoryWithSignal(
        () =>
          TraceSchema.parse({
            run_id: FIXTURE_RUN_ID,
            attempts: [],
            next_cursor: null,
          }),
        signal,
      );
    },
    async reconciliation(id, signal) {
      record("GET", `/runs/${id}/reconciliation`);
      if (id !== FIXTURE_RUN_ID) {
        throw new Error("Synthetic run not found");
      }
      return resolveFactoryWithSignal(
        () =>
          ReconciliationSchema.parse({
            run_id: FIXTURE_RUN_ID,
            read_only: true,
            operations: [],
          }),
        signal,
      );
    },
  };
}
