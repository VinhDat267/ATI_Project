import type pg from 'pg';
import {validateSlackBinding,validateSlackPolicyReference,slackPolicyRefToEpoch,type SlackBinding,type SlackPolicyReference} from '@wap/tool-schemas';
import {SlackPolicyService} from '../../services/slack/policy-service.js';
import {acquireSlackInvalidationLocks,checkSlackInvalidationBarriers,slackSourceWriteLockKeys} from '../../services/slack/slack-invalidation-service.js';
import {slackMessageResourceId} from './slack-event-receipt-repo.js';
import {isUuid} from './uuid.js';

export interface FanoutLease {
 id:string;leaseToken:string;workerId:string;appId:string;workspaceId:string;eventContext:string|null;
 eventType:string;eventSubtype:string|null;channelId:string|null;messageTs:string|null;sourceEventTs:string;payloadHash:string;
}
type RetryCode='authorization_failed'|'fanout_failed'|'aborted'|'owner_busy';
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(v);
const lost=()=>new Error('SLACK_FANOUT_LEASE_LOST');
function lease(row:any):FanoutLease {return {id:row.id,leaseToken:row.fanout_lease_token,workerId:row.fanout_lease_owner,appId:row.slack_app_id,
 workspaceId:row.team_id,eventContext:row.event_context,eventType:row.event_type,eventSubtype:row.event_subtype,channelId:row.channel_id,
 messageTs:row.message_ts,sourceEventTs:row.source_event_ts,payloadHash:row.payload_hash};}
