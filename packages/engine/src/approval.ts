import { ApprovalDecisionSchema } from "@wap/dsl";
import { Store, type Tx, type RunRow, type ApprovalRow } from "./store.js";
import type { Gateway } from "./gateway.js";
import {
  EngineError,
  canonicalJson,
  unpackPreview,
  validateManualPlan,
} from "./snapshot.js";

export async function verifyPreview(
  store: Store,
  tx: Tx,
  run: RunRow,
  approval: ApprovalRow,
  gateway: Gateway,
) {
  const snapshot = unpackPreview(approval.preview, approval.snapshot_hash);
  const [version] =
    await tx`SELECT plan FROM workflow_versions WHERE id=${run.workflow_version_id!} AND workflow_id=${run.workflow_id}`;
  if (
    snapshot.user_id !== store.userId ||
    snapshot.run_id !== run.id ||
    snapshot.workflow_version_id !== run.workflow_version_id ||
    approval.workflow_version_id !== run.workflow_version_id ||
    !version ||
    canonicalJson(snapshot.plan) !== canonicalJson(version.plan) ||
    canonicalJson(snapshot.inputs) !== canonicalJson(run.inputs) ||
    canonicalJson(snapshot.runtime) !== canonicalJson(run.runtime) ||
    snapshot.time_zone !== run.time_zone ||
    canonicalJson(snapshot.tools) !== canonicalJson(gateway.tools)
  )
    throw new EngineError(
      "CONFLICT",
      "Run, plan or tool policy differs from the saved preview",
    );
  await gateway.assertCurrent();
  validateManualPlan(snapshot.plan, gateway.tools);
  return snapshot;
}
export async function decide(
  store: Store,
  gateway: Gateway,
  id: string,
  value: unknown,
) {
  const decision = ApprovalDecisionSchema.parse(value);
  const expired = await store.db.client.begin(async (tx) => {
    const run = await store.run(tx, id, true),
      approval = await store.approval(tx, id, true);
    if (
      run.status !== "awaiting_approval" ||
      run.cancel_requested_at ||
      !approval ||
      approval.decision !== "pending" ||
      decision.approval_id !== approval.id ||
      decision.workflow_version_id !== run.workflow_version_id ||
      decision.snapshot_hash !== approval.snapshot_hash
    )
      throw new EngineError(
        "CONFLICT",
        "Approval decision is stale or already handled",
      );
    await verifyPreview(store, tx, run, approval, gateway);
    const [clock] =
      await tx`SELECT expires_at>clock_timestamp() AS live FROM approvals WHERE id=${approval.id}`;
    if (!clock!.live) {
      await tx`UPDATE approvals SET decision='expired',decided_at=now() WHERE id=${approval.id}`;
      await store.transition(tx, run, "expired", {
        error: "Approval expired before decision",
      });
      return true;
    }
    await tx`UPDATE approvals SET decision=${decision.decision},decided_at=now() WHERE id=${approval.id}`;
    await store.transition(
      tx,
      run,
      decision.decision === "approved" ? "running" : "rejected",
      decision.decision === "approved" ? { job: "execute" } : {},
    );
    return false;
  });
  if (expired)
    throw new EngineError("EXPIRED", "Approval expired; prepare a new run");
  return store.detail(id);
}
