import type pg from 'pg';
import { isDeepStrictEqual } from 'node:util';
import { SlackDerivedLineageRepo } from './slack-derived-lineage-repo.js';
import { SlackPolicyService } from '../../services/slack/policy-service.js';
import { guardPlanInTransaction,guardStepRowsInTransaction,tagSlackSourceArtifact,uniqueSegments,planSelectors } from '../../services/slack/slack-plan-lineage.js';
import type { DerivedSegmentInput } from './slack-derived-lineage-repo.js';
import { isBoundSlackReadPlan } from '../../services/slack/slack-read-plan.js';
import { JSON_TOMBSTONE } from '../../services/slack/slack-artifact-targets.js';
import { hasSlackMarker } from '../../services/slack/slack-message-selectors.js';
import { sealPlanOrigin } from '../../services/slack/slack-plan-origin.js';

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
  private readonly slack:SlackDerivedLineageRepo;
  constructor(private pool: pg.Pool,slack?:SlackDerivedLineageRepo) {this.slack=slack??new SlackDerivedLineageRepo(pool,new SlackPolicyService(pool));}
  private async transaction<T>(work:(client:pg.PoolClient)=>Promise<T>):Promise<T>{
    const c=await this.pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5s'");const result=await work(c);await c.query('COMMIT');return result;}
    catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
  }

  async createStep(data: {
    planId: string;
    stepId: string;
    tool: string;
    argsJson?: any;
    requestedBy?: string;
  }): Promise<ExecutionStepRow> {
    const snapshot=structuredClone(data);
    return this.transaction(async client=>{
    const context=await guardPlanInTransaction(client,this.slack,snapshot.planId,'planning');
    if(!context.allowed)throw new Error('SLACK_SOURCE_UNAVAILABLE');
    if(context.source){
      const approved=context.row.plan_json.steps?.find((s:any)=>s.id===snapshot.stepId);
      if(!approved||approved.tool!==snapshot.tool||!isDeepStrictEqual(approved.args??{},snapshot.argsJson??{})||
        snapshot.requestedBy!==context.segments[0]!.sourceRef.binding.atiUserId)throw new Error('SLACK_STEP_SNAPSHOT_MISMATCH');
    }else if(hasSlackMarker(snapshot.argsJson))throw new Error('SLACK_PROVENANCE_REQUIRED');
    const res = await client.query(
      `INSERT INTO execution_steps (plan_id, step_id, tool, args_json, status, requested_by)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       RETURNING *`,
      [
        snapshot.planId,
        snapshot.stepId,
        snapshot.tool,
        JSON.stringify(snapshot.argsJson ?? {}),
        snapshot.requestedBy || 'system',
      ]
    );
    const row=res.rows[0];
    if(context.source){await this.slack.registerDerivedCopyInTransaction(client,{atiUserId:context.segments[0]!.sourceRef.binding.atiUserId,targetKind:'plan_step_arg',targetId:row.id,targetSubId:'args_json',segments:context.segments});
      await client.query('UPDATE execution_steps SET slack_lineage_manifest=$2 WHERE id=$1',[row.id,JSON.stringify(['args_json'])]);tagSlackSourceArtifact(row);}
    else await sealPlanOrigin(client,'execution_steps',row.id,'step_writer');
    delete row.slack_lineage_manifest;return row;
    });
  }

  async updateStepStatus(
    id: string,
    status: string,
    outputJson?: any,
    errorJson?: any,
    durationMs?: number
  ): Promise<ExecutionStepRow> {
    const snapshot=structuredClone({status,outputJson,errorJson,durationMs});
    return this.transaction(async client=>{
    const found=(await client.query('SELECT plan_id FROM execution_steps WHERE id=$1',[id])).rows[0];
    if(!found)throw new Error('STEP_NOT_FOUND');
    const context=await guardPlanInTransaction(client,this.slack,found.plan_id,'planning');
    let writeOutput=snapshot.outputJson,writeError=snapshot.errorJson;
    if(context.source&&!context.allowed){writeOutput=writeOutput==null?null:JSON_TOMBSTONE;writeError=writeError==null?null:JSON_TOMBSTONE;}
    else if(!context.source&&(hasSlackMarker(writeOutput)||hasSlackMarker(writeError)))throw new Error('SLACK_PROVENANCE_REQUIRED');
    // Timing comes from the database clock: a step starts when it turns running
    // (again, on retry) and its duration runs from that start to the terminal status.
    const res = await client.query(
      `UPDATE execution_steps
       SET status = $2,
           output_json = COALESCE($3, output_json),
           error_json = CASE WHEN $2 IN ('running', 'succeeded') THEN $4::jsonb ELSE COALESCE($4, error_json) END,
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
        snapshot.status,
        writeOutput==null ? null : JSON.stringify(writeOutput),
        writeError==null ? null : JSON.stringify(writeError),
        snapshot.durationMs ?? null,
      ]
    );
    let row=res.rows[0];
    if(context.source){
      const selectors=['args_json'];
      for(const field of ['output_json','error_json'] as const){
        await client.query(`UPDATE slack_derived_copies SET status='retired',retired_at=clock_timestamp(),retired_reason='superseded',updated_at=clock_timestamp()
          WHERE target_id=$1 AND target_kind='audit_log_entry' AND target_sub_id=$2 AND status='active'`,[id,field]);
        if(context.allowed && row[field]!=null){await this.slack.registerDerivedCopyInTransaction(client,{atiUserId:context.segments[0]!.sourceRef.binding.atiUserId,targetKind:'audit_log_entry',targetId:id,targetSubId:field,segments:context.segments});selectors.push(field);}
      }
      if(!context.allowed)row=(await client.query(`UPDATE execution_steps SET status='unknown',
        output_json=CASE WHEN output_json IS NOT NULL THEN $2::jsonb ELSE NULL END,
        error_json=$2::jsonb WHERE id=$1 RETURNING *`,[id,JSON.stringify(JSON_TOMBSTONE)])).rows[0];
      await client.query('UPDATE execution_steps SET slack_lineage_manifest=$2 WHERE id=$1',[id,JSON.stringify(selectors)]);tagSlackSourceArtifact(row);
    } else await sealPlanOrigin(client,'execution_steps',id,'step_status');
    delete row.slack_lineage_manifest;return row;
    });
  }

  async listSteps(planId: string,purpose:'manual_lookup'|'planning'='manual_lookup'): Promise<ExecutionStepRow[]> {
    return this.transaction(async client=>{
    const context=await guardPlanInTransaction(client,this.slack,planId,purpose);
    const res = await client.query(
      `SELECT * FROM execution_steps
       WHERE plan_id = $1
       ORDER BY step_id ASC FOR SHARE`,
      [planId]
    );
    return guardStepRowsInTransaction(client,this.slack,context,res.rows,purpose);
    });
  }

  /** Called only with private wrapper evidence. Fresh output and its complete lineage commit together. */
  async updateSlackReadResult(id:string,output:unknown,segments:DerivedSegmentInput[],expected:{userId:string;planHash:string;stepId:string},signal?:AbortSignal):Promise<ExecutionStepRow>{
    const data=structuredClone({output,segments,expected});
    return this.transaction(async client=>{
      signal?.throwIfAborted();
      const first=(await client.query('SELECT p.id,p.conv_id FROM execution_steps s JOIN plans p ON p.id=s.plan_id WHERE s.id=$1',[id])).rows[0];
      if(!first)throw new Error('SLACK_READ_SNAPSHOT_CHANGED');
      const copies=(await client.query(`SELECT c.* FROM slack_derived_copies c WHERE c.status='active' AND
        (c.target_id=$1 OR c.target_id IN (SELECT id::text FROM execution_steps WHERE plan_id=$1::uuid)) ORDER BY c.id`,[first.id])).rows;
      const inherited:DerivedSegmentInput[]=[];for(const copy of copies)inherited.push(...await this.slack.segmentsInTransaction(client,copy.id));
      const union=uniqueSegments([...inherited,...data.segments]);
      await this.slack.prepareConversationWriteInTransaction(client,first.conv_id,data.expected.userId,union,'planning');
      const checked=await guardPlanInTransaction(client,this.slack,first.id,'planning');
      const plan=(await client.query('SELECT * FROM plans WHERE id=$1 FOR UPDATE',[first.id])).rows[0];
      if(!checked.allowed||!isBoundSlackReadPlan(plan.plan_json,data.expected.userId)||plan.plan_hash!==data.expected.planHash||!['approved','executing'].includes(plan.status))throw new Error('SLACK_READ_SNAPSHOT_CHANGED');
      const rows=(await client.query('SELECT * FROM execution_steps WHERE plan_id=$1 ORDER BY step_id FOR UPDATE',[first.id])).rows;
      const step=rows.find(s=>s.id===id),approved=plan.plan_json.steps.find((s:any)=>s.id===data.expected.stepId);
      if(!step||step.step_id!==data.expected.stepId||step.tool!==approved?.tool||!isDeepStrictEqual(step.args_json,approved.args)||!['pending','running'].includes(step.status))throw new Error('SLACK_READ_SNAPSHOT_CHANGED');
      const current=(await client.query(`SELECT id FROM slack_derived_copies WHERE status='active' AND
        (target_id=$1 OR target_id IN (SELECT id::text FROM execution_steps WHERE plan_id=$1::uuid)) ORDER BY id`,[first.id])).rows;
      if(JSON.stringify(current.map(r=>r.id))!==JSON.stringify(copies.map(c=>c.id)))throw new Error('SLACK_READ_SNAPSHOT_CHANGED');
      const saved=(await client.query("UPDATE execution_steps SET output_json=$2,status='succeeded',error_json=NULL,completed_at=clock_timestamp() WHERE id=$1 RETURNING *",[id,JSON.stringify(data.output)])).rows[0];
      Object.assign(step,saved);
      const selectors=planSelectors({resourceLabels:plan.resource_labels});
      for(const selector of selectors)await this.slack.registerDerivedCopyInTransaction(client,{atiUserId:data.expected.userId,targetKind:'plan_step_arg',targetId:first.id,targetSubId:selector,segments:union});
      await client.query('UPDATE plans SET slack_lineage_manifest=$2 WHERE id=$1',[first.id,JSON.stringify(selectors)]);
      for(const row of rows){
        const manifest=['args_json',...(row.output_json==null?[]:['output_json']),...(row.error_json==null?[]:['error_json'])];
        for(const selector of manifest)await this.slack.registerDerivedCopyInTransaction(client,{atiUserId:data.expected.userId,targetKind:selector==='args_json'?'plan_step_arg':'audit_log_entry',targetId:row.id,targetSubId:selector,segments:union});
        await client.query('UPDATE execution_steps SET slack_lineage_manifest=$2 WHERE id=$1',[row.id,JSON.stringify(manifest)]);
      }
      await client.query("DELETE FROM slack_plan_origins WHERE (artifact_table='plans' AND artifact_id=$1) OR (artifact_table='execution_steps' AND plan_id=$1)",[first.id]);
      signal?.throwIfAborted();delete saved.slack_lineage_manifest;return tagSlackSourceArtifact(saved);
    });
  }
}
