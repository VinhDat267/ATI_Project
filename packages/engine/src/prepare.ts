import { randomUUID } from "node:crypto";
import {
  buildRuntime,
  validateGraph,
  resolveArgs,
  resolveValue,
  evaluate,
  validateToolCall,
  type ResolveContext,
  type Approval,
} from "@wap/dsl";
import { Store } from "./store.js";
import type { Gateway } from "./gateway.js";
import { callStep } from "./attempts.js";
import {
  EngineError,
  SnapshotSchema,
  validateManualPlan,
  resolveInputs,
  canonicalJson,
  hash,
  json,
  payloadHash,
} from "./snapshot.js";
import { receiverModeFor } from "./receiver-policy.js";

export async function prepare(
  store: Store,
  gateway: Gateway,
  value: unknown,
  options: { inputs?: unknown; timeZone?: string } = {},
) {
  const plan = validateManualPlan(value, gateway.tools),
    inputs = resolveInputs(plan, options.inputs);
  const timeZone = options.timeZone ?? "Asia/Ho_Chi_Minh",
    id = randomUUID(),
    workflowId = randomUUID(),
    versionId = randomUUID();
  const runtime = buildRuntime({ runId: id, userId: store.userId, timeZone });
  const layers = validateGraph(plan).layers;
  return store.withWorker(
    async () => {
      await gateway.assertCurrent();
      await store.db.client.begin(async (tx) => {
        await tx`INSERT INTO workflows(id,user_id,name,source_prompt) VALUES (${workflowId},${store.userId},${plan.name},${plan.source_prompt})`;
        await tx`INSERT INTO runs(id,user_id,workflow_id,source_prompt,inputs,runtime,time_zone) VALUES (${id},${store.userId},${workflowId},${plan.source_prompt},${tx.json(json(inputs))},${tx.json(json(runtime))},${timeZone})`;
        const run = await store.run(tx, id, true);
        await store.emit(tx, id, "run.status", {
          status: "planning",
          previous: null,
        });
        await store.transition(tx, run, "validating");
        await tx`INSERT INTO workflow_versions(id,workflow_id,version_no,plan,origin) VALUES (${versionId},${workflowId},1,${tx.json(json(plan))},'initial')`;
        await tx`UPDATE runs SET workflow_version_id=${versionId},claimed_by=${store.workerId},claimed_at=now(),heartbeat_at=now(),started_at=now() WHERE id=${id}`;
        for (const step of plan.steps)
          await tx`INSERT INTO step_states(run_id,step_id,side_effect) VALUES (${id},${step.id},${step.side_effect})`;
        await store.emit(tx, id, "plan.ready", {
          workflow_version_id: versionId,
          version_no: 1,
          plan,
          layers,
          attempts: 0,
        });
        await store.transition(tx, run, "dry_running", { job: "prepare" });
        await tx`UPDATE run_outbox SET delivered_at=now() WHERE run_id=${id} AND job_kind='prepare'`;
      });
      try {
        const context: ResolveContext = { inputs, runtime, stepOutputs: {} };
        const actions: Approval["actions"] = [];
        for (const stepId of layers.flat()) {
          const step = plan.steps.find((s) => s.id === stepId)!;
          const run = await store.run(store.db.client, id);
          if (run.cancel_requested_at)
            throw new EngineError(
              "CANCELLED",
              "Cancelled before next preview step",
            );
          if (step.condition && !evaluate(step.condition, context)) {
            await store.db.client.begin(async (tx) => {
              await store.run(tx, id, true);
              await tx`UPDATE step_states SET status='skipped',ended_at=now() WHERE run_id=${id} AND step_id=${step.id}`;
              await store.emit(tx, id, "step.skipped", {
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
            const result = await callStep(store, gateway, id, step, tool, args);
            if (!result.ok)
              throw new EngineError("READ_FAILED", result.message!);
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
        const snapshot = SnapshotSchema.parse({
          format: "b-local-preview-1",
          run_id: id,
          user_id: store.userId,
          workflow_version_id: versionId,
          plan,
          inputs,
          runtime,
          time_zone: timeZone,
          tools: gateway.tools,
          read_outputs: context.stepOutputs,
          actions,
        });
        await store.db.client.begin(async (tx) => {
          const run = await store.run(tx, id, true);
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
            return;
          }
          for (const action of actions) {
            const step = plan.steps.find((s) => s.id === action.step_id)!;
            const tool = gateway.tools.find(
              (t) => t.server === action.server && t.name === action.tool,
            )!;
            const intent = resolveValue(
              step.idempotency_key!,
              context,
            ) as string;
            const receiverMode = receiverModeFor(tool);
            await tx`INSERT INTO tool_operations(operation_id,user_id,run_id,workflow_version_id,step_id,tool_server,tool_name,policy_version,intent_key,payload_hash,resolved_args,state,receiver_mode)
            VALUES (${action.operation_id},${store.userId},${id},${versionId},${action.step_id},${action.server},${action.tool},${action.policy_version},${intent},${action.payload_hash},${tx.json(json(action.resolved_args))},'reserved',${receiverMode})`;
            await tx`UPDATE step_states SET status='ready' WHERE run_id=${id} AND step_id=${action.step_id}`;
          }
          const [approval] =
            await tx`INSERT INTO approvals(run_id,workflow_version_id,snapshot_hash,preview,expires_at) VALUES (${id},${versionId},${hash(snapshot)},${tx.json(json({ ...snapshot, canonical_bytes: canonicalJson(snapshot) }))},clock_timestamp()+interval '10 minutes') RETURNING id,expires_at`;
          await tx`UPDATE runs SET claimed_by=NULL,claimed_at=NULL,heartbeat_at=NULL WHERE id=${id}`;
          await store.transition(tx, run, "awaiting_approval");
          await store.emit(tx, id, "dryrun.ready", {
            approval_id: approval!.id,
            expires_at: new Date(approval!.expires_at).toISOString(),
            read_count: Object.keys(snapshot.read_outputs).length,
            write_count: actions.length,
          });
        });
      } catch (error) {
        await store.db.client.begin(async (tx) => {
          const run = await store.run(tx, id, true);
          if (run.status !== "dry_running") return;
          await store.closeOpenAttempts(
            tx,
            id,
            "Preview stopped before persisting the read outcome",
          );
          await store.transition(
            tx,
            run,
            run.cancel_requested_at ? "cancelled" : "failed",
            {
              error:
                error instanceof EngineError
                  ? error.message
                  : "Preview failed before any write",
            },
          );
        });
      }
      return store.detail(id);
    },
    () => gateway.close(),
  );
}
