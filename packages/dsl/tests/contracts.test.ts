import { expect, it } from "vitest";
import * as dsl from "../src/index.js";
const api = dsl as unknown as Record<string, any>;

it("does not expose an executable run without a version and plan", () => {
  const run = {
    run_id: "r",
    status: "planning",
    workflow_version_id: null,
    plan: null,
    planner_result: null,
    approval: null,
    time_zone: "Asia/Ho_Chi_Minh",
    runtime: {},
    last_seq: 0,
  };
  expect(dsl.RunDetailSchema.safeParse(run).success).toBe(true);
  expect(
    dsl.RunDetailSchema.safeParse({ ...run, status: "running" }).success,
  ).toBe(false);
});

it("trace exposes full immutable attempt snapshots and distinguishes incomplete legacy history", () => {
  expect(api.TraceSchema).toBeDefined();
  const trace = {
    run_id: "r",
    attempts: [
      {
        attempt_id: "a",
        step_id: "read",
        attempt_no: 1,
        workflow_version_id: "v1",
        evidence: "complete",
        tool_snapshot: {
          server: "hub",
          name: "read",
          policy_version: "1",
          artifact_hash: "a".repeat(64),
          input_schema: { type: "object" },
          output_schema: { type: "object" },
        },
        operation_id: null,
        resolved_args: {},
        result: { text: "full output" },
        outcome_certainty: "confirmed",
        error_class: null,
        error_message: null,
        started_at: "2026-09-13T00:00:00Z",
        ended_at: "2026-09-13T00:00:01Z",
      },
    ],
    next_cursor: null,
  };
  expect(api.TraceSchema.safeParse(trace).success).toBe(true);
  const attempt = trace.attempts[0]!;
  expect(
    api.TraceSchema.safeParse({
      ...trace,
      attempts: [{ ...attempt, tool_snapshot: null }],
    }).success,
  ).toBe(false);
  expect(
    api.TraceSchema.safeParse({
      ...trace,
      attempts: [
        {
          ...attempt,
          evidence: "legacy_unknown",
          tool_snapshot: null,
          workflow_version_id: null,
          outcome_certainty: null,
        },
      ],
    }).success,
  ).toBe(true);
});
