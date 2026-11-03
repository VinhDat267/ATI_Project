import type pg from 'pg';
import {defaultSlackAssistantConfig,validateSlackAssistantConfig,validateSlackAssistantVersion,validateSlackTriageDecision,validateSlackPolicyReference,slackPolicyRefToEpoch,sameSlackBinding,sameSlackPolicyEpoch,validateSlackBinding,type SlackBinding,type SlackPolicyReference,type SlackAssistantConfig,type SlackTriageDecision} from '@wap/tool-schemas';
import type {SlackPolicyService} from '../../services/slack/policy-service.js';
import {acquireSlackInvalidationLocks,checkSlackInvalidationBarriers,slackSourceWriteLockKeys} from '../../services/slack/slack-invalidation-service.js';
import {slackMessageResourceId} from './slack-event-receipt-repo.js';
import {SlackDerivedLineageRepo,type DerivedSegmentInput} from './slack-derived-lineage-repo.js';
import {isUuid} from './uuid.js';
export interface SlackAssistantView {config:SlackAssistantConfig;configVersion:string;available:boolean;pausedReason:string|null;queue?:{pending:number;running:number;held:number;needsAttention:number}}
export interface SlackTriageLease {id:string;leaseToken:string;workerId:string;configVersion:string;binding:SlackBinding;policyReference:SlackPolicyReference;config:SlackAssistantConfig;triggers:Array<{jobId:string;channelId:string;messageTs:string;threadTs:string;sourceEventTs:string}>}
export interface SlackProposalContext {text:string;user?:string;ts:string;threadTs?:string;channelId:string;conversationType:'public'|'private'|'im'|'mpim'}
export type SlackProposalPublisher=(client:pg.PoolClient,lease:SlackTriageLease,decision:Exclude<SlackTriageDecision,{kind:'no_action'}>,segments:DerivedSegmentInput[],context:SlackProposalContext[],truncated:boolean)=>Promise<string>;
export interface SlackProposalWriter {prepareProposalInTransaction:(client:pg.PoolClient,lease:SlackTriageLease,decision:Exclude<SlackTriageDecision,{kind:'no_action'}>,context:SlackProposalContext[])=>Promise<void>;publishProposalInTransaction:SlackProposalPublisher}
const lost=()=>new Error('SLACK_TRIAGE_LEASE_LOST');
/** Authoritative SQL state for metadata-only jobs; no model/source bytes are persisted here. */
export class SlackAssistantRepo {
 constructor(private readonly pool:pg.Pool,private readonly policy:SlackPolicyService,private readonly options:{appId:string;automationEnabled:boolean;timezone?:string},private readonly artifacts?:SlackProposalWriter){}
 private view(row:any):SlackAssistantView{return {config:validateSlackAssistantConfig(row.config_json),configVersion:validateSlackAssistantVersion(row.version),available:this.options.automationEnabled,pausedReason:row.paused_reason};}
 private async transaction<T>(run:(client:pg.PoolClient)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();const c=await this.pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5s'");const result=await run(c);signal?.throwIfAborted();await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 private async owner(c:pg.PoolClient,userId:string,tryOnly=false):Promise<boolean>{
  if(!isUuid(userId))throw new Error('SLACK_ASSISTANT_NOT_FOUND');
  const r=await c.query(`SELECT ${tryOnly?'pg_try_advisory_xact_lock':'pg_advisory_xact_lock'}(hashtext('ati-slack-owner'),hashtext($1)) AS held`,[userId]);return !tryOnly||r.rows[0]?.held===true;
 }
 private async owned(c:pg.PoolClient,userId:string,connectionId:string){
  if(!isUuid(connectionId))throw new Error('SLACK_ASSISTANT_NOT_FOUND');
  const row=(await c.query("SELECT c.* FROM slack_connections c JOIN users u ON u.id=c.user_id WHERE c.id=$1 AND c.user_id=$2 AND u.status='active'",[connectionId,userId])).rows[0];
  if(!row)throw new Error('SLACK_ASSISTANT_NOT_FOUND');return row;
 }
 private async ensure(c:pg.PoolClient,userId:string,connectionId:string){
  const conn=await this.owned(c,userId,connectionId);
  await c.query('INSERT INTO slack_workspace_configs(connection_id,user_id,identity_version,config_json) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[connectionId,userId,conn.identity_version,JSON.stringify(defaultSlackAssistantConfig(this.options.timezone))]);
  return (await c.query('SELECT * FROM slack_workspace_configs WHERE connection_id=$1 AND user_id=$2 FOR UPDATE',[connectionId,userId])).rows[0];
 }
 async getConfig(userId:string,connectionId:string):Promise<SlackAssistantView>{return this.transaction(async c=>{await this.owner(c,userId);const view=this.view(await this.ensure(c,userId,connectionId));const q=(await c.query(`SELECT count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='running')::int AS running,count(*) FILTER(WHERE status='held_budget')::int AS held,count(*) FILTER(WHERE status='needs_attention')::int AS attention FROM slack_triage_jobs WHERE connection_id=$1 AND user_id=$2`,[connectionId,userId])).rows[0];return {...view,queue:{pending:q.pending,running:q.running,held:q.held,needsAttention:q.attention}};});}
 async updateConfig(userId:string,connectionId:string,expectedVersion:string,raw:SlackAssistantConfig):Promise<SlackAssistantView>{
  const config=validateSlackAssistantConfig(raw);validateSlackAssistantVersion(expectedVersion);
  return this.transaction(async c=>{
   await this.owner(c,userId);await this.owned(c,userId,connectionId);await c.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[userId]);await c.query('SELECT id FROM slack_connections WHERE id=$1 FOR SHARE',[connectionId]);const current=await this.ensure(c,userId,connectionId);if(current.version!==expectedVersion)throw new Error('SLACK_ASSISTANT_VERSION_CONFLICT');
   const conn=await this.owned(c,userId,connectionId),binding=validateSlackBinding({atiUserId:userId,connectionId,workspaceId:conn.workspace_id,slackUserId:conn.actor_id,identityVersion:conn.identity_version});
   if(config.enabled){if(!this.options.automationEnabled)throw new Error('SLACK_AUTOMATION_UNAVAILABLE');await this.authority(c,binding);const p=await this.policy.resolveSlackModelPolicy({binding,purpose:'triage',requestedRetentionDays:0},c);if(!p.allowed)throw new Error('SLACK_POLICY_DENIED');await this.authority(c,binding,p.policyReference.providerProfileId);if(!(await this.policy.resolveSlackModelPolicy({binding,purpose:'triage',requestedRetentionDays:0,expectedPolicyReference:p.policyReference},c)).allowed)throw new Error('SLACK_POLICY_DENIED');}
   const previous=validateSlackAssistantConfig(current.config_json);
   if(previous.enabled!==config.enabled){
    await c.query(`INSERT INTO slack_processing_controls(connection_id,user_id,identity_version,enabled) VALUES($1,$2,$3,$4)
     ON CONFLICT(connection_id) DO UPDATE SET user_id=$2,identity_version=$3,enabled=$4,
     processing_started_at=CASE WHEN slack_processing_controls.identity_version<>$3 THEN clock_timestamp() ELSE slack_processing_controls.processing_started_at END,
     config_revision_at=clock_timestamp(),resumed_at=CASE WHEN $4 THEN clock_timestamp() ELSE slack_processing_controls.resumed_at END,version=slack_processing_controls.version+1`,[connectionId,userId,binding.identityVersion,config.enabled]);
   }
   if(config.retentionDays<previous.retentionDays){
    // Monotone expiry reduction only: never reseal payloads, rewrap an old grant or extend a capture.
    await c.query(`UPDATE slack_derived_provenance_segments s SET effective_retention_days=LEAST(s.effective_retention_days,$3),
     expires_at=LEAST(s.expires_at,s.captured_at+$3*interval '1 day') WHERE s.connection_id=$1 AND s.ati_user_id=$2
     AND s.derived_copy_id IN (SELECT payload.copy_id FROM slack_derived_artifact_payloads payload
      WHERE payload.conv_id IN (SELECT conv_id FROM slack_assistant_artifacts WHERE connection_id=$1 AND user_id=$2))`,[connectionId,userId,config.retentionDays]);
   }
   const row=(await c.query(`UPDATE slack_workspace_configs SET config_json=$3,version=version+1,paused_reason=NULL,updated_at=clock_timestamp() WHERE connection_id=$1 AND version=$2 RETURNING *`,[connectionId,expectedVersion,JSON.stringify(config)])).rows[0];
   await c.query("UPDATE slack_triage_jobs SET status='pending',held_until=NULL WHERE connection_id=$1 AND status='held_budget' AND expires_at>clock_timestamp()",[connectionId]);return this.view(row);
  });
 }
 async followThread(userId:string,connectionId:string,channelId:string,threadTs:string,follow:boolean):Promise<void>{
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(channelId)||!/^\d{1,10}(?:\.\d{1,6})?$/.test(threadTs)||typeof follow!=='boolean')throw new TypeError('SLACK_ASSISTANT_INVALID');
  await this.transaction(async c=>{await this.owner(c,userId);const config=await this.ensure(c,userId,connectionId);
   if(follow)await c.query('INSERT INTO slack_followed_threads(connection_id,identity_version,channel_id,thread_ts) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[connectionId,config.identity_version,channelId,threadTs]);
   else await c.query('UPDATE slack_followed_threads SET unfollowed_at=clock_timestamp() WHERE connection_id=$1 AND identity_version=$2 AND channel_id=$3 AND thread_ts=$4 AND unfollowed_at IS NULL',[connectionId,config.identity_version,channelId,threadTs]);
  });
 }
 async isFollowed(lease:SlackTriageLease,trigger:SlackTriageLease['triggers'][number]):Promise<boolean>{return (await this.pool.query(`SELECT 1 FROM slack_followed_threads WHERE connection_id=$1 AND identity_version=$2 AND channel_id=$3 AND thread_ts=$4
  AND followed_at<=to_timestamp($5::numeric) AND (unfollowed_at IS NULL OR unfollowed_at>to_timestamp($5::numeric))`,[lease.binding.connectionId,lease.binding.identityVersion,trigger.channelId,trigger.threadTs,trigger.sourceEventTs])).rowCount===1;}
 private async authority(c:pg.PoolClient,b:SlackBinding,provider?:string):Promise<void>{
  await c.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[b.atiUserId]);await c.query('SELECT id FROM slack_connections WHERE id=$1 FOR SHARE',[b.connectionId]);
  if(provider){await c.query('SELECT id FROM slack_trusted_providers WHERE id=$1 FOR SHARE',[provider]);await c.query('SELECT workspace_id FROM slack_processing_consents WHERE workspace_id=$1 AND provider_id=$2 FOR SHARE',[b.workspaceId,provider]);}
 }
 private async context(c:pg.PoolClient,row:any):Promise<SlackTriageLease>{
  const binding=validateSlackBinding({atiUserId:row.user_id,connectionId:row.connection_id,workspaceId:row.workspace_id,slackUserId:row.slack_user_id,identityVersion:row.identity_version});
  const triggers=(await c.query(`SELECT j.id AS job_id,r.channel_id,r.message_ts,COALESCE(r.thread_ts,r.message_ts) AS thread_ts,r.source_event_ts FROM slack_triage_jobs j JOIN slack_event_receipts r ON r.id=j.receipt_id WHERE j.id=ANY($1::uuid[]) ORDER BY r.source_event_time,j.id`,[row.batch_job_ids??[row.id]])).rows.map(r=>({jobId:r.job_id,channelId:r.channel_id,messageTs:r.message_ts,threadTs:r.thread_ts,sourceEventTs:r.source_event_ts}));
  return {id:row.id,leaseToken:row.lease_token,workerId:row.lease_owner,configVersion:row.claimed_config_version,binding,policyReference:validateSlackPolicyReference(row.policy_reference),config:validateSlackAssistantConfig(row.config_json),triggers};
 }
 /** Source locks precede authority rows. SQL clock checks occur after every potentially blocking lock. */
 private async lockSources(c:pg.PoolClient,lease:SlackTriageLease,segments:DerivedSegmentInput[]=[]):Promise<void>{
  const b=lease.binding,epoch=slackPolicyRefToEpoch(lease.policyReference);
  await acquireSlackInvalidationLocks(c,[...lease.triggers.flatMap(t=>slackSourceWriteLockKeys({binding:b,epoch,channelId:t.channelId,resourceType:'message',resourceId:slackMessageResourceId(t.channelId,t.messageTs)})),...segments.flatMap(s=>slackSourceWriteLockKeys({binding:s.sourceRef.binding,epoch:slackPolicyRefToEpoch(s.storagePolicyRef),channelId:s.channelId,resourceType:s.sourceRef.resourceType,resourceId:s.sourceRef.resourceId}))]);
 }
 private async lockAuthority(c:pg.PoolClient,lease:SlackTriageLease):Promise<void>{
  await this.authority(c,lease.binding,lease.policyReference.providerProfileId);
  await c.query('SELECT connection_id FROM slack_processing_controls WHERE connection_id=$1 FOR SHARE',[lease.binding.connectionId]);await c.query('SELECT app_id FROM slack_fanout_runtime WHERE app_id=$1 FOR SHARE',[this.options.appId]);
 }
 private async allowed(c:pg.PoolClient,lease:SlackTriageLease):Promise<boolean>{
  const b=lease.binding,p=lease.policyReference,epoch=slackPolicyRefToEpoch(p);
  const policy=await this.policy.resolveSlackModelPolicy({binding:b,purpose:'triage',requestedRetentionDays:0,expectedPolicyReference:p},c);if(!policy.allowed)return false;
  const rows=await c.query(`SELECT j.id FROM slack_triage_jobs j JOIN slack_event_receipts r ON r.id=j.receipt_id
   JOIN slack_connections conn ON conn.id=j.connection_id JOIN slack_processing_controls pc ON pc.connection_id=conn.id
   JOIN slack_fanout_runtime runtime ON runtime.app_id=r.slack_app_id
   JOIN slack_processing_consents consent ON consent.workspace_id=conn.workspace_id AND consent.provider_id=$2
   JOIN slack_trusted_providers provider ON provider.id=consent.provider_id
   WHERE j.id=ANY($1::uuid[]) AND j.status IN ('pending','running','held_budget') AND j.expires_at>clock_timestamp() AND r.created_at+interval '24 hours'>clock_timestamp()
   AND j.user_id=$3 AND j.connection_id=$4 AND j.identity_version=$5 AND j.policy_reference=$7::jsonb AND conn.app_id=$6 AND r.slack_app_id=$6
   AND pc.enabled AND pc.version=j.processing_version AND pc.identity_version=j.identity_version AND runtime.enabled AND runtime.version=j.runtime_version
   AND r.source_event_time>=GREATEST(runtime.processing_started_at,pc.processing_started_at,consent.granted_at,consent.processing_effective_at,conn.connected_at,conn.identity_epoch_at,provider.verified_at,provider.updated_at,provider.processing_effective_at,pc.config_revision_at,pc.resumed_at)`,[lease.triggers.map(t=>t.jobId),p.providerProfileId,b.atiUserId,b.connectionId,b.identityVersion,this.options.appId,JSON.stringify(p)]);
  if(rows.rowCount!==lease.triggers.length||rows.rowCount===0)return false;
  for(const t of lease.triggers){const barrier=await checkSlackInvalidationBarriers(c,{binding:b,epoch,workspaceId:b.workspaceId,channelId:t.channelId,resourceType:'message',resourceId:slackMessageResourceId(t.channelId,t.messageTs),revision:t.messageTs});if(barrier.blocked)return false;}return true;
 }
 async claim(limit:number,workerId:string,signal?:AbortSignal):Promise<SlackTriageLease[]>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||!workerId?.trim()||workerId.length>128)throw new TypeError('SLACK_ASSISTANT_INVALID');if(!this.options.automationEnabled)return [];
  await this.pool.query("WITH expired AS (SELECT id FROM slack_triage_jobs WHERE status IN ('pending','running','held_budget') AND expires_at<=clock_timestamp() FOR UPDATE SKIP LOCKED) UPDATE slack_triage_jobs SET status='needs_attention',attention_code='expired',lease_token=NULL,lease_owner=NULL,lease_until=NULL WHERE id IN (SELECT id FROM expired)");
  const candidates=(await this.pool.query(`SELECT due.id,due.user_id FROM (
   SELECT DISTINCT ON(j.connection_id) j.id,j.user_id,j.available_at,j.connection_id
   FROM slack_triage_jobs j JOIN slack_event_receipts r ON r.id=j.receipt_id JOIN slack_workspace_configs cfg ON cfg.connection_id=j.connection_id
   WHERE r.slack_app_id=$1 AND cfg.config_json->'enabled'='true'::jsonb
    AND (j.status='pending' AND j.available_at<=clock_timestamp() OR j.status='running' AND j.lease_until<=clock_timestamp() OR j.status='held_budget' AND j.held_until<=clock_timestamp())
    AND NOT EXISTS(SELECT 1 FROM slack_triage_jobs busy WHERE busy.connection_id=j.connection_id
     AND (busy.status='running' AND busy.lease_until>clock_timestamp() OR busy.status='held_budget' AND busy.held_until>clock_timestamp()))
   ORDER BY j.connection_id,j.available_at,j.created_at,j.id
  ) due ORDER BY due.available_at,due.id LIMIT 100`,[this.options.appId])).rows;
  const result:SlackTriageLease[]=[];
  for(const candidate of candidates){if(result.length>=limit)break;const lease=await this.transaction(async c=>{
   if(!await this.owner(c,candidate.user_id,true))return null;
   const hint=(await c.query('SELECT j.*,cfg.config_json FROM slack_triage_jobs j JOIN slack_workspace_configs cfg ON cfg.connection_id=j.connection_id WHERE j.id=$1',[candidate.id])).rows[0];
   if(!hint)return null;
   // Lock every eligible thread sibling before taking job/authority rows.
   const siblings=(await c.query(`SELECT j.id FROM slack_triage_jobs j JOIN slack_event_receipts r ON r.id=j.receipt_id JOIN slack_event_receipts root ON root.id=$2
    WHERE j.connection_id=$1 AND (j.id=$3 OR j.status='pending' AND r.created_at>=root.created_at AND r.created_at<=root.created_at+interval '30 seconds') AND j.expires_at>clock_timestamp()
    AND j.policy_reference=$4::jsonb AND j.processing_version=$5 AND j.runtime_version=$6 AND r.channel_id=root.channel_id AND COALESCE(r.thread_ts,r.message_ts)=COALESCE(root.thread_ts,root.message_ts) ORDER BY r.created_at,j.id LIMIT 20`,[hint.connection_id,hint.receipt_id,hint.id,JSON.stringify(hint.policy_reference),hint.processing_version,hint.runtime_version])).rows.map(r=>r.id);
   hint.batch_job_ids=siblings;const hintContext=await this.context(c,hint);await this.lockSources(c,hintContext);await this.lockAuthority(c,hintContext);
   const row=(await c.query(`SELECT j.*,cfg.config_json,cfg.version AS current_config_version FROM slack_triage_jobs j JOIN slack_workspace_configs cfg ON cfg.connection_id=j.connection_id
    WHERE j.id=$1 AND (j.status='pending' AND j.available_at<=clock_timestamp() OR j.status='running' AND j.lease_until<=clock_timestamp() OR j.status='held_budget' AND j.held_until<=clock_timestamp()) FOR UPDATE OF j,cfg`,[candidate.id])).rows[0];
   if(!row||!validateSlackAssistantConfig(row.config_json).enabled)return null;
   if((await c.query("SELECT 1 FROM slack_triage_jobs WHERE connection_id=$1 AND status='held_budget' AND held_until>clock_timestamp()",[row.connection_id])).rowCount)return null;
   if((await c.query("SELECT id FROM slack_triage_jobs WHERE connection_id=$1 AND status='running' AND id<>$2",[row.connection_id,row.id])).rowCount)return null;
   row.claimed_config_version=row.current_config_version;
   row.batch_job_ids=siblings;
   const context=await this.context(c,row);if(!await this.allowed(c,context)){await c.query("UPDATE slack_triage_jobs SET status='cancelled' WHERE id=$1",[row.id]);return null;}
   const updated=(await c.query(`UPDATE slack_triage_jobs SET status='running',lease_token=gen_random_uuid(),lease_owner=$2,lease_until=clock_timestamp()+interval '120 seconds',claimed_config_version=$3,batch_job_ids=$4,held_until=NULL WHERE id=$1 RETURNING *`,[row.id,workerId,row.current_config_version,row.batch_job_ids])).rows[0];
   await c.query("UPDATE slack_workspace_configs SET paused_reason=NULL WHERE connection_id=$1 AND paused_reason='budget_exceeded'",[row.connection_id]);
   return this.context(c,{...updated,config_json:row.config_json});
  },signal);if(lease)result.push(lease);}
  return result;
 }
 private async guarded(c:pg.PoolClient,input:SlackTriageLease,segments:DerivedSegmentInput[]=[],prepare?:(lease:SlackTriageLease)=>Promise<void>):Promise<{lease:SlackTriageLease;changed:boolean}>{
  if(!input||!isUuid(input.id)||!isUuid(input.leaseToken)||!isUuid(input.binding?.atiUserId))throw lost();await this.owner(c,input.binding.atiUserId);
  const hint=(await c.query('SELECT j.*,cfg.config_json FROM slack_triage_jobs j JOIN slack_workspace_configs cfg ON cfg.connection_id=j.connection_id WHERE j.id=$1 AND j.user_id=$2',[input.id,input.binding.atiUserId])).rows[0];
  if(!hint)throw lost();const context=await this.context(c,hint);await this.lockSources(c,context,segments);await prepare?.(context);await this.lockAuthority(c,context);
  const row=(await c.query(`SELECT j.*,cfg.config_json,cfg.version AS current_config_version FROM slack_triage_jobs j JOIN slack_workspace_configs cfg ON cfg.connection_id=j.connection_id WHERE j.id=$1 AND j.user_id=$2 FOR UPDATE OF cfg,j`,[input.id,input.binding.atiUserId])).rows[0];
  if(!row||row.status!=='running'||row.lease_token!==input.leaseToken||row.lease_owner!==input.workerId||row.claimed_config_version!==input.configVersion)throw lost();
  const lease=await this.context(c,row);if(!lease.config.enabled||!await this.allowed(c,lease))throw new Error('SLACK_POLICY_DENIED');
  if(segments.length){
   if(segments.some(s=>!sameSlackBinding(s.sourceRef.binding,lease.binding)||!sameSlackPolicyEpoch(slackPolicyRefToEpoch(s.acquisitionPolicyRef),slackPolicyRefToEpoch(lease.policyReference))))throw new Error('SLACK_POLICY_DENIED');
   await new SlackDerivedLineageRepo(this.pool,this.policy).assertSegmentsAllowedInTransaction(c,segments,lease.binding.atiUserId,'triage');
  }
  if(!(await c.query('SELECT 1 FROM slack_triage_jobs WHERE id=$1 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp()',[input.id])).rowCount)throw lost();
  return {lease,changed:row.current_config_version!==row.claimed_config_version};
 }
 async assertCurrent(input:SlackTriageLease,signal?:AbortSignal,segments:DerivedSegmentInput[]=[]):Promise<void>{
  await this.transaction(async c=>{const {changed}=await this.guarded(c,input,segments);if(changed)throw new Error('SLACK_ASSISTANT_CONFIG_CHANGED');},signal);
 }
 async reserveAttempt(input:SlackTriageLease,reservedTokens:number,signal?:AbortSignal,segments:DerivedSegmentInput[]=[]):Promise<void>{
  if(!Number.isSafeInteger(reservedTokens)||reservedTokens<1||reservedTokens>1000000000)throw new TypeError('SLACK_ASSISTANT_INVALID');
  const outcome=await this.transaction(async c=>{
   const {lease,changed}=await this.guarded(c,input,segments);if(changed)throw new Error('SLACK_ASSISTANT_CONFIG_CHANGED');
   const periods=(await c.query(`WITH cut AS MATERIALIZED(SELECT clock_timestamp() AT TIME ZONE 'UTC' AS at) SELECT kind,to_char(date_trunc(kind,cut.at),'YYYY-MM-DD') AS start,
    (date_trunc(kind,cut.at)+CASE WHEN kind='day' THEN interval '1 day' ELSE interval '1 month' END) AT TIME ZONE 'UTC' AS reset FROM cut,unnest(ARRAY['day','month']) kind`)).rows;
   let reset:Date|undefined;
   for(const period of periods){await c.query('INSERT INTO slack_assistant_budget_usage(connection_id,period_kind,period_start) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[lease.binding.connectionId,period.kind,period.start]);
    const usage=(await c.query('SELECT * FROM slack_assistant_budget_usage WHERE connection_id=$1 AND period_kind=$2 AND period_start=$3 FOR UPDATE',[lease.binding.connectionId,period.kind,period.start])).rows[0];
    const b=lease.config.budget,calls=period.kind==='day'?b.dailyCalls:b.monthlyCalls,tokens=period.kind==='day'?b.dailyTokens:b.monthlyTokens;
    if(usage.calls>=calls||BigInt(usage.reserved_tokens)+BigInt(reservedTokens)>BigInt(tokens)){if(!reset||period.reset>reset)reset=period.reset;}
   }
   if(reset){await c.query("UPDATE slack_triage_jobs SET status='held_budget',held_until=$2,lease_token=NULL,lease_owner=NULL,lease_until=NULL WHERE id=$1",[lease.id,reset]);await c.query("UPDATE slack_workspace_configs SET paused_reason='budget_exceeded' WHERE connection_id=$1",[lease.binding.connectionId]);return false;}
   for(const period of periods)await c.query('UPDATE slack_assistant_budget_usage SET calls=calls+1,reserved_tokens=reserved_tokens+$4 WHERE connection_id=$1 AND period_kind=$2 AND period_start=$3',[lease.binding.connectionId,period.kind,period.start,reservedTokens]);
   await c.query('INSERT INTO slack_assistant_model_attempts(job_id,lease_token,user_id,connection_id,day_start,month_start,reserved_tokens) VALUES($1,$2,$3,$4,$5,$6,$7)',[lease.id,lease.leaseToken,lease.binding.atiUserId,lease.binding.connectionId,periods.find(p=>p.kind==='day')!.start,periods.find(p=>p.kind==='month')!.start,reservedTokens]);return true;
  },signal);if(!outcome)throw new Error('SLACK_BUDGET_HELD');
 }
 /** Usage is source-free accounting. A revoked or expired request is still charged; an unknown result stays unknown. */
 async recordReportedUsage(input:SlackTriageLease,totalTokens:number|null):Promise<void>{
  if(totalTokens===null)return;if(!Number.isSafeInteger(totalTokens)||totalTokens<0||totalTokens>1000000000||!isUuid(input.id)||!isUuid(input.leaseToken))throw new TypeError('SLACK_ASSISTANT_INVALID');
  await this.transaction(async c=>{await this.owner(c,input.binding.atiUserId);
   const row=(await c.query(`UPDATE slack_assistant_model_attempts SET actual_tokens=$4,reported_at=clock_timestamp()
    WHERE id=(SELECT id FROM slack_assistant_model_attempts WHERE job_id=$1 AND lease_token=$2 AND user_id=$3 ORDER BY id DESC LIMIT 1) AND reported_at IS NULL RETURNING *`,[input.id,input.leaseToken,input.binding.atiUserId,totalTokens])).rows[0];if(!row)return;
   for(const kind of ['day','month'])await c.query('UPDATE slack_assistant_budget_usage SET actual_tokens=COALESCE(actual_tokens,0)+$4,reported_calls=reported_calls+1 WHERE connection_id=$1 AND period_kind=$2 AND period_start=$3',[row.connection_id,kind,kind==='day'?row.day_start:row.month_start,totalTokens]);
  });
 }
 async publish(input:SlackTriageLease,decision:SlackTriageDecision,segments:DerivedSegmentInput[],signal?:AbortSignal,context:SlackProposalContext[]=[],truncated=false):Promise<{status:'published'|'requeued';artifactId?:string}>{
  return this.transaction(async c=>{
   const {lease,changed}=await this.guarded(c,input,segments,decision.kind==='no_action'?undefined:async l=>{await this.artifacts?.prepareProposalInTransaction(c,l,decision,context);});
   if(changed){await c.query("UPDATE slack_triage_jobs SET status='pending',lease_token=NULL,lease_owner=NULL,lease_until=NULL,batch_job_ids=NULL WHERE id=$1",[lease.id]);return {status:'requeued'};}
   let artifactId:string|undefined;
   if(decision.kind!=='no_action'){if(!this.artifacts)throw new Error('SLACK_PROPOSAL_WRITER_UNAVAILABLE');validateSlackTriageDecision(decision,context.length);artifactId=await this.artifacts.publishProposalInTransaction(c,lease,decision,segments,context,truncated);}
   if(!(await c.query("SELECT 1 FROM slack_triage_jobs WHERE id=$1 AND status='running' AND lease_token=$2 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp()",[lease.id,lease.leaseToken])).rowCount)throw lost();
   for(const trigger of lease.triggers)await c.query('INSERT INTO slack_triage_decisions(job_id,kind,config_version) VALUES($1,$2,$3)',[trigger.jobId,decision.kind,lease.configVersion]);
   const update=await c.query("UPDATE slack_triage_jobs SET status='decided',lease_token=NULL,lease_owner=NULL,lease_until=NULL WHERE id=ANY($1::uuid[]) AND status IN ('pending','running')",[lease.triggers.map(t=>t.jobId)]);
   if(update.rowCount!==lease.triggers.length)throw lost();signal?.throwIfAborted();return {status:'published',...(artifactId?{artifactId}:{})};
  },signal);
 }
 async hold(input:SlackTriageLease,reason:'source_unavailable'|'model_failed'|'context_limit'):Promise<void>{
  if(!['source_unavailable','model_failed','context_limit'].includes(reason))throw new TypeError('SLACK_ASSISTANT_INVALID');
  await this.transaction(async c=>{const {lease,changed}=await this.guarded(c,input);if(changed){await c.query("UPDATE slack_triage_jobs SET status='pending',lease_token=NULL,lease_owner=NULL,lease_until=NULL,batch_job_ids=NULL WHERE id=$1",[lease.id]);return;}await c.query("UPDATE slack_triage_jobs SET status='needs_attention',attention_code=$2,lease_token=NULL,lease_owner=NULL,lease_until=NULL WHERE id=ANY($1::uuid[])",[lease.triggers.map(t=>t.jobId),reason]);});
 }
}