function validLease(value:FanoutLease):void {
 if(!value||!isUuid(value.id)||!isUuid(value.leaseToken)||typeof value.workerId!=='string'||!value.workerId.trim()||value.workerId.length>128||!id(value.appId))throw lost();
}
/** Metadata intents are routing hints; future consumers must recheck authority before content/model use. */
export class SlackFanoutRepo {
 constructor(private readonly pool:pg.Pool,private readonly policy:SlackPolicyService){}
 async setRuntime(appId:string,enabled:boolean):Promise<void>{
  if(!id(appId)||typeof enabled!=='boolean')throw new TypeError('Invalid fanout runtime');
  await this.pool.query(`INSERT INTO slack_fanout_runtime(app_id,enabled) VALUES($1,$2)
   ON CONFLICT(app_id) DO UPDATE SET enabled=$2,processing_started_at=CASE WHEN $2 THEN clock_timestamp() ELSE slack_fanout_runtime.processing_started_at END,
   gap_detected_at=clock_timestamp(),version=slack_fanout_runtime.version+1`,[appId,enabled]);
 }
 async setProcessing(raw:SlackBinding,enabled:boolean):Promise<void>{
  const binding=validateSlackBinding(raw);if(typeof enabled!=='boolean')throw new TypeError('Invalid processing control');
  await this.transaction(async client=>{
   await this.owner(client,binding.atiUserId);
   const row=(await client.query(`SELECT c.id FROM slack_connections c JOIN users u ON u.id=c.user_id
    WHERE c.id=$1 AND c.user_id=$2 AND c.workspace_id=$3 AND c.actor_id=$4 AND c.identity_version=$5 AND c.status='active' AND u.status='active' FOR SHARE OF u,c`,
   [binding.connectionId,binding.atiUserId,binding.workspaceId,binding.slackUserId,binding.identityVersion])).rows[0];
   if(!row)throw new Error('SLACK_FANOUT_IDENTITY_CHANGED');
   await client.query(`INSERT INTO slack_processing_controls(connection_id,user_id,identity_version,enabled) VALUES($1,$2,$3,$4)
    ON CONFLICT(connection_id) DO UPDATE SET user_id=$2,identity_version=$3,enabled=$4,
    processing_started_at=CASE WHEN slack_processing_controls.identity_version<>$3 THEN clock_timestamp() ELSE slack_processing_controls.processing_started_at END,
    config_revision_at=clock_timestamp(),resumed_at=CASE WHEN $4 THEN clock_timestamp() ELSE slack_processing_controls.resumed_at END,
    version=slack_processing_controls.version+1`,[binding.connectionId,binding.atiUserId,binding.identityVersion,enabled]);
  });
 }
 async claim(limit:number,workerId:string,leaseSeconds:number,appId:string):Promise<FanoutLease[]>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||typeof workerId!=='string'||!workerId.trim()||workerId.length>128||
     !Number.isSafeInteger(leaseSeconds)||leaseSeconds<1||leaseSeconds>600||!id(appId))throw new TypeError('Invalid fanout lease');
  const rows=await this.pool.query(`WITH due AS (SELECT id FROM slack_event_receipts WHERE slack_app_id=$1
   AND EXISTS(SELECT 1 FROM slack_fanout_runtime runtime WHERE runtime.app_id=$1 AND runtime.enabled)
   AND (status='pending_fanout' OR (status='failed' AND fanout_attempts>0)) AND fanout_next_attempt_at<=clock_timestamp()
   AND (fanout_lease_until IS NULL OR fanout_lease_until<=clock_timestamp())
   ORDER BY fanout_next_attempt_at,created_at,id LIMIT $2 FOR UPDATE SKIP LOCKED)
   UPDATE slack_event_receipts r SET fanout_lease_token=gen_random_uuid(),fanout_lease_owner=$3,
   fanout_lease_until=clock_timestamp()+$4*interval '1 second',fanout_attempts=fanout_attempts+1
   FROM due WHERE r.id=due.id RETURNING r.*`,[appId,limit,workerId,leaseSeconds]);
  return rows.rows.map(lease);
 }
 async retry(input:FanoutLease,code:RetryCode):Promise<boolean>{
  validLease(input);if(!['authorization_failed','fanout_failed','aborted','owner_busy'].includes(code))throw new TypeError('Invalid fanout error');
  return this.transaction(async client=>{
   await client.query('SELECT id FROM slack_event_receipts WHERE id=$1 FOR UPDATE',[input.id]);
   const result=await client.query(`UPDATE slack_event_receipts SET status='failed',fanout_error_code=$4,
    fanout_next_attempt_at=clock_timestamp()+interval '30 seconds',fanout_lease_token=NULL,fanout_lease_owner=NULL,fanout_lease_until=NULL
    WHERE id=$1 AND fanout_lease_token=$2 AND fanout_lease_owner=$3 AND fanout_lease_until>clock_timestamp()
    AND status IN ('pending_fanout','failed')`,[input.id,input.leaseToken,input.workerId,code]);return result.rowCount===1;
  });
 }
 async complete(input:FanoutLease,authorizedUsers:string[],signal?:AbortSignal):Promise<{jobs:number;discarded?:string}>{
  validLease(input);if(!Array.isArray(authorizedUsers)||authorizedUsers.length>10000||authorizedUsers.some(value=>!id(value)))throw new TypeError('Invalid authorization result');
  return this.transaction(async client=>{
   signal?.throwIfAborted();await this.assertLease(client,input);
   let reason=input.eventType!=='message'||input.eventSubtype!==null||!input.channelId||!input.messageTs?'unsupported_event':!input.eventContext?.trim()?'missing_event_context':undefined;
   const resourceId=slackMessageResourceId(input.channelId??'',input.messageTs??'');
   const candidates=reason?[]:(await client.query(`SELECT * FROM slack_connections WHERE app_id=$1 AND workspace_id=$2 AND actor_id=ANY($3::text[])
    AND status='active' ORDER BY user_id,id`,[input.appId,input.workspaceId,[...new Set(authorizedUsers)]])).rows;
   for(const userId of [...new Set<string>(candidates.map(row=>row.user_id))].sort())await this.owner(client,userId);
   const contexts:Array<{binding:SlackBinding;policy:SlackPolicyReference}>=[];
   for(const row of candidates){
    const binding=validateSlackBinding({atiUserId:row.user_id,connectionId:row.id,workspaceId:row.workspace_id,slackUserId:row.actor_id,identityVersion:row.identity_version});
    const decision=await this.policy.resolveSlackModelPolicy({binding,purpose:'triage',requestedRetentionDays:0},client);
    if(decision.allowed)contexts.push({binding,policy:validateSlackPolicyReference(decision.policyReference)});
   }
   await acquireSlackInvalidationLocks(client,contexts.flatMap(context=>slackSourceWriteLockKeys({binding:context.binding,epoch:slackPolicyRefToEpoch(context.policy),resourceType:'message',resourceId,channelId:input.channelId!})));
   for(const userId of [...new Set(contexts.map(context=>context.binding.atiUserId))].sort())await client.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[userId]);
   for(const context of contexts)await client.query('SELECT id FROM slack_connections WHERE id=$1 FOR SHARE',[context.binding.connectionId]);
   for(const provider of [...new Set(contexts.map(context=>context.policy.providerProfileId))].sort()){
    await client.query('SELECT id FROM slack_trusted_providers WHERE id=$1 FOR SHARE',[provider]);
    await client.query('SELECT id FROM slack_processing_consents WHERE workspace_id=$1 AND provider_id=$2 FOR SHARE',[input.workspaceId,provider]);
   }
   const runtime=(await client.query('SELECT * FROM slack_fanout_runtime WHERE app_id=$1 FOR SHARE',[input.appId])).rows[0];
   if(!runtime?.enabled)reason='runtime_disabled';
   let count=0;
   if(!reason)for(const context of contexts){
    signal?.throwIfAborted();
    const {binding}=context;
    const controls=(await client.query(`SELECT * FROM slack_processing_controls WHERE connection_id=$1 FOR SHARE`,[binding.connectionId])).rows[0];
    if(!controls?.enabled||controls.user_id!==binding.atiUserId||controls.identity_version!==binding.identityVersion)continue;
    const policy=await this.policy.resolveSlackModelPolicy({binding,purpose:'triage',requestedRetentionDays:0,expectedPolicyReference:context.policy},client);
    if(!policy.allowed)continue;
    const eligible=await client.query(`SELECT 1 FROM slack_event_receipts r
     JOIN slack_connections c ON c.id=$2 AND c.user_id=$3 AND c.identity_version=$4
     JOIN slack_processing_controls p ON p.connection_id=c.id
     JOIN slack_fanout_runtime runtime ON runtime.app_id=r.slack_app_id
     JOIN slack_processing_consents consent ON consent.workspace_id=c.workspace_id AND consent.provider_id=$5
     JOIN slack_trusted_providers provider ON provider.id=consent.provider_id
     WHERE r.id=$1 AND c.app_id=r.slack_app_id AND c.workspace_id=r.team_id AND c.actor_id=$6 AND c.status='active'
      AND p.user_id=c.user_id AND p.identity_version=c.identity_version AND p.enabled AND runtime.enabled
      AND r.source_event_time>=GREATEST(runtime.processing_started_at,p.processing_started_at,consent.granted_at,consent.processing_effective_at,
      c.connected_at,c.identity_epoch_at,provider.verified_at,provider.updated_at,provider.processing_effective_at,p.config_revision_at,p.resumed_at)`,
    [input.id,binding.connectionId,binding.atiUserId,binding.identityVersion,context.policy.providerProfileId,binding.slackUserId]);
    if(!eligible.rowCount)continue;
    const barrier=await checkSlackInvalidationBarriers(client,{binding,epoch:slackPolicyRefToEpoch(context.policy),workspaceId:binding.workspaceId,
     channelId:input.channelId!,resourceType:'message',resourceId,revision:input.messageTs!});
    if(barrier.blocked)continue;
    await client.query(`INSERT INTO slack_triage_jobs(receipt_id,connection_id,user_id,workspace_id,slack_user_id,identity_version,policy_reference,processing_version,runtime_version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(receipt_id,connection_id,identity_version) DO NOTHING`,
    [input.id,binding.connectionId,binding.atiUserId,binding.workspaceId,binding.slackUserId,binding.identityVersion,JSON.stringify(context.policy),controls.version,runtime.version]);count++;
   }
   signal?.throwIfAborted();
   await client.query('SELECT id FROM slack_event_receipts WHERE id=$1 FOR UPDATE',[input.id]);
   await this.assertLease(client,input);
   if(!count&&!reason)reason='no_eligible_binding';
   const finished=await client.query(`UPDATE slack_event_receipts SET status=$4,discard_reason=$5,processed_at=clock_timestamp(),
    fanout_lease_token=NULL,fanout_lease_owner=NULL,fanout_lease_until=NULL,fanout_error_code=NULL
    WHERE id=$1 AND fanout_lease_token=$2 AND fanout_lease_owner=$3 AND fanout_lease_until>clock_timestamp()`,
   [input.id,input.leaseToken,input.workerId,reason?'discarded':'processed',reason??null]);
   if(finished.rowCount!==1)throw lost();signal?.throwIfAborted();return {jobs:count,...(reason?{discarded:reason}:{})};
  },signal);
 }
 private async assertLease(client:pg.PoolClient,input:FanoutLease):Promise<void>{
  const row=(await client.query(`SELECT * FROM slack_event_receipts WHERE id=$1 AND fanout_lease_token=$2 AND fanout_lease_owner=$3
   AND fanout_lease_until>clock_timestamp() AND status IN ('pending_fanout','failed')`,[input.id,input.leaseToken,input.workerId])).rows[0];
  if(!row||JSON.stringify(lease(row))!==JSON.stringify(input))throw lost();
 }
 private async owner(client:pg.PoolClient,userId:string):Promise<void>{
  const result=await client.query("SELECT pg_try_advisory_xact_lock(hashtext('ati-slack-owner'),hashtext($1)) AS held",[userId]);
  if(!result.rows[0]?.held)throw new Error('SLACK_FANOUT_OWNER_BUSY');
 }
 private async transaction<T>(run:(client:pg.PoolClient)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  const client=await this.pool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='2s'");
   const result=await run(client);signal?.throwIfAborted();await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
}
