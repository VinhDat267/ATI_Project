import {createHash} from 'node:crypto';
import type pg from 'pg';
import {canonicalSlackJson} from '@wap/executor';
import {validateSlackBinding,type SlackBinding} from '@wap/tool-schemas';
import {isUuid} from './uuid.js';
export interface SlackWriteInput {planId:string;stepId:string;planHash:string;appId:string;binding:SlackBinding;params:{channel:string;text:string};signal?:AbortSignal}
export const slackWriteHash=(value:unknown)=>createHash('sha256').update(canonicalSlackJson(value)).digest('hex');
export function slackWriteDenied(){return Object.assign(new Error('SLACK_WRITE_DENIED'),{category:'AUTH_ERROR',details:{requestSent:false}});}
export function slackWriteUnknown(){return Object.assign(new Error('SLACK_WRITE_UNKNOWN'),{category:'UNKNOWN',details:{requestSent:true}});}
export function normalizeSlackWrite(value:SlackWriteInput):SlackWriteInput {
 try {
  const binding=validateSlackBinding(value.binding),p=value.params;
  if(!isUuid(value.planId)||typeof value.stepId!=='string'||!value.stepId||value.stepId.length>128||!/^[a-f0-9]{64}$/.test(value.planHash)||
    !/^[A-Za-z0-9_-]{1,64}$/.test(value.appId)||!p||Object.keys(p).some(k=>!['channel','text'].includes(k))||
    !/^[CG][A-Za-z0-9_-]{1,63}$/.test(p.channel)||typeof p.text!=='string'||!p.text.trim()||p.text.length>4000)throw new Error();
  return {...value,binding,params:{channel:p.channel,text:p.text}};
 }catch{throw slackWriteDenied();}
}
/** Only SQL ownership/current identity and the exact approved step authorize a durable attempt.
 * Caller additionally pins policy/source authority. This repo has no transport or message body column. */
