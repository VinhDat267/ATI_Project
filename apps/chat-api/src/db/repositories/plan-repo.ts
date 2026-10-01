import type pg from 'pg';

export interface PlanRow {
  id: string;
  conv_id: string;
  plan_json: any;
  plan_text: string | null;
  plan_hash: string;
  status: string;
  expires_at: Date;
  decided_at: Date | null;
  created_at: Date;
  revision?: string;
}

export class PlanRepo {
  constructor(private pool: pg.Pool) {}

  async createPlan(data: {
    convId: string;
    planJson: any;
    planText?: string;
    planHash: string;
    expiresAt: Date;
  }): Promise<PlanRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // The parent conversation row serializes proposals, including when no plan exists yet.
      const owner = await client.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [data.convId]);
      if (!owner.rowCount) throw new Error('Conversation not found');
      await client.query(
        "UPDATE plans SET status = 'superseded' WHERE conv_id = $1 AND status = 'pending'",
        [data.convId]
      );
      const res = await client.query(
        `INSERT INTO plans (conv_id, plan_json, plan_text, plan_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [data.convId, JSON.stringify(data.planJson), data.planText || null, data.planHash, data.expiresAt]
      );
      await client.query('COMMIT');
      return res.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getPlan(id: string): Promise<PlanRow | null> {
    const res = await this.pool.query('SELECT *, xmin::text AS revision FROM plans WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async getPendingPlan(convId: string): Promise<PlanRow | null> {
    const res = await this.pool.query(
      "SELECT * FROM plans WHERE conv_id = $1 AND status = 'pending' AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
      [convId]
    );
    return res.rows[0] || null;
  }

  /**
   * Optimistic locking: only transitions to approved if currently pending AND not expired.
   */
  async approvePlan(planId: string, expectedHash: string, userId: string): Promise<boolean> {
    const res = await this.pool.query(
      "UPDATE plans SET status = 'approved', decided_at = now() WHERE id = $1 AND plan_hash = $2 AND status = 'pending' AND expires_at > now() AND EXISTS (SELECT 1 FROM conversations WHERE conversations.id = plans.conv_id AND conversations.user_id = $3) RETURNING id",
      [planId, expectedHash, userId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Optimistic locking: only transitions to rejected if currently pending.
   */
  async rejectPlan(planId: string, userId: string): Promise<boolean> {
    const res = await this.pool.query(
      "UPDATE plans SET status = 'rejected', decided_at = now() WHERE id = $1 AND status = 'pending' AND expires_at > now() AND EXISTS (SELECT 1 FROM conversations WHERE conversations.id = plans.conv_id AND conversations.user_id = $2) RETURNING id",
      [planId, userId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async updatePlanStatus(planId: string, status: string): Promise<void> {
    await this.pool.query('UPDATE plans SET status = $2 WHERE id = $1', [planId, status]);
  }

  /** Claim exactly the approved durable snapshot read by the recovery request.
   * xmin also rejects a stale request if a prior run returned to the same status.
   */
  async claimRecovery(plan: PlanRow, userId: string, nextStatus: 'executing' | 'stopped'): Promise<boolean> {
    if (!plan.revision) return false;
    const result = await this.pool.query(
      `UPDATE plans SET status = $6
       WHERE id = $1 AND plan_hash = $2 AND status = $3 AND xmin::text = $4
         AND status IN ('partial', 'reconciliation_required') AND decided_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM conversations WHERE conversations.id = plans.conv_id AND conversations.user_id = $5)
       RETURNING id`,
      [plan.id, plan.plan_hash, plan.status, plan.revision, userId, nextStatus],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getLatestExecutedPlan(convId: string): Promise<PlanRow | null> {
    const result = await this.pool.query(
      `SELECT *, xmin::text AS revision FROM plans
       WHERE conv_id = $1 AND status IN ('approved', 'executing', 'stopping', 'partial', 'unknown', 'reconciliation_required', 'completed', 'stopped', 'failed')
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [convId],
    );
    return result.rows[0] ?? null;
  }
}
