import { describe, it, expect } from "vitest";
import {
  RunDetailSchema,
  CreateRunSchema,
  ApprovalDecisionSchema,
  EventPageSchema,
  TraceSchema,
  ReconciliationSchema,
  ServerSummaryListSchema,
  WorkflowPlanSchema,
  RunStatusSchema,
  type RunStatus,
} from "@wap/dsl/browser";

describe("@wap/dsl/browser exports and schemas", () => {
  it("exports browser-safe contracts without leaking server internals", () => {
    expect(RunDetailSchema).toBeDefined();
    expect(CreateRunSchema).toBeDefined();
    expect(ApprovalDecisionSchema).toBeDefined();
    expect(EventPageSchema).toBeDefined();
    expect(TraceSchema).toBeDefined();
    expect(ReconciliationSchema).toBeDefined();
    expect(ServerSummaryListSchema).toBeDefined();
    expect(WorkflowPlanSchema).toBeDefined();
    expect(RunStatusSchema).toBeDefined();
  });

  it("parses valid RunDetail sample correctly", () => {
    const validRun = {
      run_id: "00000000-0000-4000-8000-000000000001",
      status: "planning" as RunStatus,
      workflow_version_id: null,
      plan: null,
      planner_result: null,
      approval: null,
      time_zone: "Asia/Ho_Chi_Minh",
      runtime: {},
      last_seq: 1,
      source_prompt: "Demo prompt",
      created_at: "2026-09-15T08:00:00.000Z",
      read_outputs: {},
    };

    const parsed = RunDetailSchema.parse(validRun);
    expect(parsed.run_id).toBe("00000000-0000-4000-8000-000000000001");
    expect(parsed.status).toBe("planning");
  });

  it("rejects invalid RunDetail payload with ZodError", () => {
    const invalidRun = {
      run_id: "invalid-uuid",
      status: "non-existent-status",
    };

    expect(() => RunDetailSchema.parse(invalidRun)).toThrow();
  });

  it("parses valid CreateRunSchema input", () => {
    const input = {
      source_prompt: "Chép dữ liệu sang báo cáo",
      inputs: {},
      time_zone: "Asia/Ho_Chi_Minh",
    };

    const parsed = CreateRunSchema.parse(input);
    expect(parsed.source_prompt).toBe("Chép dữ liệu sang báo cáo");
    expect(parsed.time_zone).toBe("Asia/Ho_Chi_Minh");
  });

  it("parses valid ApprovalDecisionSchema input", () => {
    const input = {
      approval_id: "33333333-3333-4333-8333-333333333333",
      workflow_version_id: "22222222-2222-4222-8222-222222222222",
      snapshot_hash: "a".repeat(64),
      decision: "approved" as const,
    };

    const parsed = ApprovalDecisionSchema.parse(input);
    expect(parsed.decision).toBe("approved");
    expect(parsed.snapshot_hash).toHaveLength(64);
  });

  it("rejects approval decision with invalid hash length", () => {
    const input = {
      approval_id: "33333333-3333-4333-8333-333333333333",
      workflow_version_id: "22222222-2222-4222-8222-222222222222",
      snapshot_hash: "short-hash",
      decision: "approved",
    };

    expect(() => ApprovalDecisionSchema.parse(input)).toThrow();
  });
});