export class SlackWriteOutboxRepo {
 constructor(private pool:pg.Pool){}
 async withOwner<T>(input:SlackWriteInput,work:(client:pg.PoolClient)=>Promise<T>):Promise<T>{
  const c=await this.pool.connect();let held=false;
  try{held=(await c.query("SELECT pg_try_advisory_lock(hashtext('ati-slack-owner'),hashtext($1)) locked",[input.binding.atiUserId])).rows[0].locked;
   if(!held)throw slackWriteDenied();return await work(c);
  }finally{try{if(held)await c.query("SELECT pg_advisory_unlock(hashtext('ati-slack-owner'),hashtext($1))",[input.binding.atiUserId]);}finally{c.release();}}
 }
 async authority(c:pg.PoolClient,input:SlackWriteInput,readOnly=false):Promise<void>{
  input.signal?.throwIfAborted();const b=input.binding;
  const owner=(await c.query('SELECT status FROM users WHERE id=$1 FOR SHARE',[b.atiUserId])).rows[0];
  const conn=(await c.query('SELECT * FROM slack_connections WHERE id=$1 FOR SHARE',[b.connectionId])).rows[0];
  const plan=(await c.query('SELECT p.*,v.user_id FROM plans p JOIN conversations v ON v.id=p.conv_id WHERE p.id=$1 FOR SHARE OF p,v',[input.planId])).rows[0];
  const body=plan?.plan_json,step=body?.steps?.find((s:any)=>s.id===input.stepId),bindings=body?.connections?.myslack;
  const text=plan?.plan_text??JSON.stringify(body);
  let integrity=false;try{integrity=typeof text==='string'&&createHash('sha256').update(text).digest('hex')===input.planHash&&canonicalSlackJson(JSON.parse(text))===canonicalSlackJson(body);}catch{}
  const fresh=plan&&(await c.query('SELECT expires_at>clock_timestamp() fresh FROM plans WHERE id=$1',[input.planId])).rows[0]?.fresh;
  if(owner?.status!=='active'||!conn||conn.status!=='active'||conn.refresh_in_flight||conn.user_id!==b.atiUserId||conn.app_id!==input.appId||
    conn.workspace_id!==b.workspaceId||conn.actor_id!==b.slackUserId||conn.identity_version!==b.identityVersion||!conn.scopes.includes('chat:write')||
    !integrity||(!readOnly&&!fresh)||plan?.user_id!==b.atiUserId||plan.plan_hash!==input.planHash||!['approved','executing','partial','reconciliation_required','completed'].includes(plan.status)||
    step?.tool!=='myslack.chat_postMessage'||canonicalSlackJson(step.args)!==canonicalSlackJson(input.params)||
    canonicalSlackJson(bindings?.bindings?.[b.connectionId])!==canonicalSlackJson(b)||bindings?.steps?.[input.stepId]?.connectionId!==b.connectionId)throw slackWriteDenied();
 }
 async transaction<T>(c:pg.PoolClient,work:()=>Promise<T>):Promise<T>{
  await c.query('BEGIN');try{await c.query("SET LOCAL statement_timeout='2s'");const result=await work();await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}
 }
 async lookup(c:pg.PoolClient,i:SlackWriteInput):Promise<any>{
  const row=(await c.query('SELECT * FROM slack_write_outbox WHERE plan_id=$1 AND step_id=$2',[i.planId,i.stepId])).rows[0];
  if(row&&(row.plan_hash!==i.planHash||row.user_id!==i.binding.atiUserId||row.connection_id!==i.binding.connectionId||row.app_id!==i.appId||
    row.workspace_id!==i.binding.workspaceId||row.slack_user_id!==i.binding.slackUserId||row.identity_version!==i.binding.identityVersion||row.request_hash!==slackWriteHash(i.params)))throw slackWriteDenied();return row;
 }
 async prepare(c:pg.PoolClient,i:SlackWriteInput):Promise<any>{
  if(!(await c.query("SELECT id FROM plans WHERE id=$1 AND expires_at>clock_timestamp() AND status IN ('approved','executing','partial')",[i.planId])).rowCount)throw slackWriteDenied();
  const b=i.binding;await c.query(`INSERT INTO slack_write_outbox(plan_id,step_id,plan_hash,user_id,connection_id,app_id,workspace_id,slack_user_id,identity_version,request_hash,channel_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(plan_id,step_id) DO NOTHING`,[i.planId,i.stepId,i.planHash,b.atiUserId,b.connectionId,i.appId,b.workspaceId,b.slackUserId,b.identityVersion,slackWriteHash(i.params),i.params.channel]);
  // A crash before the durable dispatch checkpoint is safe to reclaim. Never
  // renew/reclaim dispatching or UNKNOWN: the provider may already have committed.
  await c.query(`UPDATE slack_write_outbox SET lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '30 seconds'
    WHERE plan_id=$1 AND step_id=$2 AND status='prepared' AND lease_until<=clock_timestamp()`,[i.planId,i.stepId]);
  return this.lookup(c,i);
 }
 async dispatch(c:pg.PoolClient,row:any):Promise<any>{
  await c.query('SELECT operation_id FROM slack_write_outbox WHERE operation_id=$1 FOR UPDATE',[row.operation_id]);
  const result=await c.query(`UPDATE slack_write_outbox SET status='dispatching',attempt_id=gen_random_uuid(),dispatched_at=clock_timestamp()
    WHERE operation_id=$1 AND lease_token=$2 AND lease_until>clock_timestamp() AND status='prepared' RETURNING *`,[row.operation_id,row.lease_token]);
  if(!result.rows[0])throw slackWriteDenied();return result.rows[0];
 }
 async receipt(c:pg.PoolClient,row:any,ts:string):Promise<void>{
  const r=await c.query(`UPDATE slack_write_outbox SET provider_ts=$3 WHERE operation_id=$1 AND attempt_id=$2 AND status IN ('dispatching','unknown')
    AND (provider_ts IS NULL OR provider_ts=$3)`,[row.operation_id,row.attempt_id,ts]);if(r.rowCount!==1)throw slackWriteUnknown();
 }
 async unknown(c:pg.PoolClient,row:any):Promise<void>{await c.query("UPDATE slack_write_outbox SET status='unknown' WHERE operation_id=$1 AND attempt_id=$2 AND status='dispatching'",[row.operation_id,row.attempt_id]);}
 async confirm(c:pg.PoolClient,row:any,ts:string):Promise<void>{
  await this.transaction(c,async()=>{
   await this.receipt(c,row,ts);
   await c.query("UPDATE slack_write_outbox SET status='confirmed',confirmed_at=clock_timestamp() WHERE operation_id=$1 AND attempt_id=$2",[row.operation_id,row.attempt_id]);
   await c.query("UPDATE slack_echo_candidates SET status='confirmed' WHERE operation_id=$1 AND native_ts=$2",[row.operation_id,ts]);
  });
 }
}
