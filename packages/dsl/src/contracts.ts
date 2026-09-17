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

/** Strict HTTP boundary contracts shared by the API and generated OpenAPI. */
export const LoginRequestSchema = z
  .object({
    email: z.string().min(1).max(320),
    password: z.string().min(1).max(4096),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z
  .object({ token: z.string().min(1) })
  .strict();

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        request_id: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const ServerSummarySchema = z
  .object({
    slug: z.string().min(1),
    status: z.enum(["connected", "disconnected", "error", "unreviewed"]),
    policy_version: z.string().nullable(),
  })
  .strict();
export const ServerSummaryListSchema = z.array(ServerSummarySchema);

export const ServerCatalogToolSchema = z
  .object({
    server: z.enum(["task_hub", "filesystem"]),
    name: z.string().min(1),
    side_effect: z.enum(["read", "write"]),
    policy_version: z.string().min(1),
    artifact_hash: z.string().regex(/^[a-f0-9]{64}$/),
    input_schema: z.record(z.string(), ArgValueSchema),
    output_schema: z.record(z.string(), ArgValueSchema),
  })
  .strict();
export type ServerCatalogTool = z.infer<typeof ServerCatalogToolSchema>;

export const ServerCatalogEntrySchema = z
  .object({
    slug: z.enum(["task_hub", "filesystem"]),
    status: z.enum(["connected", "disconnected", "error", "unreviewed"]),
    policy_version: z.string().nullable(),
    observed_at: z.iso.datetime({ offset: true }),
    tools: z.array(ServerCatalogToolSchema),
  })
  .strict()
  .superRefine((entry, ctx) => {
    for (const [index, tool] of entry.tools.entries()) {
      if (tool.server !== entry.slug)
        ctx.addIssue({
          code: "custom",
          path: ["tools", index, "server"],
          message: "tool server must match the catalog entry slug",
        });
    }
    if (entry.status !== "connected") {
      if (entry.tools.length > 0)
        ctx.addIssue({
          code: "custom",
          path: ["tools"],
          message: "non-connected entries cannot publish tools",
        });
      return;
    }
    if (entry.policy_version === null)
      ctx.addIssue({
        code: "custom",
        path: ["policy_version"],
        message: "connected entries require one policy version",
      });
    if (entry.tools.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["tools"],
        message: "connected entries require at least one reviewed tool",
      });
    for (const [index, tool] of entry.tools.entries())
      if (
        entry.policy_version !== null &&
        tool.policy_version !== entry.policy_version
      )
        ctx.addIssue({
          code: "custom",
          path: ["tools", index, "policy_version"],
          message: "tool policy version must match the entry policy version",
        });
  });
export type ServerCatalogEntry = z.infer<typeof ServerCatalogEntrySchema>;

export const ServerCatalogSchema = z
  .array(ServerCatalogEntrySchema)
  .length(2)
  .superRefine((entries, ctx) => {
    if (entries[0]?.slug !== "task_hub")
      ctx.addIssue({
        code: "custom",
        path: [0, "slug"],
        message: "task_hub must be the first catalog entry",
      });
    if (entries[1]?.slug !== "filesystem")
      ctx.addIssue({
        code: "custom",
        path: [1, "slug"],
        message: "filesystem must be the second catalog entry",
      });
  });
export type ServerCatalog = z.infer<typeof ServerCatalogSchema>;

export const RunAcceptedSchema = z
  .object({ run_id: z.string().min(1), status: z.literal("planning") })
  .strict();
export const ApprovalDecisionSchema = z
  .object({
    approval_id: z.uuid(),
    workflow_version_id: z.uuid(),
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
    // Additive fields used by the HTTP read model. They remain optional so
    // older CLI clients can continue parsing the historical detail shape.
    source_prompt: z.string().min(1).max(4000).optional(),
    created_at: z.iso.datetime({ offset: true }).optional(),
    read_outputs: z.record(z.string(), ArgValueSchema).optional(),
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

export const ReconciliationOperationSchema = z
  .object({
    operation_id: z.string().min(1),
    step_id: z.string().min(1),
    state: z.enum([
      "reserved",
      "in_flight",
      "succeeded",
      "known_failed",
      "unknown",
    ]),
    receiver_mode: z.enum([
      "local_transaction",
      "receiver_idempotent",
      "non_idempotent",
    ]),
    receipt: z.enum(["confirmed", "conflict", "not_observed", "not_supported"]),
    result: ArgValueSchema,
    dispatch_marker: z.enum(["present", "absent"]).optional(),
  })
  .strict();

export const ReconciliationSchema = z
  .object({
    run_id: z.string().min(1),
    read_only: z.literal(true),
    operations: z.array(ReconciliationOperationSchema),
  })
  .strict();
