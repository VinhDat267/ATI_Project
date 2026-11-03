import { createHash } from 'node:crypto';
import type pg from 'pg';
import {messageOriginAllowed,sealMessageOrigin} from './slack-message-origin.js';
import {planOriginAllowed,sealPlanOrigin} from './slack-plan-origin.js';
import {scheduleOriginAllowed,sealScheduleOrigin} from './slack-schedule-origin.js';
import { eraseMessageSelector,messageSelectorValue,validateMessageSelector,SLACK_MESSAGE_TOMBSTONE } from './slack-message-selectors.js';

export interface SlackArtifactTarget { atiUserId:string;targetKind:string;targetId:string;targetSubId:string }
export const PLAN_TOMBSTONE = {kind:'plan',thinking:'',summary:SLACK_MESSAGE_TOMBSTONE,steps:[],warnings:[]};
export const JSON_TOMBSTONE = {__slack_purged:true};
export const PLAN_TOMBSTONE_TEXT = JSON.stringify(PLAN_TOMBSTONE);
export const PLAN_TOMBSTONE_HASH = createHash('sha256').update(PLAN_TOMBSTONE_TEXT).digest('hex');
export function validateSlackArtifactTarget(kind:string,selector:string):void {
  if(['proposal_excerpt','daily_digest_entry'].includes(kind)&&selector==='body_json')return;
  if(kind==='scheduled_workflow_arg' && ['name','request','recurrence','title','error'].includes(selector))return;
  if(kind==='plan_step_arg') {
    if(['plan_json','plan_text','plan_hash','args_json'].includes(selector))return;
    if(selector.startsWith('resource_labels/')) {
      const key=decodeURIComponent(selector.slice(16));
      if(key && encodeURIComponent(key)===selector.slice(16) && !['__proto__','prototype','constructor'].includes(key))return;
    }
  } else if(kind==='audit_log_entry' && ['output_json','error_json'].includes(selector))return;
  else if(['chat_history_message','working_memory_entity'].includes(kind))return validateMessageSelector(kind,selector);
  throw new Error('unsupported_target');
}
export function artifactTable(kind:string,selector:string):'messages'|'plans'|'execution_steps'|'schedules'|'schedule_runs'|'conversations'|'slack_assistant_artifacts' {
  validateSlackArtifactTarget(kind,selector);
  if(['proposal_excerpt','daily_digest_entry'].includes(kind))return 'slack_assistant_artifacts';
  if(kind==='scheduled_workflow_arg')return selector==='title'?'conversations':selector==='error'?'schedule_runs':'schedules';
  return ['chat_history_message','working_memory_entity'].includes(kind)?'messages':kind==='audit_log_entry'||selector==='args_json'?'execution_steps':'plans';
}
export async function slackArtifactLocation(client:pg.PoolClient,target:SlackArtifactTarget) {
  const table=artifactTable(target.targetKind,target.targetSubId);
  const row=(await client.query(table==='conversations'?'SELECT id AS conv_id FROM conversations WHERE id=$1':table==='schedule_runs'?'SELECT s.conv_id,r.schedule_id FROM schedule_runs r JOIN schedules s ON s.id=r.schedule_id WHERE r.id=$1':table==='execution_steps'?`SELECT p.conv_id,p.id AS plan_id FROM execution_steps s JOIN plans p ON p.id=s.plan_id WHERE s.id=$1`:
    `SELECT conv_id FROM ${table} WHERE id=$1`,[target.targetId])).rows[0];
  if(!row)throw new Error('not_found');return {table,convId:row.conv_id as string,scheduleId:row.schedule_id as string|undefined,planId:(row.plan_id??(table==='plans'?target.targetId:undefined)) as string|undefined};
}
export async function lockSlackArtifact(client:pg.PoolClient,target:SlackArtifactTarget,mode:'SHARE'|'UPDATE') {
  const location=await slackArtifactLocation(client,target);
  if(location.table==='execution_steps')await client.query(`SELECT id FROM plans WHERE id=$1 FOR ${mode}`,[location.planId]);
  if(location.table==='schedule_runs')await client.query(`SELECT id FROM schedules WHERE id=$1 FOR ${mode}`,[location.scheduleId]);
  const row=(await client.query(`SELECT * FROM ${location.table} WHERE id=$1 FOR ${mode}`,[target.targetId])).rows[0];
  if(!row || (location.table==='conversations'?row.id!==location.convId:location.table==='schedule_runs'?row.schedule_id!==location.scheduleId:location.table==='execution_steps'?row.plan_id!==location.planId:row.conv_id!==location.convId))throw new Error('stale_lineage');
  if(location.table==='slack_assistant_artifacts'&&(row.kind!==target.targetKind||row.user_id!==target.atiUserId))throw new Error('stale_lineage');
  return {row,...location};
}
export function slackArtifactValue(row:any,kind:string,selector:string):unknown {
  validateSlackArtifactTarget(kind,selector);
  if(['proposal_excerpt','daily_digest_entry'].includes(kind)){
    if(slackArtifactIsErased(row.body_json,kind,selector))return row.body_json;
    const b=row.body_json?.binding;
    if(row.kind!==kind||row.body_json?.artifactId!==row.id||b?.atiUserId!==row.user_id||b.connectionId!==row.connection_id||b.workspaceId!==row.workspace_id||b.slackUserId!==row.slack_user_id||b.identityVersion!==row.identity_version||row.body_json.configVersion!==row.config_version||row.body_json.payloadRevision!==row.payload_revision)throw new Error('stale_lineage');
    return row.body_json;
  }
  if(['chat_history_message','working_memory_entity'].includes(kind))return messageSelectorValue(row,kind,selector);
  if(selector.startsWith('resource_labels/'))return row.resource_labels?.[decodeURIComponent(selector.slice(16))];
  return row[selector];
}
export function slackArtifactIsErased(value:unknown,kind:string,selector:string):boolean {
  if(kind==='scheduled_workflow_arg')return selector==='recurrence'?value!==null&&typeof value==='object'&&Object.keys(value).length===0:value===SLACK_MESSAGE_TOMBSTONE;
  if(['chat_history_message','working_memory_entity'].includes(kind))return selector==='content'?value===SLACK_MESSAGE_TOMBSTONE:value===undefined;
  if(selector==='plan_text')return value===PLAN_TOMBSTONE_TEXT;
  if(selector==='plan_hash')return value===PLAN_TOMBSTONE_HASH;
  if(selector==='plan_json')return JSON.stringify(value)===PLAN_TOMBSTONE_TEXT || (value as any)?.summary===SLACK_MESSAGE_TOMBSTONE && Array.isArray((value as any)?.steps) && (value as any).steps.length===0;
  if(selector.startsWith('resource_labels/'))return value===undefined;
  return value!==null && typeof value==='object' && Object.keys(value).length===1 && (value as any).__slack_purged===true;
}
export function redactPlanRow(row:any):any {
  const selectors=row.slack_lineage_manifest;
  const labels=Array.isArray(selectors)?Object.fromEntries(Object.entries(row.resource_labels??{}).filter(([key])=>!selectors.includes(`resource_labels/${encodeURIComponent(key)}`))):{};
  return {...row,plan_json:structuredClone(PLAN_TOMBSTONE),plan_text:PLAN_TOMBSTONE_TEXT,plan_hash:PLAN_TOMBSTONE_HASH,
    resource_labels:labels,status:row.status==='pending'?'superseded':['approved','executing','stopping','partial','unknown','reconciliation_required'].includes(row.status)?'failed':row.status};
}
/** Caller holds common source+conversation+artifact locks and rechecks copy CAS. */
export async function eraseSlackArtifact(client:pg.PoolClient,target:SlackArtifactTarget,artifact:Awaited<ReturnType<typeof lockSlackArtifact>>):Promise<void> {
  const originTable=artifact.table==='messages'||artifact.table==='conversations'?artifact.table:null;
  const validOrigin=originTable?await messageOriginAllowed(client,originTable,artifact.row,target.atiUserId):false;
  const planTable=artifact.table==='plans'||artifact.table==='execution_steps'?artifact.table:null;
  const validPlanOrigin=planTable?await planOriginAllowed(client,planTable,artifact.row,target.atiUserId):false;
  const validScheduleOrigin=artifact.table==='schedules'?await scheduleOriginAllowed(client,artifact.row,target.atiUserId):false;
  // Only the previously certified remainder may survive a trusted eraser's
  // incidental transformation. Unknown/tampered legacy is never certified here.
  const reseal=async()=>{
    if(originTable&&validOrigin)await sealMessageOrigin(client,originTable,target.targetId,'physical_purge');
    if(planTable&&validPlanOrigin)await sealPlanOrigin(client,planTable,target.targetId,'physical_purge');
    if(artifact.table==='schedules'&&validScheduleOrigin)await sealScheduleOrigin(client,target.targetId,'physical_purge');
  };
  if(artifact.table==='messages') {
    eraseMessageSelector(artifact.row,target.targetKind,target.targetSubId);
    await client.query('UPDATE messages SET content=$2,metadata=$3 WHERE id=$1',[target.targetId,artifact.row.content,JSON.stringify(artifact.row.metadata)]);await reseal();return;
  }
  if(artifact.table==='slack_assistant_artifacts'){
    await client.query("UPDATE slack_assistant_artifacts SET body_json=$2,status='stale',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",[target.targetId,JSON.stringify(JSON_TOMBSTONE)]);return;
  }
  const selector=target.targetSubId;
  if(target.targetKind==='scheduled_workflow_arg'){
    if(artifact.table==='schedules')await client.query(`UPDATE schedules SET ${selector}=$2${selector==='recurrence'?'::jsonb':''},
      status=CASE WHEN status='active' THEN 'paused' ELSE status END,pause_reason='slack_source_invalidated',next_run_at=NULL,
      version=version+1,updated_at=clock_timestamp() WHERE id=$1`,[target.targetId,selector==='recurrence'?'{}':SLACK_MESSAGE_TOMBSTONE]);
    else await client.query(`UPDATE ${artifact.table} SET ${selector}=$2 WHERE id=$1`,[target.targetId,SLACK_MESSAGE_TOMBSTONE]);
    await reseal();
    return;
  }
  if(artifact.table==='plans') {
    if(selector.startsWith('resource_labels/'))await client.query('UPDATE plans SET resource_labels=resource_labels-$2 WHERE id=$1',[target.targetId,decodeURIComponent(selector.slice(16))]);
    else await client.query(`UPDATE plans SET ${selector}=$2 WHERE id=$1`,[target.targetId,selector==='plan_json'?JSON.stringify(PLAN_TOMBSTONE):selector==='plan_text'?PLAN_TOMBSTONE_TEXT:PLAN_TOMBSTONE_HASH]);
  } else await client.query(`UPDATE execution_steps SET ${selector}=$2::jsonb WHERE id=$1`,[target.targetId,JSON.stringify(JSON_TOMBSTONE)]);
  if(artifact.planId) {
    await client.query(`UPDATE plans SET status=CASE WHEN status='pending' THEN 'superseded' WHEN status IN ('approved','executing','stopping','partial','unknown','reconciliation_required') THEN 'failed' ELSE status END WHERE id=$1`,[artifact.planId]);
    // Scheduler locks runs before their conversation. NOWAIT prevents an inverse
    // wait cycle; a busy run causes this whole fenced purge transaction to retry.
    await client.query('SELECT id FROM schedule_runs WHERE plan_id=$1 ORDER BY id FOR UPDATE NOWAIT',[artifact.planId]);
    await client.query("UPDATE schedule_runs SET status='discarded',plan_id=NULL,error=$2,updated_at=clock_timestamp() WHERE plan_id=$1",[artifact.planId,SLACK_MESSAGE_TOMBSTONE]);
  }
}
