import { randomUUID } from "node:crypto";
import {
  buildRuntime,
  evaluate,
  resolveArgs,
  resolveValue,
  validateGraph,
  validateToolCall,
  PlannerResultSchema,
  type Approval,
  type ResolveContext,
} from "@wap/dsl";
import { Store } from "./store.js";
import type { Gateway } from "./gateway.js";
import type { PlannerPort } from "./planner-port.js";
import {
  EngineError,
  SnapshotSchema,
  canonicalJson,
  hash,
  json,
  payloadHash,
  resolveInputs,
  validateManualPlan,
} from "./snapshot.js";
import { receiverModeFor } from "./receiver-policy.js";
import { callStep } from "./attempts.js";
import { containsConfiguredSecret } from "./redaction.js";

type Target = {
  id: string;
  workflowId: string;
  versionId: string;
  sourcePrompt: string;
  inputs: Record<string, string | number | boolean>;
  runtime: Record<string, string>;
  timeZone: string;
  accepted: boolean;
};

/** Existing CLI/manual entry point. It preserves the old create-and-prepare behavior. */
export async function prepare(
  store: Store,
  gateway: Gateway,
  value: unknown,
  options: { inputs?: unknown; timeZone?: string } = {},
) {
  const plan = validateManualPlan(value, gateway.tools);
  const inputs = resolveInputs(plan, options.inputs);
  const id = randomUUID();
  const workflowId = randomUUID();
  const versionId = randomUUID();
  const timeZone = options.timeZone ?? "Asia/Ho_Chi_Minh";
  const runtime = buildRuntime({
    runId: id,
    userId: store.userId,
    timeZone,
  });
  return store.withWorker(
    () =>
      preparePlanUnderLease(
        store,
        gateway,
        {
          id,
          workflowId,
          versionId,
          sourcePrompt: plan.source_prompt,
          inputs,
          runtime,
          timeZone,
          accepted: false,
        },
        plan,
      ),
    () => gateway.close(),
  );
}

/** Claim an accepted run, call the planner, then prepare the same run under the lease. */
export async function prepareAccepted(
  store: Store,
  gateway: Gateway,
  id: string,
  planner: PlannerPort,
) {
  return store.withWorker(
    async () => {
      const run = await store.claimPrepare(id);
      let result: ReturnType<typeof PlannerResultSchema.parse>;
      try {
        result = PlannerResultSchema.parse(
          await planner.produce({
            runId: id,
            userId: store.userId,
            request: {
              source_prompt: run.source_prompt,
              inputs: run.inputs,
              time_zone: run.time_zone,
            },
            runtime: run.runtime,
          }),
        );
      } catch {
        await store.failPlanning(id, "Planner returned an invalid result");
        return store.detail(id);
      }
      if (result.kind === "refusal") {
        await store.recordPlannerResult(id, result, "refused");
        return store.detail(id);
      }
      if (result.kind === "clarification") {
        await store.recordPlannerResult(id, result, "needs_input");
        return store.detail(id);
      }
      await store.recordPlannerResult(id, result);
      let plan;
      try {
        plan = validateManualPlan(result.plan, gateway.tools);
      } catch {
        await store.failPlanning(
          id,
          "Planner produced an invalid executable plan",
        );
        return store.detail(id);
      }
      return preparePlanUnderLease(
        store,
        gateway,
        {
          id,
          workflowId: run.workflow_id,
          versionId: randomUUID(),
          sourcePrompt: run.source_prompt,
          inputs: resolveInputs(plan, run.inputs),
          runtime: run.runtime,
          timeZone: run.time_zone,
          accepted: true,
        },
        plan,
      );
    },
    () => gateway.close(),
  );
}

