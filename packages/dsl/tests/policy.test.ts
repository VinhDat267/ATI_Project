import { expect, it } from "vitest";
import * as dsl from "../src/index.js";
const api = dsl as unknown as Record<string, any>;
const tool = {
  server: "hub",
  name: "send",
  sideEffect: "write",
  policyVersion: "1",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  },
};
it("accepts valid UUID formats from reviewed MCP schemas and rejects invalid UUIDs", () => {
  const uuidTool = {
    ...tool,
    sideEffect: "read" as const,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", format: "uuid" } },
      required: ["id"],
      additionalProperties: false,
    },
  };
  expect(
    dsl.validateToolCall(
      uuidTool,
      { id: "00000000-0000-4000-8000-000000000001" },
      "execution",
    ).ok,
  ).toBe(true);
  expect(
    dsl.validateToolCall(uuidTool, { id: "not-a-uuid" }, "execution").ok,
  ).toBe(false);
});
const make = (
  sideEffect = "write",
  args: Record<string, unknown> = { text: "hello" },
) =>
  dsl.WorkflowPlanSchema.parse({
    version: "1.0",
    name: "send",
    source_prompt: "send",
    inputs: { message: { type: "string", required: true } },
    steps: [
      {
        id: "send",
        description: "send",
        side_effect: sideEffect,
        idempotency_key:
          sideEffect === "write" ? "${runtime.run_id}_send" : null,
        tool: { server: "hub", name: "send", args },
      },
    ],
  });
it("blocks a forged read label and an unreviewed tool before preview", () => {
  expect(api.validatePlanTools).toBeTypeOf("function");
  expect(api.validatePlanTools(make("read"), [tool]).ok).toBe(false);
  expect(api.validatePlanTools(make(), []).ok).toBe(false);
  expect(api.validatePlanTools(make(), [tool]).ok).toBe(true);
});
it("validates literal arguments and explicitly defers unknown references", () => {
  expect(api.validatePlanTools).toBeTypeOf("function");
  expect(api.validatePlanTools(make("write", { text: 42 }), [tool]).ok).toBe(
    false,
  );
  const result = api.validatePlanTools(
    make("write", { text: "${inputs.message}" }),
    [tool],
  );
  expect(result.ok).toBe(true);
  expect(result.deferredStepIds).toEqual(["send"]);
});
it("blocks wrong resolved arguments and denies writes in dry-run independently of the plan label", () => {
  expect(api.validateToolCall).toBeTypeOf("function");
  expect(api.validateToolCall(tool, { text: "hello" }, "dry_run").ok).toBe(
    false,
  );
  expect(api.validateToolCall(tool, { text: 42 }, "execution").ok).toBe(false);
  expect(api.validateToolCall(tool, { text: "hello" }, "execution").ok).toBe(
    true,
  );
});
it("rejects data dependencies on unexecuted writes in a single-preview workflow", () => {
  expect(api.validatePlanTools).toBeTypeOf("function");
  const p = make();
  p.steps.push({
    ...p.steps[0]!,
    id: "send_again",
    depends_on: ["send"],
    tool: {
      server: "hub",
      name: "send",
      args: { text: "${steps.send.output.id}" },
    },
  });
  expect(api.validatePlanTools(p, [tool]).ok).toBe(false);
});
it("rejects continue outside profile B before scheduling", () => {
  const p = make();
  p.steps[0]!.on_error = "continue";
  expect(api.validatePlanTools(p, [tool]).ok).toBe(false);
});
it("enforces B retry limits before persisting an executable plan", () => {
  const p = make("read");
  const readTool = { ...tool, sideEffect: "read" };
  p.steps[0]!.retry.max_attempts = 10;
  expect(api.validatePlanTools(p, [readTool]).ok).toBe(false);
  p.steps[0]!.retry.max_attempts = 3;
  p.steps[0]!.retry.backoff = "fixed";
  expect(api.validatePlanTools(p, [readTool]).ok).toBe(false);
});
it("treats MCP isError and wrong output types as failed calls even on protocol success", () => {
  expect(api.normalizeToolResult).toBeTypeOf("function");
  expect(
    api.normalizeToolResult(tool, {
      isError: true,
      content: [],
      structuredContent: { id: "x" },
    }).ok,
  ).toBe(false);
  expect(
    api.normalizeToolResult(tool, { content: [], structuredContent: { id: 1 } })
      .ok,
  ).toBe(false);
  expect(
    api.normalizeToolResult(tool, {
      content: [{ type: "text", text: '{"id":"x"}' }],
    }).ok,
  ).toBe(false);
  expect(
    api.normalizeToolResult(tool, {
      content: [],
      structuredContent: { id: "x" },
    }),
  ).toEqual({ ok: true, output: { id: "x" } });
});
it("invalidates an approval after a version/snapshot change or expiration", () => {
  expect(api.approvalMatches).toBeTypeOf("function");
  const approval = {
    id: "a",
    run_id: "r",
    workflow_version_id: "v1",
    snapshot_hash: "a".repeat(64),
    decision: "approved",
    expires_at: "2026-09-14T00:00:00Z",
    actions: [],
  };
  const current = {
    run_id: "r",
    workflow_version_id: "v1",
    snapshot_hash: "a".repeat(64),
    status: "running",
    now: new Date("2026-09-13T00:00:00Z"),
  };
  expect(api.approvalMatches(approval, current)).toBe(true);
  expect(
    api.approvalMatches(approval, { ...current, workflow_version_id: "v2" }),
  ).toBe(false);
  expect(
    api.approvalMatches(approval, {
      ...current,
      snapshot_hash: "b".repeat(64),
    }),
  ).toBe(false);
  expect(
    api.approvalMatches(approval, {
      ...current,
      now: new Date("2026-09-14T00:00:00Z"),
    }),
  ).toBe(false);
  expect(
    api.approvalMatches(approval, { ...current, status: "cancelled" }),
  ).toBe(false);
});
