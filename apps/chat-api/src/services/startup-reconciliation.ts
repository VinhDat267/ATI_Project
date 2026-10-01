import type pg from 'pg';
import type { PlanRow } from '../db/repositories/plan-repo.js';
import type { ExecutionStepRow } from '../db/repositories/step-repo.js';
import { restoredProgress, verifiedRecoverySteps } from './execution-recovery.js';

/** Reconcile a stopped API instance's durable progress before accepting requests.
 * The previous executor must be stopped; this is not a lease for multiple replicas.
 */
export async function reconcileInterruptedExecutions(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  const summaries: { planId: string; unknownSteps: number }[] = [];
  try {
    await client.query('BEGIN');
    const plans = await client.query<PlanRow>(
      `SELECT * FROM plans
       WHERE status IN ('approved', 'executing', 'stopping', 'partial', 'unknown', 'reconciliation_required')
       ORDER BY id FOR UPDATE`,
    );
    for (const plan of plans.rows) {
      const interrupted = await client.query(
        `UPDATE execution_steps
         SET status = 'unknown',
             error_json = $2::jsonb,
             completed_at = statement_timestamp(),
             duration_ms = CASE WHEN started_at IS NULL THEN duration_ms ELSE
               LEAST(2147483647, GREATEST(0, ROUND(EXTRACT(EPOCH FROM statement_timestamp() - started_at) * 1000)))::integer END
         WHERE plan_id = $1 AND status = 'running'
         RETURNING id`,
        [plan.id, JSON.stringify({ category: 'UNKNOWN', message: 'Server restarted while this step was running' })],
      );
      const uncertain = await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM execution_steps WHERE plan_id = $1 AND status = 'unknown')",
        [plan.id],
      );
      const requiresReconciliation = uncertain.rows[0]!.exists
        || ['approved', 'executing', 'stopping', 'unknown'].includes(plan.status);
      let nextStatus = requiresReconciliation ? 'reconciliation_required' : plan.status;
      if (!uncertain.rows[0]!.exists && ['approved', 'executing', 'stopping', 'unknown'].includes(plan.status)) {
        const saved = await client.query<ExecutionStepRow>('SELECT * FROM execution_steps WHERE plan_id = $1', [plan.id]);
        try {
          const progress = restoredProgress(verifiedRecoverySteps(plan), saved.rows);
          if (Object.values(progress.states).every(state => ['succeeded', 'skipped'].includes(state.status))) nextStatus = 'completed';
        } catch { /* Invalid or incomplete evidence remains reconciliation_required. */ }
      }
      const statusChanged = nextStatus !== plan.status;
      if (statusChanged) {
        await client.query('UPDATE plans SET status = $2 WHERE id = $1', [plan.id, nextStatus]);
      }
      if (statusChanged || interrupted.rowCount) {
        summaries.push({ planId: plan.id, unknownSteps: interrupted.rowCount ?? 0 });
      }
    }
    await client.query('COMMIT');
  } catch {
    // PostgreSQL error details can contain entire rows, including private arguments.
    try { await client.query('ROLLBACK'); } catch { /* Preserve the sanitized startup failure. */ }
    throw new Error('Startup execution reconciliation failed');
  } finally {
    client.release();
  }
  for (const summary of summaries) {
    console.info(`[execution-reconciliation] plan=${summary.planId} unknown_steps=${summary.unknownSteps}`);
  }
}