async function preparePlanUnderLease(
  store: Store,
  gateway: Gateway,
  target: Target,
  plan: ReturnType<typeof validateManualPlan>,
) {
  const layers = validateGraph(plan).layers;
  await gateway.assertCurrent();
  try {
    await store.db.client.begin(async (tx) => {
      let run;
      if (!target.accepted) {
        await tx`INSERT INTO workflows(id,user_id,name,source_prompt)
          VALUES (${target.workflowId},${store.userId},${plan.name},${target.sourcePrompt})`;
        await tx`INSERT INTO runs(id,user_id,workflow_id,source_prompt,inputs,runtime,time_zone)
          VALUES (${target.id},${store.userId},${target.workflowId},${target.sourcePrompt},${tx.json(target.inputs)},${tx.json(target.runtime)},${target.timeZone})`;
        await store.emit(tx, target.id, "run.status", {
          status: "planning",
          previous: null,
        });
      }
      run = await store.run(tx, target.id, true);
      if (
        target.accepted &&
        (run.status !== "planning" || run.workflow_version_id)
      )
        throw new EngineError(
          "CONFLICT",
          "Accepted run is no longer claimable",
        );
      await store.transition(tx, run, "validating");
      await tx`INSERT INTO workflow_versions(id,workflow_id,version_no,plan,origin)
        VALUES (${target.versionId},${target.workflowId},1,${tx.json(json({ ...plan, source_prompt: target.sourcePrompt }))},'initial')`;
      await tx`UPDATE runs SET workflow_version_id=${target.versionId},claimed_by=${store.workerId},claimed_at=now(),heartbeat_at=now(),started_at=COALESCE(started_at,now()) WHERE id=${target.id}`;
      for (const step of plan.steps)
        await tx`INSERT INTO step_states(run_id,step_id,side_effect) VALUES (${target.id},${step.id},${step.side_effect})`;
      await store.emit(tx, target.id, "plan.ready", {
        workflow_version_id: target.versionId,
        version_no: 1,
        plan: { ...plan, source_prompt: target.sourcePrompt },
        layers,
        attempts: 0,
      });
      await store.transition(tx, run, "dry_running");
    });

    const context: ResolveContext = {
      inputs: target.inputs,
      runtime: target.runtime,
      stepOutputs: {},
    };
    const actions: Approval["actions"] = [];
    for (const stepId of layers.flat()) {
      const step = plan.steps.find((s) => s.id === stepId)!;
      const current = await store.run(store.db.client, target.id);
      if (current.cancel_requested_at)
        throw new EngineError(
          "CANCELLED",
          "Cancelled before next preview step",
        );
      if (step.condition && !evaluate(step.condition, context)) {
        await store.db.client.begin(async (tx) => {
          await store.run(tx, target.id, true);
          await tx`UPDATE step_states SET status='skipped',ended_at=now() WHERE run_id=${target.id} AND step_id=${step.id}`;
          await store.emit(tx, target.id, "step.skipped", {
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
      if (!validateToolCall(tool, args, "execution").ok)
        throw new EngineError(
          "INVALID_ARGS",
          "Resolved arguments do not match reviewed tool schema",
        );
      if (tool.sideEffect === "read") {
        const result = await callStep(
          store,
          gateway,
          target.id,
          step,
          tool,
          args,
        );
        if (!result.ok) throw new EngineError("READ_FAILED", result.message!);
        context.stepOutputs[step.id] = result.output;
      } else {
        const intent = resolveValue(step.idempotency_key!, context);
        if (typeof intent !== "string" || !intent)
          throw new EngineError(
            "INVALID_ARGS",
            "Resolved intent key must be a nonempty string",
          );
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
    if (
      actions.some((action) =>
        containsConfiguredSecret(action.resolved_args, store.secrets),
      )
    )
      throw new EngineError(
        "SECRET_IN_WRITE",
        "Write payload contains protected configuration data",
      );
    const persistedPlan = { ...plan, source_prompt: target.sourcePrompt };
    const snapshot = SnapshotSchema.parse({
      format: "b-local-preview-1",
      run_id: target.id,
      user_id: store.userId,
      workflow_version_id: target.versionId,
      plan: persistedPlan,
      inputs: target.inputs,
      runtime: target.runtime,
      time_zone: target.timeZone,
      tools: gateway.tools,
      read_outputs: context.stepOutputs,
      actions,
    });
    await store.db.client.begin(async (tx) => {
      const run = await store.run(tx, target.id, true);
      if (run.cancel_requested_at)
        throw new EngineError("CANCELLED", "Cancelled before preview");
      if (!actions.length) {
        const outputs = Object.fromEntries(
          Object.entries(plan.outputs).map(([key, value]) => [
            key,
            resolveValue(value, context),
          ]),
        );
        await store.transition(tx, run, "succeeded", { outputs });
      } else {
        for (const action of actions) {
          const step = plan.steps.find((s) => s.id === action.step_id)!;
          const tool = gateway.tools.find(
            (t) => t.server === action.server && t.name === action.tool,
          )!;
          const intent = resolveValue(step.idempotency_key!, context) as string;
          await tx`INSERT INTO tool_operations(operation_id,user_id,run_id,workflow_version_id,step_id,tool_server,tool_name,policy_version,intent_key,payload_hash,resolved_args,state,receiver_mode)
            VALUES (${action.operation_id},${store.userId},${target.id},${target.versionId},${action.step_id},${action.server},${action.tool},${action.policy_version},${intent},${action.payload_hash},${tx.json(json(action.resolved_args))},'reserved',${receiverModeFor(tool)})`;
          await tx`UPDATE step_states SET status='ready' WHERE run_id=${target.id} AND step_id=${action.step_id}`;
        }
        const [approval] =
          await tx`INSERT INTO approvals(run_id,workflow_version_id,snapshot_hash,preview,expires_at) VALUES (${target.id},${target.versionId},${hash(snapshot)},${tx.json(json({ ...snapshot, canonical_bytes: canonicalJson(snapshot) }))},clock_timestamp()+interval '10 minutes') RETURNING id,expires_at`;
        await tx`UPDATE runs SET claimed_by=NULL,claimed_at=NULL,heartbeat_at=NULL WHERE id=${target.id}`;
        await store.transition(tx, run, "awaiting_approval");
        await store.emit(tx, target.id, "dryrun.ready", {
          approval_id: approval!.id,
          expires_at: new Date(approval!.expires_at).toISOString(),
          read_count: Object.keys(snapshot.read_outputs).length,
          write_count: actions.length,
        });
      }
      await tx`UPDATE run_outbox SET delivered_at=COALESCE(delivered_at,now()) WHERE run_id=${target.id} AND job_kind='prepare'`;
    });
  } catch (error) {
    await store.db.client.begin(async (tx) => {
      const run = await store.run(tx, target.id, true);
      if (run.status === "succeeded" || run.status === "awaiting_approval") {
        await tx`UPDATE run_outbox SET delivered_at=COALESCE(delivered_at,now()) WHERE run_id=${target.id} AND job_kind='prepare'`;
        return;
      }
      if (run.status !== "failed" && run.status !== "cancelled") {
        await store.closeOpenAttempts(
          tx,
          target.id,
          "Preview stopped before persisting the read outcome",
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
                : "Preview failed before any write",
          },
        );
      }
      await tx`UPDATE run_outbox SET delivered_at=COALESCE(delivered_at,now()) WHERE run_id=${target.id} AND job_kind='prepare'`;
    });
  }
  return store.detail(target.id);
}
