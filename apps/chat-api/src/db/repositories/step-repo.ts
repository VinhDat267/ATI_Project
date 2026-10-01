import type pg from 'pg';

export interface ExecutionStepRow {
  id: string;
  plan_id: string;
  step_id: string;
  tool: string;
  args_json: any;
  status: string;
  output_json: any;
  error_json: any;
  requested_by: string;
  started_at: Date | null;
  completed_at: Date | null;
  duration_ms: number | null;
}

export class StepRepo {
  constructor(private pool: pg.Pool) {}

  async createStep(data: {
    planId: string;
    stepId: string;
    tool: string;
    argsJson?: any;
    requestedBy?: string;
  }): Promise<ExecutionStepRow> {
    const res = await this.pool.query(
      `INSERT INTO execution_steps (plan_id, step_id, tool, args_json, status, requested_by)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING *`,
      [
        data.planId,
        data.stepId,
        data.tool,
        JSON.stringify(data.argsJson ?? {}),
        data.requestedBy || 'system',
      ]
    );
    return res.rows[0];
  }

  async updateStepStatus(
    id: string,
    status: string,
    outputJson?: any,
    errorJson?: any,
    durationMs?: number
  ): Promise<ExecutionStepRow> {
    // Timing comes from the database clock: a step starts when it turns running
    // (again, on retry) and its duration runs from that start to the terminal status.
    const res = await this.pool.query(
      `UPDATE execution_steps
       SET status = $2,
           output_json = COALESCE($3, output_json),
           error_json = COALESCE($4, error_json),
           started_at = CASE WHEN $2 = 'running' THEN clock_timestamp() ELSE started_at END,
           completed_at = CASE WHEN $2 IN ('succeeded', 'failed', 'skipped', 'unknown') THEN clock_timestamp()
                               WHEN $2 = 'running' THEN NULL ELSE completed_at END,
           duration_ms = CASE
             WHEN $2 = 'running' THEN NULL
             WHEN $5::integer IS NOT NULL THEN $5::integer
             WHEN $2 IN ('succeeded', 'failed', 'unknown') AND started_at IS NOT NULL
               THEN ROUND(EXTRACT(EPOCH FROM clock_timestamp() - started_at) * 1000)::integer
             ELSE duration_ms END
       WHERE id = $1
       RETURNING *`,
      [
        id,
        status,
        outputJson ? JSON.stringify(outputJson) : null,
        errorJson ? JSON.stringify(errorJson) : null,
        durationMs ?? null,
      ]
    );
    return res.rows[0];
  }

  async listSteps(planId: string): Promise<ExecutionStepRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM execution_steps
       WHERE plan_id = $1
       ORDER BY step_id ASC`,
      [planId]
    );
    return res.rows;
  }
}
