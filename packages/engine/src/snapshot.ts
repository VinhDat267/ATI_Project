import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ArgValueSchema,
  WorkflowPlanSchema,
  PreviewActionSchema,
  validatePlanTools,
  validateGraph,
  type TrustedTool,
  type WorkflowPlan,
} from "@wap/dsl";
import type postgres from "postgres";

export class EngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}
export class BeforeDispatchError extends EngineError {
  constructor(message: string) {
    super("BEFORE_DISPATCH", message);
  }
}
export const ToolSchema = z
  .object({
    server: z.enum(["task_hub", "filesystem"]),
    name: z.string(),
    sideEffect: z.enum(["read", "write"]),
    policyVersion: z.string(),
    inputSchema: z.record(z.string(), ArgValueSchema),
    outputSchema: z.record(z.string(), ArgValueSchema),
    artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type EngineTool = z.infer<typeof ToolSchema>;
export const SnapshotSchema = z
  .object({
    format: z.literal("b-local-preview-1"),
    run_id: z.uuid(),
    user_id: z.uuid(),
    workflow_version_id: z.uuid(),
    plan: WorkflowPlanSchema,
    inputs: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    ),
    runtime: z.record(z.string(), z.string()),
    time_zone: z.string(),
    tools: z.array(ToolSchema),
    read_outputs: z.record(z.string(), ArgValueSchema),
    actions: z.array(PreviewActionSchema),
  })
  .strict();
export type Snapshot = z.infer<typeof SnapshotSchema>;
export function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    )
      return v;
    if (Array.isArray(v)) return v.map(normalize);
    if (
      v &&
      typeof v === "object" &&
      Object.getPrototypeOf(v) === Object.prototype
    )
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, normalize((v as Record<string, unknown>)[k])]),
      );
    throw new EngineError("INVALID_JSON", "Finite plain JSON values required");
  };
  return JSON.stringify(normalize(value));
}
export const hash = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
export const json = (value: unknown): postgres.JSONValue =>
  JSON.parse(canonicalJson(value));
export const payloadHash = (tool: EngineTool, args: unknown) =>
  hash({
    server: tool.server,
    tool: tool.name,
    policy_version: tool.policyVersion,
    args,
  });
export const toolTrace = (tool: EngineTool) => ({
  server: tool.server,
  name: tool.name,
  policy_version: tool.policyVersion,
  artifact_hash: tool.artifactHash,
  input_schema: tool.inputSchema,
  output_schema: tool.outputSchema,
});

export function validateManualPlan(
  value: unknown,
  registry: readonly TrustedTool[],
): WorkflowPlan {
  const parsed = WorkflowPlanSchema.safeParse(value);
  if (!parsed.success)
    throw new EngineError(
      "INVALID_PLAN",
      parsed.error.issues.map((x) => x.message).join("; "),
    );
  const plan = parsed.data,
    validation = validatePlanTools(plan, registry);
  if (!validation.ok)
    throw new EngineError(
      "INVALID_PLAN",
      validation.issues.map((x) => x.message).join("; "),
    );
  const afterWrite = new Set<string>();
  for (const id of validateGraph(plan).layers.flat()) {
    const step = plan.steps.find((s) => s.id === id)!;
    if (
      step.depends_on.some((d) => afterWrite.has(d)) &&
      step.side_effect === "read"
    )
      throw new EngineError(
        "INVALID_PLAN",
        "Reads downstream of writes cannot be executed in a single immutable preview",
      );
    if (
      step.side_effect === "write" ||
      step.depends_on.some((d) => afterWrite.has(d))
    )
      afterWrite.add(id);
  }
  return plan;
}
export function resolveInputs(plan: WorkflowPlan, supplied: unknown = {}) {
  const values = z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .parse(supplied);
  const result: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(values))
    if (!Object.hasOwn(plan.inputs, key))
      throw new EngineError("INVALID_INPUT", `Undeclared input: ${key}`);
  for (const [key, decl] of Object.entries(plan.inputs)) {
    const value = values[key] ?? decl.default;
    if (value === undefined) {
      if (decl.required)
        throw new EngineError("INVALID_INPUT", `Missing input: ${key}`);
      continue;
    }
    if (typeof value !== decl.type)
      throw new EngineError("INVALID_INPUT", `Wrong input type: ${key}`);
    result[key] = value;
  }
  return result;
}
export function unpackPreview(
  preview: unknown,
  expectedHash: string,
): Snapshot {
  if (!preview || typeof preview !== "object")
    throw new EngineError("CONFLICT", "Preview is missing");
  const { canonical_bytes, ...data } = preview as Record<string, unknown>;
  const parsed = SnapshotSchema.safeParse(data);
  if (
    !parsed.success ||
    canonical_bytes !== canonicalJson(parsed.data) ||
    hash(parsed.data) !== expectedHash
  )
    throw new EngineError("CONFLICT", "Preview bytes or snapshot hash changed");
  return parsed.data;
}
