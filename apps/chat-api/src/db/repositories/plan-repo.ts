import type pg from 'pg';
import { isDeepStrictEqual } from 'node:util';
import { isUuid } from './uuid.js';
import { SlackDerivedLineageRepo } from './slack-derived-lineage-repo.js';
import { SlackPolicyService } from '../../services/slack/policy-service.js';
import { guardPlanInTransaction,guardStepRowsInTransaction,planSelectors,type SlackPlanWriteContext } from '../../services/slack/slack-plan-lineage.js';
import { hasSlackMarker } from '../../services/slack/slack-message-selectors.js';

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
  resource_labels?: Record<string, string>;
}

export class PlanRepo {
  private readonly slack:SlackDerivedLineageRepo;
  constructor(private pool: pg.Pool,slack?:SlackDerivedLineageRepo) {this.slack=slack??new SlackDerivedLineageRepo(pool,new SlackPolicyService(pool));}

  private async transaction<T>(work:(client:pg.PoolClient)=>Promise<T>):Promise<T>{
    const c=await this.pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5s'");const result=await work(c);await c.query('COMMIT');return result;}
    catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
  }

  async createSlackPlan(data:Parameters<PlanRepo['createPlan']>[0],context:SlackPlanWriteContext,held?:pg.PoolClient,signal?:AbortSignal):Promise<PlanRow>{
    const snapshot=structuredClone({data,context});
    const save=async(client:pg.PoolClient)=>{
      signal?.throwIfAborted();const owner=snapshot.context.segments[0]?.sourceRef.binding.atiUserId;
      if(!owner)throw new Error('SLACK_PROVENANCE_REQUIRED');
      await this.slack.prepareConversationWriteInTransaction(client,snapshot.data.convId,owner,snapshot.context.segments,'planning');
      const selectors=snapshot.context.selectors??planSelectors(snapshot.data);
      if(!['plan_json','plan_text','plan_hash'].every(s=>selectors.includes(s))||new Set(selectors).size!==selectors.length||selectors.length>256)throw new Error('SLACK_PLAN_MANIFEST_INVALID');
      const row=await this.insertPlan(client,snapshot.data);
      for(const selector of selectors)await this.slack.registerDerivedCopyInTransaction(client,{atiUserId:owner,targetKind:'plan_step_arg',targetId:row.id,targetSubId:selector,segments:snapshot.context.segments});
      await client.query('UPDATE plans SET slack_lineage_manifest=$2 WHERE id=$1',[row.id,JSON.stringify(selectors)]);signal?.throwIfAborted();return row;
    };return held?save(held):this.transaction(save);
  }

