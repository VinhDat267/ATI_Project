import { TERMINAL_STATUSES, normalizeToolResult } from "@wap/dsl";
import { Store } from "./store.js";
import { canonicalJson, unpackPreview, payloadHash } from "./snapshot.js";
export async function cancel(store: Store, id: string) {
  await store.db.client.begin(async (tx) => {
    const run = await store.run(tx, id, true);
    if (TERMINAL_STATUSES.includes(run.status)) return;
    await tx`UPDATE runs SET cancel_requested_at=COALESCE(cancel_requested_at,now()) WHERE id=${id}`;
    const active =
      await tx`SELECT id FROM step_states WHERE run_id=${id} AND status='running'`;
    const dispatched =
      await tx`SELECT operation_id FROM tool_operations WHERE run_id=${id} AND state='in_flight'`;
    if (active.length || dispatched.length) return; // Finish/inspect the in-flight call before a terminal event.
    await tx`UPDATE approvals SET decision='superseded' WHERE run_id=${id} AND decision IN ('pending','approved')`;
    await tx`UPDATE run_outbox SET delivered_at=COALESCE(delivered_at,now()) WHERE run_id=${id}`;
    const unknown =
      await tx`SELECT 1 FROM tool_operations WHERE run_id=${id} AND state='unknown' LIMIT 1`;
    await store.transition(
      tx,
      run,
      unknown.length ? "reconciliation_required" : "cancelled",
      unknown.length
        ? { error: "Cancelled with an unresolved write; inspect receipts" }
        : {},
    );
  });
  return store.detail(id);
}
export async function recoverOrphans(store: Store) {
  return store.withWorker(async () => {
    const candidates = await store.db
      .client`SELECT id FROM runs WHERE user_id=${store.userId} AND claimed_by IS NOT NULL AND status IN ('planning','validating','dry_running','running','replanning') ORDER BY created_at`;
    const recovered: { run_id: string; status: string }[] = [];
    for (const candidate of candidates)
      await store.db.client.begin(async (tx) => {
        const run = await store.run(tx, candidate.id, true);
        await store.assertWorker(tx);
        if (TERMINAL_STATUSES.includes(run.status)) return;
        const ops =
          await tx`UPDATE tool_operations SET state='unknown',error_message='Orphaned worker after dispatch' WHERE run_id=${run.id} AND state='in_flight' RETURNING operation_id`;
        const unknown =
          await tx`SELECT operation_id FROM tool_operations WHERE run_id=${run.id} AND state='unknown'`;
        const uncertain = ops.length + unknown.length > 0;
        await store.closeOpenAttempts(
          tx,
          run.id,
          "Worker stopped before recording outcome",
        );
        await tx`UPDATE run_outbox SET delivered_at=COALESCE(delivered_at,now()) WHERE run_id=${run.id}`;
        await store.transition(
          tx,
          run,
          uncertain ? "reconciliation_required" : "failed",
          {
            error: uncertain
              ? "Worker stopped after write dispatch; inspect receipts"
              : "Worker stopped before any uncertain write; no automatic resume",
          },
        );
        recovered.push({ run_id: run.id, status: run.status });
      });
    return recovered;
  });
}
/** Receipt inspection never resumes execution or changes the historical outcome. */
export async function reconcile(store: Store, id: string) {
  await store.run(store.db.client, id);
  const approval = await store.approval(store.db.client, id);
  const snapshot = approval
    ? unpackPreview(approval.preview, approval.snapshot_hash)
    : undefined;
  const operations = await store.db
    .client`SELECT o.*,r.tool_name AS receipt_tool,r.policy_version AS receipt_policy,r.payload_hash AS receipt_hash,r.result AS receipt_result FROM tool_operations o LEFT JOIN hub_receipts r ON r.user_id=o.user_id AND r.operation_id=o.operation_id WHERE o.run_id=${id} AND o.user_id=${store.userId} ORDER BY o.created_at,o.step_id`;
  return {
    run_id: id,
    read_only: true,
    operations: operations.map((op) => {
      const action = snapshot?.actions.find(
        (a) => a.operation_id === op.operation_id,
      );
      const tool = snapshot?.tools.find(
        (t) => t.name === op.tool_name && t.server === op.tool_server,
      );
      const matched =
        !!action &&
        !!tool &&
        op.run_id === snapshot!.run_id &&
        op.user_id === snapshot!.user_id &&
        op.workflow_version_id === snapshot!.workflow_version_id &&
        op.step_id === action.step_id &&
        op.tool_server === action.server &&
        op.tool_name === action.tool &&
        op.policy_version === action.policy_version &&
        op.policy_version === tool.policyVersion &&
        payloadHash(tool, op.resolved_args) === op.payload_hash &&
        action.payload_hash === op.payload_hash &&
        canonicalJson(action.resolved_args) ===
          canonicalJson(op.resolved_args) &&
        op.receipt_tool === op.tool_name &&
        op.receipt_policy === op.policy_version &&
        op.receipt_hash === op.payload_hash &&
        normalizeToolResult(tool, { structuredContent: op.receipt_result }).ok;
      return {
        operation_id: op.operation_id,
        step_id: op.step_id,
        state: op.state,
        receipt: matched
          ? "confirmed"
          : op.receipt_hash
            ? "conflict"
            : "not_observed",
        result: matched ? op.receipt_result : null,
      };
    }),
  };
}
