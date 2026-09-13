import { z } from "zod";
import {
  ArgValueSchema,
  WorkflowPlanSchema,
  PlannerResultSchema,
} from "./schema.js";
import { RunStatusSchema, RunEventSchema, ErrorClassSchema } from "./events.js";

export const PreviewActionSchema = z
  .object({
    step_id: z.string().min(1),
    operation_id: z.string().min(1),
    server: z.string().min(1),
    tool: z.string().min(1),
    policy_version: z.string().min(1),
    resolved_args: z.record(z.string(), ArgValueSchema),
    payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const ApprovalSchema = z
  .object({
    id: z.string().min(1),
    run_id: z.string().min(1),
    workflow_version_id: z.string().min(1),
    snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum([
      "pending",
      "approved",
      "rejected",
      "expired",
      "superseded",
    ]),
    expires_at: z.iso.datetime({ offset: true }),
    actions: z.array(PreviewActionSchema),
  })
  .strict();
export type Approval = z.infer<typeof ApprovalSchema>;

/** Pure consistency check. Server must additionally authenticate the owner and atomically claim the operation. */
export function approvalMatches(
  approval: Approval,
  current: {
    run_id: string;
    workflow_version_id: string;
    snapshot_hash: string;
    status: string;
    now: Date;
  },
): boolean {
  return (
    ApprovalSchema.safeParse(approval).success &&
    approval.decision === "approved" &&
    current.status === "running" &&
    approval.run_id === current.run_id &&
    approval.workflow_version_id === current.workflow_version_id &&
    approval.snapshot_hash === current.snapshot_hash &&
    current.now.getTime() < Date.parse(approval.expires_at)
  );
}

export const CreateRunSchema = z
  .object({
    source_prompt: z.string().min(1).max(4000),
    inputs: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .default({}),
    time_zone: z.string().min(1).default("Asia/Ho_Chi_Minh"),
  })
  .strict();
export const RunAcceptedSchema = z
  .object({ run_id: z.string().min(1), status: z.literal("planning") })
  .strict();
export const ApprovalDecisionSchema = z
  .object({
    approval_id: z.string().min(1),
    workflow_version_id: z.string().min(1),
    snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(["approved", "rejected"]),
  })
  .strict();
export const RunDetailSchema = z
  .object({
    run_id: z.string().min(1),
    status: RunStatusSchema,
    workflow_version_id: z.string().nullable(),
    plan: WorkflowPlanSchema.nullable(),
    planner_result: PlannerResultSchema.nullable(),
    approval: ApprovalSchema.nullable(),
    time_zone: z.string(),
    runtime: z.record(z.string(), z.string()),
    last_seq: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((run, ctx) => {
    if ((run.plan === null) !== (run.workflow_version_id === null))
      ctx.addIssue({
        code: "custom",
        path: ["plan"],
        message: "plan and workflow_version_id must be present together",
      });
    if (
      [
        "dry_running",
        "awaiting_approval",
        "running",
        "replanning",
        "succeeded",
      ].includes(run.status) &&
      run.plan === null
    )
      ctx.addIssue({
        code: "custom",
        path: ["plan"],
        message: "executable run requires a validated plan/version",
      });
  });

export const AttemptTraceSchema = z
  .object({
    attempt_id: z.string().min(1),
    step_id: z.string().min(1),
    attempt_no: z.number().int().positive(),
    workflow_version_id: z.string().nullable(),
    evidence: z.enum(["complete", "legacy_unknown"]),
    tool_snapshot: z
      .object({
        server: z.string(),
        name: z.string(),
        policy_version: z.string(),
        artifact_hash: z.string().regex(/^[a-f0-9]{64}$/),
        input_schema: z.record(z.string(), ArgValueSchema),
        output_schema: z.record(z.string(), ArgValueSchema),
      })
      .strict()
      .nullable(),
    operation_id: z.string().nullable(),
    resolved_args: z.record(z.string(), ArgValueSchema).nullable(),
    result: ArgValueSchema,
    outcome_certainty: z
      .enum(["before_dispatch", "known_not_applied", "confirmed", "unknown"])
      .nullable(),
    error_class: ErrorClassSchema.nullable(),
    error_message: z.string().nullable(),
    started_at: z.iso.datetime({ offset: true }),
    ended_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((attempt, ctx) => {
    if (
      attempt.evidence === "complete" &&
      (attempt.workflow_version_id === null ||
        attempt.tool_snapshot === null ||
        attempt.resolved_args === null ||
        attempt.outcome_certainty === null)
    )
      ctx.addIssue({
        code: "custom",
        path: ["evidence"],
        message:
          "complete attempt requires immutable version/tool/args/certainty evidence",
      });
  });
export const TraceSchema = z
  .object({
    run_id: z.string().min(1),
    attempts: z.array(AttemptTraceSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();
export const EventPageSchema = z
  .object({
    events: z.array(RunEventSchema),
    next_seq: z.number().int().nonnegative(),
  })
  .strict();
