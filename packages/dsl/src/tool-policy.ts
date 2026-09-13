/** Layer 2. Registry entries are trusted, reviewed snapshots, not raw tools/list. */
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import type { WorkflowPlan, SideEffect, ArgValue } from "./schema.js";
import { collectReferences } from "./reference.js";
import { conditionReferences, parseCondition } from "./condition.js";
import { validateGraph, type GraphIssue } from "./graph.js";

export interface TrustedTool {
  server: string;
  name: string;
  sideEffect: SideEffect;
  policyVersion: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}
export interface ToolCheck {
  ok: boolean;
  issues: GraphIssue[];
}

/** No coercion/defaulting/removal. Unsupported schemas fail closed. Compile at registry load in the engine. */
function checkSchema(
  schema: Record<string, unknown>,
  value: unknown,
): ToolCheck {
  try {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      validateFormats: true,
    });
    formatsPlugin.default(ajv);
    const validate = ajv.compile(schema);
    if (validate(value)) return { ok: true, issues: [] };
    return {
      ok: false,
      issues: (validate.errors ?? []).map((e) => ({
        path: e.instancePath.split("/").slice(1),
        message: `${e.keyword}: ${e.message}`,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      issues: [
        {
          path: [],
          message: `unsupported tool schema: ${(err as Error).message}`,
        },
      ],
    };
  }
}

export function validatePlanTools(
  plan: WorkflowPlan,
  registry: readonly TrustedTool[],
): ToolCheck & { deferredStepIds: string[] } {
  const graph = validateGraph(plan);
  const issues = [...graph.issues];
  const deferredStepIds: string[] = [];
  const key = (t: { server: string; name: string }) =>
    JSON.stringify([t.server, t.name]);
  const tools = new Map(registry.map((t) => [key(t), t]));
  if (tools.size !== registry.length)
    issues.push({ path: [], message: "duplicate registry tool identity" });
  const writeIds = new Set(
    plan.steps
      .filter((s) => tools.get(key(s.tool))?.sideEffect === "write")
      .map((s) => s.id),
  );
  plan.steps.forEach((step, i) => {
    if (step.retry.max_attempts > 3 || step.retry.backoff !== "exponential")
      issues.push({
        path: ["steps", i, "retry"],
        message: "B/local requires at most 3 attempts with exponential backoff",
      });
    if (step.on_error === "continue")
      issues.push({
        path: ["steps", i, "on_error"],
        message: "continue is outside profile B/local",
      });
    const tool = tools.get(key(step.tool));
    const path = ["steps", i, "tool"];
    if (
      !tool ||
      !tool.policyVersion ||
      !["read", "write"].includes(tool.sideEffect)
    ) {
      issues.push({ path, message: "tool missing reviewed policy" });
      return;
    }
    if (tool.sideEffect !== step.side_effect)
      issues.push({
        path: ["steps", i, "side_effect"],
        message: "side_effect differs from trusted registry policy",
      });
    try {
      const refs = collectReferences(step.tool.args);
      if (refs.length) deferredStepIds.push(step.id);
      else
        issues.push(
          ...checkSchema(tool.inputSchema, step.tool.args).issues.map((e) => ({
            ...e,
            path: [...path, "args", ...e.path],
          })),
        );
      // Single immutable preview: outputs from unexecuted writes cannot feed later calls.
      const values: ArgValue[] = [step.tool.args, step.idempotency_key];
      if (step.condition)
        values.push(...conditionReferences(parseCondition(step.condition)));
      for (const ref of values.flatMap(collectReferences)) {
        if (ref.kind === "step" && writeIds.has(ref.stepId)) {
          issues.push({
            path: ["steps", i],
            message: `write output ${ref.stepId} is unavailable at approval preview`,
          });
        }
      }
    } catch (err) {
      issues.push({ path, message: (err as Error).message });
    }
  });
  return { ok: issues.length === 0, issues, deferredStepIds };
}

/** Must be called on resolved arguments immediately before every tools/call.
 * This checks policy + args, NOT user authorization. Writes also require the approval/operation gate.
 */
export function validateToolCall(
  tool: TrustedTool,
  resolvedArgs: unknown,
  phase: "dry_run" | "execution",
): ToolCheck {
  if (
    !tool.policyVersion ||
    !["read", "write"].includes(tool.sideEffect) ||
    (phase === "dry_run" && tool.sideEffect !== "read")
  ) {
    return {
      ok: false,
      issues: [{ path: [], message: "tool not permitted in this phase" }],
    };
  }
  return checkSchema(tool.inputSchema, resolvedArgs);
}

/** Baseline requires structuredContent. A text-only server needs an explicitly reviewed adapter. */
export function normalizeToolResult(
  tool: TrustedTool,
  result: {
    isError?: boolean;
    content?: unknown[];
    structuredContent?: unknown;
  },
): { ok: true; output: unknown } | { ok: false; issues: GraphIssue[] } {
  if (result.isError)
    return {
      ok: false,
      issues: [{ path: [], message: "MCP tool returned isError" }],
    };
  if (result.structuredContent === undefined)
    return {
      ok: false,
      issues: [
        {
          path: [],
          message:
            "structuredContent required; no implicit text-to-JSON adapter",
        },
      ],
    };
  const check = checkSchema(tool.outputSchema, result.structuredContent);
  return check.ok
    ? { ok: true, output: result.structuredContent }
    : { ok: false, issues: check.issues };
}
