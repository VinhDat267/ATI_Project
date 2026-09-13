import {
  resolveArgs,
  resolveValue,
  validateToolCall,
  type ResolveContext,
} from "@wap/dsl";
import { Store } from "./store.js";
import type { Gateway } from "./gateway.js";
import { verifyPreview } from "./approval.js";
import { callStep } from "./attempts.js";
import {
  EngineError,
  BeforeDispatchError,
  canonicalJson,
  payloadHash,
} from "./snapshot.js";

export async function execute(store: Store, gateway: Gateway, id: string) {
  return store.withWorker(
    async () => {
      const snapshot = await store.db.client.begin(async (tx) => {
        const run = await store.run(tx, id, true),
          approval = await store.approval(tx, id, true);
        if (
          run.status !== "running" ||
          run.claimed_by ||
          run.cancel_requested_at ||
          !approval ||
          approval.decision !== "approved"
        )
          throw new EngineError(
            "CONFLICT",
            "Run is not a fresh approved execution",
          );
        const saved = await verifyPreview(store, tx, run, approval, gateway);
        const [clock] =
          await tx`SELECT expires_at>clock_timestamp() AS live FROM approvals WHERE id=${approval.id}`;
        if (!clock!.live) {
          await tx`UPDATE approvals SET decision='expired' WHERE id=${approval.id}`;
          await store.transition(tx, run, "expired", {
            error: "Approval expired before execution",
          });
          return null;
        }
        const jobs =
          await tx`UPDATE run_outbox SET delivered_at=now() WHERE run_id=${id} AND job_kind='execute' AND delivered_at IS NULL RETURNING id`;
        if (jobs.length !== 1)
          throw new EngineError(
            "CONFLICT",
            "Execution job has already been claimed",
          );
        await tx`UPDATE runs SET claimed_by=${store.workerId},claimed_at=now(),heartbeat_at=now() WHERE id=${id}`;
        return saved;
      });
      if (!snapshot) return store.detail(id);
      const context: ResolveContext = {
        inputs: snapshot.inputs,
        runtime: snapshot.runtime as ResolveContext["runtime"],
        stepOutputs: { ...snapshot.read_outputs },
      };
      try {
        for (const action of snapshot.actions) {
          const step = snapshot.plan.steps.find(
            (s) => s.id === action.step_id,
          )!;
          const tool = snapshot.tools.find(
            (t) => t.server === action.server && t.name === action.tool,
          )!;
          const auth = await store.db.client.begin(async (tx) => {
            const run = await store.run(tx, id, true),
              approval = await store.approval(tx, id, true);
            if (run.cancel_requested_at) {
              if (run.status === "running")
                await store.transition(tx, run, "cancelled");
              return null;
            }
            if (
              run.status !== "running" ||
              run.claimed_by !== store.workerId ||
              !approval ||
              approval.decision !== "approved"
            )
              throw new EngineError("CONFLICT", "Run is no longer approved");
            await verifyPreview(store, tx, run, approval, gateway);
            const resolved = resolveArgs(step.tool.args, context);
            if (
              canonicalJson(resolved) !== canonicalJson(action.resolved_args) ||
              !validateToolCall(tool, resolved, "execution").ok ||
              payloadHash(tool, resolved) !== action.payload_hash
            )
              throw new EngineError(
                "CONFLICT",
                "Resolved action changed after preview",
              );
            const [op] =
              await tx`SELECT * FROM tool_operations WHERE operation_id=${action.operation_id} AND user_id=${store.userId} FOR UPDATE`;
            if (
              !op ||
              op.run_id !== id ||
              op.workflow_version_id !== snapshot.workflow_version_id ||
              op.step_id !== step.id ||
              op.tool_server !== tool.server ||
              op.tool_name !== tool.name ||
              op.policy_version !== tool.policyVersion ||
              op.state !== "reserved" ||
              op.payload_hash !== action.payload_hash ||
              canonicalJson(op.resolved_args) !== canonicalJson(resolved)
            )
              throw new EngineError(
                "CONFLICT",
                "Operation is already dispatched or differs from approval",
              );
            const [clock] =
              await tx`SELECT expires_at>clock_timestamp() AS live FROM approvals WHERE id=${approval.id}`;
            if (!clock!.live) {
              await tx`UPDATE approvals SET decision='expired' WHERE id=${approval.id}`;
              await store.transition(tx, run, "expired", {
                error: "Approval expired before next write",
              });
              return null;
            }
            await tx`UPDATE tool_operations SET state='in_flight',claimed_at=now() WHERE operation_id=${action.operation_id} AND state='reserved'`;
            await tx`UPDATE runs SET heartbeat_at=now() WHERE id=${id}`;
            return {
              approval_id: approval.id,
              operation_id: action.operation_id,
              snapshot_hash: approval.snapshot_hash,
            };
          });
          if (!auth) return store.detail(id);
          const outcome = await callStep(
            store,
            gateway,
            id,
            step,
            tool,
            action.resolved_args,
            auth,
          );
          if (!outcome.ok) {
            await store.db.client.begin(async (tx) => {
              const run = await store.run(tx, id, true);
              await store.transition(
                tx,
                run,
                outcome.certainty === "unknown"
                  ? "reconciliation_required"
                  : "failed",
                { error: outcome.message! },
              );
            });
            return store.detail(id);
          }
          context.stepOutputs[step.id] = outcome.output;
        }
        await store.db.client.begin(async (tx) => {
          const run = await store.run(tx, id, true);
          if (run.status !== "running") return;
          const outputs = Object.fromEntries(
            Object.entries(snapshot.plan.outputs).map(([key, value]) => [
              key,
              resolveValue(value, context),
            ]),
          );
          await store.transition(
            tx,
            run,
            run.cancel_requested_at ? "cancelled" : "succeeded",
            { outputs },
          );
        });
      } catch (error) {
        await store.db.client.begin(async (tx) => {
          const run = await store.run(tx, id, true);
          if (run.status !== "running") return;
          const beforeDispatch = error instanceof BeforeDispatchError;
          const changed =
            await tx`UPDATE tool_operations SET state=${beforeDispatch ? "known_failed" : "unknown"},error_message=${beforeDispatch ? "Stopped before MCP dispatch" : "Controller interrupted after claim"} WHERE run_id=${id} AND state='in_flight' RETURNING operation_id`;
          const uncertain = beforeDispatch ? [] : changed;
          await store.closeOpenAttempts(
            tx,
            id,
            "Controller stopped before persisting the attempt outcome",
            beforeDispatch ? "before_dispatch" : "unknown",
          );
          await store.transition(
            tx,
            run,
            uncertain.length
              ? "reconciliation_required"
              : run.cancel_requested_at
                ? "cancelled"
                : "failed",
            {
              error:
                error instanceof EngineError
                  ? error.message
                  : "Execution interrupted; inspect operation receipts",
            },
          );
        });
      }
      return store.detail(id);
    },
    () => gateway.close(),
  );
}
