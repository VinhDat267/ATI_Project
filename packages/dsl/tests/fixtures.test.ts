/** Offline plan/oracle checks. This is NOT a MCP client or production engine. */
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import {
  WorkflowPlanSchema,
  PlannerResultSchema,
  validatePlanTools,
  validateGraph,
  buildRuntime,
  resolveArgs,
  resolveValue,
  evaluate,
  validateToolCall,
  normalizeToolResult,
  type TrustedTool,
  type ResolveContext,
} from "../src/index.js";
const catalog = JSON.parse(readFileSync("../../testdata/tools.json", "utf8"));
const data = JSON.parse(readFileSync("../../testdata/test-cases.json", "utf8"));
const registry: TrustedTool[] = catalog.servers.flatMap((s: any) =>
  s.tools.map((t: any) => ({ ...t, server: s.slug })),
);

function checkCase(fixture: any, candidate = fixture.expected_result): void {
  const outcome = PlannerResultSchema.parse(candidate);
  expect(outcome.kind).toBe(fixture.expected_result.kind);
  if (outcome.kind !== "plan") return;
  const plan = WorkflowPlanSchema.parse(outcome.plan);
  expect(validatePlanTools(plan, registry).issues).toEqual([]);
  const ctx: ResolveContext = {
    inputs: {},
    stepOutputs: {},
    runtime: buildRuntime({
      now: new Date(data.runtime.now),
      runId: data.runtime.run_id,
      userId: data.runtime.user_id,
      timeZone: data.runtime.time_zone,
    }),
  };
  const writes: unknown[] = [];
  for (const id of validateGraph(plan).layers.flat()) {
    const step = plan.steps.find((s) => s.id === id)!;
    if (step.condition && !evaluate(step.condition, ctx)) continue;
    const tool = registry.find(
      (t) => t.server === step.tool.server && t.name === step.tool.name,
    )!;
    const args = resolveArgs(step.tool.args, ctx);
    expect(validateToolCall(tool, args, "execution").issues).toEqual([]);
    if (tool.sideEffect === "write") {
      writes.push({ server: tool.server, name: tool.name, args });
      // No invented write outputs. A downstream dependency on them must fail.
    } else {
      const item = fixture.read_fixture.find(
        (r: any) =>
          r.server === tool.server &&
          r.name === tool.name &&
          isDeepStrictEqual(r.args, args),
      );
      expect(
        item,
        "read target/filter differs from hand-checked fixture",
      ).toBeDefined();
      const result = normalizeToolResult(tool, {
        structuredContent: item.output,
        content: [],
      });
      expect(result.ok).toBe(true);
      if (result.ok) ctx.stepOutputs[id] = result.output;
    }
  }
  expect(writes).toEqual(fixture.expected_writes);
  expect(
    Object.fromEntries(
      Object.entries(plan.outputs).map(([key, value]) => [
        key,
        resolveValue(value, ctx),
      ]),
    ),
  ).toEqual(fixture.expected_outputs);
}
for (const fixture of data.cases)
  it(`hand plan/outcome satisfies oracle: ${fixture.id} (${fixture.split})`, () =>
    checkCase(fixture));

it("the oracle detects wrong recipients even when the workflow remains structurally valid", () => {
  const fixture = data.cases.find((c: any) => c.id === "b02");
  const candidate = structuredClone(fixture.expected_result);
  candidate.plan.steps[2].tool.args.channel = "#wrong";
  expect(() => checkCase(fixture, candidate)).toThrow();
});
it("the oracle detects lost rows instead of equating SUCCEEDED with correctness", () => {
  const fixture = data.cases.find((c: any) => c.id === "b02");
  const candidate = structuredClone(fixture.expected_result);
  candidate.plan.steps[1].tool.args.rows = [["API", "Done"]];
  expect(() => checkCase(fixture, candidate)).toThrow();
});
it("every reviewed tool has a compilable input/output contract", () => {
  const ajv = new Ajv2020({ strict: true });
  formatsPlugin.default(ajv);
  for (const tool of registry) {
    expect(() => ajv.compile(tool.inputSchema)).not.toThrow();
    expect(() => ajv.compile(tool.outputSchema)).not.toThrow();
  }
});