  async createPlan(data: {
    convId: string;
    planJson: any;
    planText?: string;
    planHash: string;
    expiresAt: Date;
    resourceLabels?: Record<string, string>;
  },
  /** A client inside the caller's transaction; otherwise the plan is saved in a transaction of its own. */
  db?: pg.PoolClient): Promise<PlanRow> {
    if(hasSlackMarker(data.planJson)||hasSlackMarker(data.resourceLabels))throw new Error('SLACK_PROVENANCE_REQUIRED');
    if (db) return this.insertPlan(db, data);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const plan = await this.insertPlan(client, data);
      await client.query('COMMIT');
      return plan;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async insertPlan(client: pg.PoolClient, data: Parameters<PlanRepo['createPlan']>[0]): Promise<PlanRow> {
    // The parent conversation row serializes proposals, including when no plan exists yet.
    const owner = await client.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [data.convId]);
    if (!owner.rowCount) throw new Error('Conversation not found');
    await client.query(
      "UPDATE plans SET status = 'superseded' WHERE conv_id = $1 AND status = 'pending'",
      [data.convId]
    );
    const res = await client.query(
      `INSERT INTO plans (conv_id, plan_json, plan_text, plan_hash, expires_at, resource_labels)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [data.convId, JSON.stringify(data.planJson), data.planText || null, data.planHash, data.expiresAt, JSON.stringify(data.resourceLabels ?? {})]
    );
    return res.rows[0];
  }

  async getPlan(id: string,purpose:'planning'|'manual_lookup'='manual_lookup'): Promise<PlanRow | null> {
    if (!isUuid(id)) return null;
    return this.transaction(async client=>{
      if(!(await client.query('SELECT id FROM plans WHERE id=$1',[id])).rowCount)return null;
      return (await guardPlanInTransaction(client,this.slack,id,purpose)).row;
    });
  }

  async getPendingPlan(convId: string): Promise<PlanRow | null> {
    const res = await this.pool.query(
      "SELECT * FROM plans WHERE conv_id = $1 AND status = 'pending' AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
      [convId]
    );
    return res.rows[0]?this.getPlan(res.rows[0].id):null;
  }

  /**
   * Optimistic locking: only transitions to approved if currently pending AND not expired.
   */
  async approvePlan(planId: string, expectedHash: string, userId: string): Promise<boolean> {
    return this.transaction(async client=>{
    const context=await guardPlanInTransaction(client,this.slack,planId,'planning');
    if(!context.allowed)return false;
    const res = await client.query(
      "UPDATE plans SET status = 'approved', decided_at = now() WHERE id = $1 AND plan_hash = $2 AND status = 'pending' AND expires_at > now() AND EXISTS (SELECT 1 FROM conversations WHERE conversations.id = plans.conv_id AND conversations.user_id = $3) RETURNING id",
      [planId, expectedHash, userId]
    );
    return (res.rowCount ?? 0) > 0;
    });
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
    await this.pool.query(`UPDATE plans SET status=$2 WHERE id=$1 AND
      (slack_lineage_manifest IS NULL OR status NOT IN ('failed','superseded'))`, [planId, status]);
  }

  async assertSourceDispatchAllowed(planId:string,userId:string,expectedHash:string,stepId:string,tool:string,signal?:AbortSignal):Promise<void>{
    signal?.throwIfAborted();await this.transaction(async client=>{
      const checked=await guardPlanInTransaction(client,this.slack,planId,'planning');
      const owner=(await client.query('SELECT user_id FROM conversations WHERE id=$1',[checked.row.conv_id])).rows[0]?.user_id;
      if(!checked.allowed||owner!==userId||checked.row.plan_hash!==expectedHash||!['approved','executing'].includes(checked.row.status)||
        !checked.row.plan_json.steps?.some((s:any)=>s.id===stepId&&s.tool===tool))throw Object.assign(new Error('SLACK_SOURCE_UNAVAILABLE'),{category:'AUTH_ERROR',details:{requestSent:false}});
      const stored=(await client.query('SELECT * FROM execution_steps WHERE plan_id=$1 ORDER BY step_id FOR SHARE',[planId])).rows;
      const safe=await guardStepRowsInTransaction(client,this.slack,checked,stored,'planning'),step=safe.find(s=>s.step_id===stepId&&s.tool===tool);
      const approved=checked.row.plan_json.steps.find((s:any)=>s.id===stepId);
      if(!step||safe.some(s=>s.status==='unknown')||!isDeepStrictEqual(step.args_json,approved.args??{}))throw Object.assign(new Error('SLACK_SOURCE_UNAVAILABLE'),{category:'AUTH_ERROR',details:{requestSent:false}});
      signal?.throwIfAborted();
    });
  }

  async getSourceExecutionSnapshot(planId:string):Promise<{plan:PlanRow;steps:any[]}>{
    return this.transaction(async client=>{
      const checked=await guardPlanInTransaction(client,this.slack,planId,'manual_lookup');
      const rows=(await client.query('SELECT * FROM execution_steps WHERE plan_id=$1 ORDER BY step_id FOR SHARE',[planId])).rows;
      return {plan:checked.row,steps:await guardStepRowsInTransaction(client,this.slack,checked,rows,'manual_lookup')};
    });
  }

  /** Claim exactly the approved durable snapshot read by the recovery request.
   * xmin also rejects a stale request if a prior run returned to the same status.
   */
  async claimRecovery(plan: PlanRow, userId: string, nextStatus: 'executing' | 'stopped'): Promise<boolean> {
    if (!plan.revision) return false;
    return this.transaction(async client=>{
    const checked=await guardPlanInTransaction(client,this.slack,plan.id,'planning');
    if(!checked.allowed)return false;
    const result = await client.query(
      `UPDATE plans SET status = $6
       WHERE id = $1 AND plan_hash = $2 AND status = $3 AND xmin::text = $4
         AND status IN ('partial', 'reconciliation_required') AND decided_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM conversations WHERE conversations.id = plans.conv_id AND conversations.user_id = $5)
       RETURNING id`,
      [plan.id, plan.plan_hash, plan.status, plan.revision, userId, nextStatus],
    );
    return (result.rowCount ?? 0) > 0;
    });
  }

  async getLatestExecutedPlan(convId: string): Promise<PlanRow | null> {
    const result = await this.pool.query(
      `SELECT *, xmin::text AS revision FROM plans
       WHERE conv_id = $1 AND status IN ('approved', 'executing', 'stopping', 'partial', 'unknown', 'reconciliation_required', 'completed', 'stopped', 'failed')
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [convId],
    );
    return result.rows[0]?this.getPlan(result.rows[0].id):null;
  }
}
