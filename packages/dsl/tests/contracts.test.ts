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

it("strictly validates the authenticated local identity contract", () => {
  expect(
    dsl.AuthMeSchema.safeParse({
      user_id: "00000000-0000-4000-8000-000000000001",
      email: "user@example.local",
      display_name: "User",
      roles: ["user"],
    }).success,
  ).toBe(true);
  expect(
    dsl.AuthMeSchema.safeParse({
      user_id: "not-a-uuid",
      email: "user@example.local",
      display_name: null,
      roles: ["operator"],
      unexpected: true,
    }).success,
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

it("exports strict local login and error envelopes for the HTTP adapter", () => {
  expect(
    dsl.LoginRequestSchema.safeParse({ email: "demo@local", password: "x" })
      .success,
  ).toBe(true);
  expect(
    dsl.LoginRequestSchema.safeParse({
      email: "demo@local",
      password: "x",
      user_id: "caller",
    }).success,
  ).toBe(false);
  expect(dsl.LoginResponseSchema.safeParse({ token: "opaque" }).success).toBe(
    true,
  );
  expect(
    dsl.ApiErrorSchema.safeParse({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication required",
        request_id: "00000000-0000-4000-8000-000000000001",
      },
    }).success,
  ).toBe(true);
});

it("keeps additive read-model fields optional for legacy CLI detail payloads", () => {
  const legacy = {
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
  expect(dsl.RunDetailSchema.safeParse(legacy).success).toBe(true);
  expect(
    dsl.RunDetailSchema.safeParse({
      ...legacy,
      source_prompt: "copy files",
      created_at: "2026-09-15T00:00:00.000Z",
      read_outputs: { read_source: { files: ["a.txt"] } },
    }).success,
  ).toBe(true);
});

it("exposes a strict read-only reconciliation projection", () => {
  expect(api.ReconciliationSchema).toBeDefined();
  const reconciliation = {
    run_id: "r",
    read_only: true,
    operations: [
      {
        operation_id: "op-1",
        step_id: "write",
        state: "unknown",
        receiver_mode: "non_idempotent",
        receipt: "not_observed",
        result: null,
        dispatch_marker: "absent",
      },
    ],
  };
  expect(api.ReconciliationSchema.safeParse(reconciliation).success).toBe(true);
  expect(
    api.ReconciliationSchema.safeParse({
      ...reconciliation,
      read_only: false,
    }).success,
  ).toBe(false);
});

it("keeps the reviewed server catalog ordered and strict", () => {
  const catalog = [
    {
      slug: "task_hub",
      status: "connected",
      policy_version: "b-local-1",
      observed_at: "2026-09-17T00:00:00.000Z",
      tools: [
        {
          server: "task_hub",
          name: "list_cards",
          side_effect: "read",
          policy_version: "b-local-1",
          artifact_hash: "a".repeat(64),
          input_schema: { type: "object" },
          output_schema: { type: "object" },
        },
      ],
    },
    {
      slug: "filesystem",
      status: "disconnected",
      policy_version: "b-local-fs-1",
      observed_at: "2026-09-17T00:00:00.000Z",
      tools: [],
    },
  ];
  expect(api.ServerCatalogSchema.parse(catalog)).toEqual(catalog);
  expect(
    api.ServerCatalogSchema.safeParse([...catalog.slice(1), catalog[0]])
      .success,
  ).toBe(false);
  expect(
    api.ServerCatalogSchema.safeParse(
      catalog.map((entry) => ({ ...entry, canary: "secret" })),
    ).success,
  ).toBe(false);
  expect(
    api.ServerCatalogSchema.safeParse(
      catalog.map((entry) => ({
        ...entry,
        tools: entry.tools.map((tool) => ({ ...tool, canary: "secret" })),
      })),
    ).success,
  ).toBe(false);
  const reviewedTool = catalog[0]!.tools[0]!;
  expect(
    api.ServerCatalogEntrySchema.safeParse({
      ...catalog[0],
      tools: [],
    }).success,
  ).toBe(false);
  expect(
    api.ServerCatalogEntrySchema.safeParse({
      ...catalog[0],
      policy_version: null,
    }).success,
  ).toBe(false);
  expect(
    api.ServerCatalogEntrySchema.safeParse({
      ...catalog[0],
      tools: [
        reviewedTool,
        { ...reviewedTool, name: "get_card", policy_version: "other" },
      ],
    }).success,
  ).toBe(false);
  expect(
    api.ServerCatalogEntrySchema.safeParse({
      ...catalog[0],
      tools: [{ ...reviewedTool, server: "filesystem" }],
    }).success,
  ).toBe(false);
  expect(
    api.ServerCatalogToolSchema.safeParse({
      ...reviewedTool,
      input_schema: { invalid: () => undefined },
    }).success,
  ).toBe(false);
  expect(
    api.ServerCatalogEntrySchema.safeParse({
      ...catalog[0],
      status: "disconnected",
    }).success,
  ).toBe(false);
});
