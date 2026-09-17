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
import { Store, type RunRow } from "./store.js";
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
import { receiverModeFor } from "./receiver-policy.js";
import type { LocalReplanPort } from "./ai/ports.js";

export type ReplanCertainty =
  | "confirmed"
  | "known_not_applied"
  | "before_dispatch"
  | "unknown";

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

export async function executeReplan(
  options: ExecuteReplanOptions,
) {
  const { store, gateway, runId, failedStepId, errorClass, errorMessage, replanPort, certainty } =
    options;

  // 1. Unknown write certainty strictly prohibits replan (FR-EXE-12).
  if (certainty === "unknown") {
    await store.db.client.begin(async (tx) => {
      const run = await store.run(tx, runId, true);
      await store.transition(tx, run, "reconciliation_required", {
        error: "Dispatched write outcome certainty is unknown; replan is prohibited",
      });
    });
    return store.detail(runId);
  }

  // 2. Worker assertion & initial transition to 'replanning'
  const state = await store.db.client.begin(async (tx) => {
    await store.assertWorker(tx);
    const run = await store.run(tx, runId, true);
    if (run.cancel_requested_at) {
      await store.transition(tx, run, "cancelled");
      return null;
    }
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
      throw new EngineError("NOT_FOUND", "Current workflow version plan not found");

    // Reconstruct completed step outputs
    const succeededSteps = await tx`
      SELECT step_id, output, side_effect
      FROM step_states
      WHERE run_id=${runId} AND status='succeeded'
    `;
    const completedOutputs: Record<string, unknown> = {};
    for (const s of succeededSteps) {
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
      failedApproaches,
      nextReplanCount,
    };
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
    await store.db.client.begin(async (tx) => {
      const run = await store.run(tx, runId, true);
      if (run.cancel_requested_at) {
        await store.transition(tx, run, "cancelled");
        return;
      }
      await store.transition(tx, run, "failed", {
        error: error instanceof Error ? error.message : "Replan failed",
      });
    });
    return store.detail(runId);
  }

  // 4. Handle refusal or clarification
  if (replanResult.kind === "refusal") {
    await store.db.client.begin(async (tx) => {
      const run = await store.run(tx, runId, true);
      await store.transition(tx, run, "refused", {
        error: replanResult.reason,
      });
    });
    return store.detail(runId);
  }

  if (replanResult.kind === "clarification") {
    await store.db.client.begin(async (tx) => {
      const run = await store.run(tx, runId, true);
      await store.transition(tx, run, "needs_input", {
        error: replanResult.question,
      });
    });
    return store.detail(runId);
  }

  // 5. Kind is 'plan': validate plan and local invariants
  const newPlan = validateManualPlan(replanResult.plan, gateway.tools);
  const layers = validateGraph(newPlan).layers;

  const completedStepIds = new Set(Object.keys(state.completedOutputs));
  const newVersionId = randomUUID();
  let newVersionNo = 1;

  await store.db.client.begin(async (tx) => {
    await store.assertWorker(tx);
    const run = await store.run(tx, runId, true);
    if (run.cancel_requested_at) {
      await store.transition(tx, run, "cancelled");
      return;
    }

    // Invalidate existing pending or approved approvals (FR-APR-06)
    await tx`UPDATE approvals SET decision='superseded' WHERE run_id=${runId} AND decision IN ('pending','approved')`;

    const [vRow] =
      await tx`SELECT COALESCE(MAX(version_no), 1) + 1 AS next_ver FROM workflow_versions WHERE workflow_id=${run.workflow_id}`;
    newVersionNo = Number(vRow!.next_ver);

    await tx`INSERT INTO workflow_versions(id, workflow_id, version_no, plan, origin)
      VALUES (${newVersionId}, ${run.workflow_id}, ${newVersionNo}, ${tx.json(json({ ...newPlan, source_prompt: run.source_prompt }))}, 'replan')`;

    await tx`UPDATE runs SET workflow_version_id=${newVersionId}, claimed_by=${store.workerId}, claimed_at=now(), heartbeat_at=now() WHERE id=${runId}`;

    // Reset step_states for uncompleted steps
    for (const step of newPlan.steps) {
      if (!completedStepIds.has(step.id)) {
        await tx`INSERT INTO step_states(run_id, step_id, side_effect, status)
          VALUES (${runId}, ${step.id}, ${step.side_effect}, 'pending')
          ON CONFLICT (run_id, step_id) DO UPDATE SET status='pending', last_error=NULL, last_error_class=NULL, ended_at=NULL`;
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
  });

  // Check if cancelled after version insertion
  const freshRun = await store.run(store.db.client, runId);
  if (freshRun.status === "cancelled") return store.detail(runId);

  // 6. Dry-run remaining steps to produce new preview
  const context: ResolveContext = {
    inputs: state.run.inputs,
    runtime: state.run.runtime as ResolveContext["runtime"],
    stepOutputs: { ...state.completedOutputs },
  };

  const actions: Approval["actions"] = [];

  try {
    for (const stepId of layers.flat()) {
      const step = newPlan.steps.find((s) => s.id === stepId)!;
      const current = await store.run(store.db.client, runId);
      if (current.cancel_requested_at) {
        throw new EngineError("CANCELLED", "Cancelled before next preview step");
      }

      // If already completed in an earlier attempt/version, preserve output and skip execution
      if (completedStepIds.has(step.id)) {
        continue;
      }

      if (step.condition && !evaluate(step.condition, context)) {
        await store.db.client.begin(async (tx) => {
          await store.run(tx, runId, true);
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
        const result = await callStep(store, gateway, runId, step, tool, args);
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
        actions.push({
          step_id: step.id,
          operation_id: randomUUID(),
          server: tool.server,
          tool: tool.name,
          policy_version: tool.policyVersion,
          resolved_args: JSON.parse(canonicalJson(args)),
          payload_hash: payloadHash(tool, args),
        });
      }
    }

    const persistedPlan = { ...newPlan, source_prompt: state.run.source_prompt };
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

    await store.db.client.begin(async (tx) => {
      const run = await store.run(tx, runId, true);
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
          const intent = resolveValue(step.idempotency_key!, context) as string;
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
    await store.db.client.begin(async (tx) => {
      const run = await store.run(tx, runId, true);
      if (run.status === "succeeded" || run.status === "awaiting_approval") {
        return;
      }
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
  }

  return store.detail(runId);
}
