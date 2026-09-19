import { randomUUID } from "node:crypto";
import {
  evaluate,
  resolveArgs,
  resolveValue,
  validateGraph,
  validateToolCall,
  type Approval,
  type ErrorClass,
  type PlannerResult,
  type ResolveContext,
  type WorkflowPlan,
} from "@wap/dsl";
import { Store, type RunRow, type Tx } from "./store.js";
import type { Gateway } from "./gateway.js";
import { callStep } from "./attempts.js";
import {
  EngineError,
  SnapshotSchema,
  canonicalJson,
  hash,
  json,
  payloadHash,
  validateManualPlan,
} from "./snapshot.js";
import { containsConfiguredSecret } from "./redaction.js";
import { receiverModeFor } from "./receiver-policy.js";
import type { LocalReplanPort } from "./ai/ports.js";

export type ReplanCertainty =
  "confirmed" | "known_not_applied" | "before_dispatch" | "unknown";

export interface ExecuteReplanOptions {
  readonly store: Store;
  readonly gateway: Gateway;
  readonly runId: string;
  readonly failedStepId: string;
  readonly errorClass: ErrorClass;
  readonly errorMessage: string;
  readonly replanPort: LocalReplanPort;
  readonly certainty: ReplanCertainty;
}

type ReplanToken = Readonly<{
  workflowVersionId: string;
  replanCount: number;
  phase: "replanning" | "dry_running";
}>;

function isStaleReplanError(error: unknown): boolean {
  return (
    error instanceof EngineError &&
    (error.code === "LEASE_LOST" || error.code === "STALE_REPLAN")
  );
}

async function assertReplanCurrent(
  store: Store,
  tx: Tx,
  runId: string,
  token: ReplanToken,
): Promise<RunRow> {
  await store.assertWorker(tx);
  const run = await store.run(tx, runId, true);
  if (
    run.claimed_by !== store.workerId ||
    run.workflow_version_id !== token.workflowVersionId ||
    run.replan_count !== token.replanCount ||
    run.status !== token.phase
  )
    throw new EngineError("STALE_REPLAN", "Replan state is no longer current");
  return run;
}

function assertLocalReplanScope(
  currentPlan: WorkflowPlan,
  newPlan: WorkflowPlan,
  failedStepId: string,
): void {
  const currentIds = currentPlan.steps.map((step) => step.id);
  const newIds = newPlan.steps.map((step) => step.id);
  if (
    currentIds.length !== newIds.length ||
    currentIds.some((stepId, index) => stepId !== newIds[index])
  ) {
    throw new EngineError(
      "INVALID_PLAN",
      "Local replan may not add, remove, or reorder workflow steps",
    );
  }

  const { steps: _currentSteps, ...currentEnvelope } = currentPlan;
  const { steps: _newSteps, ...newEnvelope } = newPlan;
  if (canonicalJson(currentEnvelope) !== canonicalJson(newEnvelope)) {
    throw new EngineError(
      "INVALID_PLAN",
      "Local replan may not change workflow fields outside the failed step",
    );
  }

  for (let index = 0; index < currentPlan.steps.length; index++) {
    const currentStep = currentPlan.steps[index]!;
    const newStep = newPlan.steps[index]!;
    if (
      currentStep.id !== failedStepId &&
      canonicalJson(currentStep) !== canonicalJson(newStep)
    ) {
      throw new EngineError(
        "INVALID_PLAN",
        `Local replan may only change failed step '${failedStepId}'`,
      );
    }
  }
}

async function failInvalidReplan(
  store: Store,
  runId: string,
  token: ReplanToken,
  error: unknown,
) {
  try {
    await store.db.client.begin(async (tx) => {
      const run = await assertReplanCurrent(store, tx, runId, token);
      if (run.cancel_requested_at) {
        await store.transition(tx, run, "cancelled");
        return;
      }
      await store.transition(tx, run, "failed", {
        error:
          error instanceof EngineError
            ? error.message
            : "Local replan produced an invalid plan",
      });
    });
  } catch (settleError) {
    if (isStaleReplanError(settleError)) return store.detail(runId);
    throw settleError;
  }
  return store.detail(runId);
}

