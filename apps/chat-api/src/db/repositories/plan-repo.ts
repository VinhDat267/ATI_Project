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
    // Invalidate/supersede any existing pending plans for this conversation
    await this.pool.query(
      "UPDATE plans SET status = 'superseded' WHERE conv_id = $1 AND status = 'pending'",
      [data.convId]
    );

    const res = await this.pool.query(
      `INSERT INTO plans (conv_id, plan_json, plan_text, plan_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        data.convId,
        JSON.stringify(data.planJson),
        data.planText || null,
        data.planHash,
        data.expiresAt,
      ]
    );
    return res.rows[0];
  }

  async getPlan(id: string): Promise<PlanRow | null> {
    const res = await this.pool.query('SELECT * FROM plans WHERE id = $1', [id]);
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
  async approvePlan(planId: string): Promise<boolean> {
    const res = await this.pool.query(
      "UPDATE plans SET status = 'approved', decided_at = now() WHERE id = $1 AND status = 'pending' AND expires_at > now() RETURNING id",
      [planId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Optimistic locking: only transitions to rejected if currently pending.
   */
  async rejectPlan(planId: string): Promise<boolean> {
    const res = await this.pool.query(
      "UPDATE plans SET status = 'rejected', decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING id",
      [planId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async updatePlanStatus(planId: string, status: string): Promise<void> {
    await this.pool.query('UPDATE plans SET status = $2 WHERE id = $1', [planId, status]);
  }
}