export async function executeReplan(options: ExecuteReplanOptions) {
  const {
    store,
    gateway,
    runId,
    failedStepId,
    errorClass,
    errorMessage,
    replanPort,
    certainty,
  } = options;

  // 1. Unknown write certainty strictly prohibits replan (FR-EXE-12).
  if (certainty === "unknown") {
    await store.db.client.begin(async (tx) => {
      const run = await store.run(tx, runId, true);
      await store.transition(tx, run, "reconciliation_required", {
        error:
          "Dispatched write outcome certainty is unknown; replan is prohibited",
      });
    });
    return store.detail(runId);
  }

  // 2. Worker assertion & initial transition to 'replanning'
  const state = await store.db.client
    .begin(async (tx) => {
      await store.assertWorker(tx);
      const run = await store.run(tx, runId, true);
      if (run.cancel_requested_at) {
        await store.transition(tx, run, "cancelled");
        return null;
      }
      if (
        !run.workflow_version_id ||
        !["running", "dry_running"].includes(run.status) ||
        run.claimed_by !== store.workerId
      )
        throw new EngineError(
          "STALE_REPLAN",
          "Run is no longer current for replan",
        );
      if (run.replan_count >= 2) {
        await store.transition(tx, run, "failed", {
          error: `Local replan limit reached (${run.replan_count}/2)`,
        });
        return null;
      }

      const nextReplanCount = run.replan_count + 1;
      await tx`UPDATE runs SET replan_count=${nextReplanCount},claimed_by=${store.workerId},claimed_at=now(),heartbeat_at=now() WHERE id=${runId}`;
      await store.transition(tx, run, "replanning");
      await store.emit(tx, runId, "replan.started", {
        failed_step_id: failedStepId,
        error_class: errorClass,
        scope: "local",
        replan_count: nextReplanCount,
      });

      const [verRow] =
        await tx`SELECT plan FROM workflow_versions WHERE id=${run.workflow_version_id} AND workflow_id=${run.workflow_id}`;
      if (!verRow)
        throw new EngineError(
          "NOT_FOUND",
          "Current workflow version plan not found",
        );

      // Reconstruct completed step outputs
      const succeededSteps = await tx`
      SELECT step_id, output, side_effect
      FROM step_states
      WHERE run_id=${runId} AND status='succeeded'
    `;
      const completedOutputs: Record<string, unknown> = {};
      const completedStepIds = new Set<string>();
      for (const s of succeededSteps) {
        completedStepIds.add(s.step_id);
        if (s.output !== null && s.output !== undefined) {
          completedOutputs[s.step_id] = s.output;
        }
      }

      const readAttempts = await tx`
      SELECT s.step_id, a.result
      FROM step_attempts a
      JOIN step_states s ON s.id=a.step_state_id
      WHERE s.run_id=${runId} AND s.side_effect='read'
        AND a.ended_at IS NOT NULL AND a.error_class IS NULL AND a.result IS NOT NULL
      ORDER BY a.started_at, a.id
    `;
      for (const a of readAttempts) {
        completedOutputs[a.step_id] = a.result;
      }

      // Load failed approaches for the failed step
      const failedAttemptRows = await tx`
      SELECT a.resolved_args, a.error_message
      FROM step_attempts a
      JOIN step_states s ON s.id=a.step_state_id
      WHERE s.run_id=${runId} AND s.step_id=${failedStepId}
        AND a.ended_at IS NOT NULL AND a.error_class IS NOT NULL
      ORDER BY a.started_at
    `;
      const failedApproaches = failedAttemptRows.map(
        (r) => `${JSON.stringify(r.resolved_args)}: ${r.error_message}`,
      );

      return {
        run,
        currentPlan: verRow.plan as WorkflowPlan,
        completedOutputs,
        completedStepIds: [...completedStepIds],
        failedApproaches,
        nextReplanCount,
        token: {
          workflowVersionId: run.workflow_version_id,
          replanCount: nextReplanCount,
          phase: "replanning" as const,
        },
      };
    })
    .catch((error: unknown) => {
      if (isStaleReplanError(error)) return null;
      throw error;
    });

  if (!state) return store.detail(runId);

  // 3. Call LocalReplanPort
  let replanResult: PlannerResult;
  try {
    replanResult = await replanPort.replan({
      runId,
      userId: store.userId,
      sourcePrompt: state.run.source_prompt,
      currentPlan: state.currentPlan,
      failedStepId,
      errorMessage,
      errorClass,
      completedOutputs: state.completedOutputs,
      failedApproaches: state.failedApproaches,
      replanCount: state.nextReplanCount,
      maxReplans: 2,
      runtime: state.run.runtime as Record<string, string>,
    });
  } catch (error) {
    try {
      await store.db.client.begin(async (tx) => {
        const run = await assertReplanCurrent(store, tx, runId, state.token);
        if (run.cancel_requested_at) {
          await store.transition(tx, run, "cancelled");
          return;
        }
        await store.transition(tx, run, "failed", {
          error: error instanceof Error ? error.message : "Replan failed",
        });
      });
    } catch (settleError) {
      if (isStaleReplanError(settleError)) return store.detail(runId);
      throw settleError;
    }
    return store.detail(runId);
  }

  // 4. Handle refusal or clarification
  if (replanResult.kind === "refusal") {
    try {
      await store.db.client.begin(async (tx) => {
        const run = await assertReplanCurrent(store, tx, runId, state.token);
        if (run.cancel_requested_at) {
          await store.transition(tx, run, "cancelled");
          return;
        }
        await store.transition(tx, run, "refused", {
          error: replanResult.reason,
        });
      });
    } catch (error) {
      if (isStaleReplanError(error)) return store.detail(runId);
      throw error;
    }
    return store.detail(runId);
  }

  if (replanResult.kind === "clarification") {
    try {
      await store.db.client.begin(async (tx) => {
        const run = await assertReplanCurrent(store, tx, runId, state.token);
        if (run.cancel_requested_at) {
          await store.transition(tx, run, "cancelled");
          return;
        }
        await store.transition(tx, run, "needs_input", {
          error: replanResult.question,
        });
      });
    } catch (error) {
      if (isStaleReplanError(error)) return store.detail(runId);
      throw error;
    }
    return store.detail(runId);
  }

  // 5. Kind is 'plan': validate engine-owned local scope before persistence.
  if (containsConfiguredSecret(replanResult.plan, store.secrets))
    return failInvalidReplan(
      store,
      runId,
      state.token,
      new EngineError(
        "SECRET_IN_WRITE",
        "Replan contains protected configuration data",
      ),
    );

  let newPlan: WorkflowPlan;
  let layers: ReturnType<typeof validateGraph>["layers"];
  try {
    await gateway.assertCurrent();
    newPlan = validateManualPlan(replanResult.plan, gateway.tools);
    assertLocalReplanScope(state.currentPlan, newPlan, failedStepId);
    layers = validateGraph(newPlan).layers;
  } catch (error) {
    return failInvalidReplan(
      store,
      runId,
      state.token,
      error instanceof EngineError
        ? error
        : new EngineError("CONFLICT", "Reviewed gateway changed during replan"),
    );
  }

  const completedStepIds = new Set(state.completedStepIds);
  const newVersionId = randomUUID();
  let newVersionNo = 1;

  let applied = false;
  try {
    applied = await store.db.client.begin(async (tx) => {
      const run = await assertReplanCurrent(store, tx, runId, state.token);
      if (run.cancel_requested_at) {
        await store.transition(tx, run, "cancelled");
        return false;
      }

      // Invalidate existing pending or approved approvals (FR-APR-06)
      await tx`UPDATE approvals SET decision='superseded' WHERE run_id=${runId} AND decision IN ('pending','approved')`;

      const [vRow] =
        await tx`SELECT COALESCE(MAX(version_no), 1) + 1 AS next_ver FROM workflow_versions WHERE workflow_id=${run.workflow_id}`;
      newVersionNo = Number(vRow!.next_ver);

      await tx`INSERT INTO workflow_versions(id, workflow_id, version_no, plan, origin)
        VALUES (${newVersionId}, ${run.workflow_id}, ${newVersionNo}, ${tx.json(json({ ...newPlan, source_prompt: run.source_prompt }))}, 'replan')`;

      await tx`UPDATE runs SET workflow_version_id=${newVersionId}, claimed_by=${store.workerId}, claimed_at=now(),heartbeat_at=now() WHERE id=${runId}`;

      // Reset step_states for uncompleted steps
      for (const step of newPlan.steps) {
        if (!completedStepIds.has(step.id)) {
          await tx`INSERT INTO step_states(run_id, step_id, side_effect, status)
            VALUES (${runId}, ${step.id}, ${step.side_effect}, 'pending')
            ON CONFLICT (run_id, step_id) DO UPDATE SET side_effect=EXCLUDED.side_effect, status='pending', last_error=NULL, last_error_class=NULL, ended_at=NULL`;
        }
      }

      await store.emit(tx, runId, "replan.applied", {
        workflow_version_id: newVersionId,
        version_no: newVersionNo,
        plan: { ...newPlan, source_prompt: run.source_prompt },
        layers,
        changed_step_ids: [failedStepId],
      });

      await store.transition(tx, run, "dry_running");
      return true;
    });
  } catch (error) {
    if (isStaleReplanError(error)) return store.detail(runId);
    throw error;
  }

  if (!applied) return store.detail(runId);
  const previewToken: ReplanToken = {
    workflowVersionId: newVersionId,
    replanCount: state.token.replanCount,
    phase: "dry_running",
  };

  // 6. Dry-run remaining steps to produce new preview
  const context: ResolveContext = {
    inputs: state.run.inputs,
    runtime: state.run.runtime as ResolveContext["runtime"],
    stepOutputs: { ...state.completedOutputs },
  };

  const actions: Approval["actions"] = [];
  const actionIntents = new Map<string, string>();

  try {
    for (const stepId of layers.flat()) {
      const step = newPlan.steps.find((s) => s.id === stepId)!;
      const current = await store.db.client.begin(async (tx) => {
        const run = await assertReplanCurrent(store, tx, runId, previewToken);
        if (!run.cancel_requested_at) return true;
        await store.transition(tx, run, "cancelled");
        return false;
      });
      if (!current) return store.detail(runId);

      // If already completed in an earlier attempt/version, preserve output and skip execution
      if (completedStepIds.has(step.id)) {
        continue;
      }

      if (step.condition && !evaluate(step.condition, context)) {
        await store.db.client.begin(async (tx) => {
          await assertReplanCurrent(store, tx, runId, previewToken);
          await tx`UPDATE step_states SET status='skipped',ended_at=now() WHERE run_id=${runId} AND step_id=${step.id}`;
          await store.emit(tx, runId, "step.skipped", {
            step_id: step.id,
            condition: step.condition,
          });
        });
        continue;
      }

      const tool = gateway.tools.find(
        (t) => t.server === step.tool.server && t.name === step.tool.name,
      )!;
      const args = resolveArgs(step.tool.args, context);
      if (!validateToolCall(tool, args, "execution").ok) {
        throw new EngineError(
          "INVALID_ARGS",
          "Resolved arguments do not match reviewed tool schema",
        );
      }

      if (tool.sideEffect === "read") {
        const result = await callStep(
          store,
          gateway,
          runId,
          step,
          tool,
          args,
          undefined,
          async (tx) => {
            await assertReplanCurrent(store, tx, runId, previewToken);
          },
        );
        if (!result.ok) {
          const run = await store.run(store.db.client, runId);
          if (
            result.certainty !== "unknown" &&
            step.on_error === "replan" &&
            replanPort &&
            run.replan_count < 2 &&
            !run.cancel_requested_at
          ) {
            return await executeReplan({
              store,
              gateway,
              runId,
              failedStepId: step.id,
              errorClass: result.errorClass ?? "bad_args",
              errorMessage: result.message ?? "Read step failed",
              replanPort,
              certainty: result.certainty,
            });
          }
          if (
            result.certainty !== "unknown" &&
            step.on_error === "replan" &&
            replanPort &&
            run.replan_count >= 2
          ) {
            throw new EngineError(
              "REPLAN_LIMIT_EXCEEDED",
              `Local replan limit reached (${run.replan_count}/2)`,
            );
          }
          throw new EngineError("READ_FAILED", result.message!);
        }
        context.stepOutputs[step.id] = result.output;
      } else {
        const intent = resolveValue(step.idempotency_key!, context);
        if (typeof intent !== "string" || !intent) {
          throw new EngineError(
            "INVALID_ARGS",
            "Resolved intent key must be a nonempty string",
          );
        }
        if (containsConfiguredSecret(intent, store.secrets))
          throw new EngineError(
            "SECRET_IN_WRITE",
            "Write intent contains protected configuration data",
          );
        const operationId = randomUUID();
        actions.push({
          step_id: step.id,
          operation_id: operationId,
          server: tool.server,
          tool: tool.name,
          policy_version: tool.policyVersion,
          resolved_args: JSON.parse(canonicalJson(args)),
          payload_hash: payloadHash(tool, args),
        });
        actionIntents.set(operationId, intent);
      }
    }

    if (
      actions.some((action) =>
        containsConfiguredSecret(action.resolved_args, store.secrets),
      )
    )
      throw new EngineError(
        "SECRET_IN_WRITE",
        "Write payload contains protected configuration data",
      );

    const persistedPlan = {
      ...newPlan,
      source_prompt: state.run.source_prompt,
    };
    const snapshot = SnapshotSchema.parse({
      format: "b-local-preview-1",
      run_id: runId,
      user_id: store.userId,
      workflow_version_id: newVersionId,
      plan: persistedPlan,
      inputs: state.run.inputs,
      runtime: state.run.runtime,
      time_zone: state.run.time_zone,
      tools: gateway.tools,
      read_outputs: context.stepOutputs,
      actions,
    });

    await gateway.assertCurrent();
    await store.db.client.begin(async (tx) => {
      const run = await assertReplanCurrent(store, tx, runId, previewToken);
      if (run.cancel_requested_at) {
        throw new EngineError("CANCELLED", "Cancelled before preview");
      }

      if (!actions.length) {
        // No writes left; all steps succeeded
        const outputs = Object.fromEntries(
          Object.entries(newPlan.outputs).map(([key, value]) => [
            key,
            resolveValue(value, context),
          ]),
        );
        await store.transition(tx, run, "succeeded", { outputs });
      } else {
        for (const action of actions) {
          const step = newPlan.steps.find((s) => s.id === action.step_id)!;
          const tool = gateway.tools.find(
            (t) => t.server === action.server && t.name === action.tool,
          )!;
          const intent = actionIntents.get(action.operation_id);
          if (!intent)
            throw new EngineError(
              "CONFLICT",
              "Replan action intent was not prepared",
            );
          await tx`INSERT INTO tool_operations(operation_id,user_id,run_id,workflow_version_id,step_id,tool_server,tool_name,policy_version,intent_key,payload_hash,resolved_args,state,receiver_mode)
            VALUES (${action.operation_id},${store.userId},${runId},${newVersionId},${action.step_id},${action.server},${action.tool},${action.policy_version},${intent},${action.payload_hash},${tx.json(json(action.resolved_args))},'reserved',${receiverModeFor(tool)})`;
          await tx`UPDATE step_states SET status='ready' WHERE run_id=${runId} AND step_id=${action.step_id}`;
        }

        const [approval] =
          await tx`INSERT INTO approvals(run_id,workflow_version_id,snapshot_hash,preview,expires_at)
            VALUES (${runId},${newVersionId},${hash(snapshot)},${tx.json(json({ ...snapshot, canonical_bytes: canonicalJson(snapshot) }))},clock_timestamp()+interval '10 minutes')
            RETURNING id,expires_at`;

        await tx`UPDATE runs SET claimed_by=NULL,claimed_at=NULL,heartbeat_at=NULL WHERE id=${runId}`;
        await store.transition(tx, run, "awaiting_approval");
        await store.emit(tx, runId, "dryrun.ready", {
          approval_id: approval!.id,
          expires_at: new Date(approval!.expires_at).toISOString(),
          read_count: Object.keys(snapshot.read_outputs).length,
          write_count: actions.length,
        });
      }
    });
  } catch (error) {
    if (isStaleReplanError(error)) return store.detail(runId);
    try {
      await store.db.client.begin(async (tx) => {
        const run = await assertReplanCurrent(store, tx, runId, previewToken);
        await store.closeOpenAttempts(
          tx,
          runId,
          "Replan preview stopped before persisting outcome",
        );
        await store.transition(
          tx,
          run,
          run.cancel_requested_at ||
            (error instanceof EngineError && error.code === "CANCELLED")
            ? "cancelled"
            : "failed",
          {
            error:
              error instanceof EngineError
                ? error.message
                : "Replan preview failed",
          },
        );
      });
    } catch (settleError) {
      if (isStaleReplanError(settleError)) return store.detail(runId);
      throw settleError;
    }
  }

  return store.detail(runId);
}
