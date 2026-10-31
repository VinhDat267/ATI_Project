import type pg from 'pg';
import { sameSlackBinding,sameSlackPolicyEpoch,validateSlackPurgeTarget,type SlackPurgeTarget } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';
import { acquireSlackInvalidationLocks,compareSlackRevisions,hashPolicyEpoch,slackInvalidationLockKeys,type SlackInvalidationBarrier } from './slack-invalidation-service.js';
import { SlackMessageContentPurger } from './slack-message-content-purger.js';
import { messageFingerprint } from './slack-message-selectors.js';

export interface MessagePurgeLease {id:string;workerNonce:string;leaseUntil:string}
type Outcome='completed'|'retried'|'lost';
type Code='STALE_LINEAGE'|'MISSING_HANDLER'|'INVALID_PROVENANCE'|'PARTIAL_PURGE'|'RETRY_SCAN'|'ABORTED'|'PURGE_FAILED';
type SupportedKind='chat_history_message'|'working_memory_entity'|'plan_step_arg'|'audit_log_entry'|'scheduled_workflow_arg';
interface Options {batchSize?:number;leaseSeconds?:number;targetKind?:SupportedKind;purger?:Pick<SlackMessageContentPurger,'purgeInTransaction'|'sourceLockKeysInTransaction'>}
class Failure extends Error {constructor(readonly safeCode:Code){super(safeCode);}}
class LostLease extends Error {}
function bound(value:number,max:number):void {if(!Number.isSafeInteger(value)||value<1||value>max)throw new TypeError('INVALID_PURGE_BOUND');}
function validateLease(job:MessagePurgeLease):void {
  if(!job || !isUuid(job.id) || !isUuid(job.workerNonce) || typeof job.leaseUntil!=='string' || !Number.isFinite(Date.parse(job.leaseUntil))) throw new TypeError('INVALID_PURGE_LEASE');
}
function binding(row:any) {return {atiUserId:row.user_id,connectionId:row.connection_id,workspaceId:row.workspace_id,slackUserId:row.slack_user_id,identityVersion:row.identity_version};}
function proofBarrier(row:any,t:SlackPurgeTarget):SlackInvalidationBarrier {
  if(!row || row.active!==true)throw new Failure('INVALID_PROVENANCE');
  const reason='purge_consumer';
  if(t.scope==='authorization_disconnect' && row.barrier_type==='binding' && sameSlackBinding(binding(row),t.binding)) return {barrierType:'binding',binding:t.binding,reason};
  if(t.scope==='channel_membership_lost' && row.barrier_type==='channel' && sameSlackBinding(binding(row),t.binding) && row.channel_id===t.channelId) return {barrierType:'channel',binding:t.binding,channelId:t.channelId,reason};
  if(t.scope==='policy_epoch_invalidated' && row.barrier_type==='epoch' && row.epoch_hash===hashPolicyEpoch(t.epoch) && sameSlackPolicyEpoch(row.epoch_json,t.epoch)) return {barrierType:'epoch',epoch:t.epoch,reason};
  if((t.scope==='resource_lifecycle'||t.scope==='owner_retention') && row.barrier_type==='resource' &&
     row.workspace_id===(t.scope==='resource_lifecycle'?t.workspaceId:t.binding.workspaceId) && row.resource_type===t.resourceType && row.resource_id===t.resourceId) {
    let blocks=row.deleted===true;
    if(t.scope==='resource_lifecycle' && t.tombstoneReason==='source_edited') blocks=row.deleted===false && !!row.min_valid_revision && !!t.beforeRevision && compareSlackRevisions(row.min_valid_revision,t.beforeRevision)===0;
    if(t.scope==='owner_retention' && !blocks && t.revision && row.min_valid_revision) {
      try {blocks=compareSlackRevisions(t.revision,row.min_valid_revision)<0;}catch{blocks=false;}
    }
    if(blocks)return {barrierType:'resource',workspaceId:row.workspace_id,resourceType:t.resourceType,resourceId:t.resourceId,
      deleted:row.deleted,...(row.min_valid_revision?{minValidRevision:row.min_valid_revision}:{}),reason};
  }
  // No corresponding global-consent barrier exists in the accepted stage contract.
  throw new Failure('INVALID_PROVENANCE');
}

/** Exact scope SQL; malformed JSON/channel provenance fails closed rather than
 * allowing a membership job to silently miss a registered message copy. */
function selection(target:SlackPurgeTarget):{sql:string;values:unknown[]} {
  const values:unknown[]=[];const p=(value:unknown)=>{values.push(value);return `$${values.length}`;};
  const b=(v:any)=>`s.ati_user_id=${p(v.atiUserId)} AND s.connection_id=${p(v.connectionId)} AND s.workspace_id=${p(v.workspaceId)} AND s.slack_user_id=${p(v.slackUserId)} AND s.identity_version=${p(v.identityVersion)}`;
  const epoch=(v:any)=>`${b(v.binding)} AND s.provider_profile_id=${p(v.providerProfileId)} AND s.config_fingerprint=${p(v.configFingerprint)} AND s.policy_version=${p(v.policyVersion)} AND s.consent_revision=${p(v.consentRevision)} AND s.provider_revision=${p(v.providerRevision)}`;
  let sql:string;
  switch(target.scope) {
    case 'authorization_disconnect':sql=b(target.binding);break;
    case 'channel_membership_lost': {
      const owner=b(target.binding),channel=p(target.channelId);
      sql=`${owner} AND (s.channel_id=${channel} OR (s.resource_type='message' AND
        (s.resource_id::jsonb->>0=${channel} OR jsonb_typeof(s.resource_id::jsonb)<>'array' OR jsonb_array_length(s.resource_id::jsonb)<>2 OR
         (s.channel_id IS NOT NULL AND s.channel_id IS DISTINCT FROM s.resource_id::jsonb->>0))) OR
        (s.resource_type='conversation' AND (s.resource_id=${channel} OR (s.channel_id IS NOT NULL AND s.channel_id<>s.resource_id))))`;break;
    }
    case 'policy_epoch_invalidated':sql=epoch(target.epoch);break;
    case 'workspace_consent_revocation':sql=`s.workspace_id=${p(target.workspaceId)} AND s.provider_profile_id=${p(target.providerProfileId)} AND s.policy_version=${p(target.policyVersion)} AND s.consent_revision::numeric<${p(target.consentRevision)}::numeric`;break;
    case 'owner_retention':sql=`${epoch(target.policyRef)} AND s.resource_type=${p(target.resourceType)} AND s.resource_id=${p(target.resourceId)} AND s.policy_purpose=${p(target.policyRef.purpose)} AND s.storage_requested_retention_days=${p(target.policyRef.requestedRetentionDays)}`;
      if(target.revision!==undefined)sql+=` AND s.revision=${p(target.revision)}`;break;
    case 'resource_lifecycle':sql=`s.workspace_id=${p(target.workspaceId)} AND s.resource_type=${p(target.resourceType)} AND s.resource_id=${p(target.resourceId)}`;
      if(target.revision!==undefined)sql+=` AND s.revision=${p(target.revision)}`;
      if(target.beforeRevision!==undefined)sql+=` AND CASE WHEN s.revision ~ '^[0-9]+([.][0-9]+)?$' THEN s.revision::numeric<${p(target.beforeRevision)}::numeric ELSE true END`;break;
  }
  return {sql,values};
}

/** One concrete kind per fenced consumer. Completion says nothing about other
 * kinds or legacy artifacts that never passed their writer gate. */
export class SlackMessagePurgeConsumer {
  private readonly size:number;private readonly seconds:number;private readonly purger:NonNullable<Options['purger']>;
  private readonly kind: SupportedKind;
  constructor(private readonly pool:pg.Pool,options:Options={}) {
    this.size=options.batchSize??20;this.seconds=options.leaseSeconds??60;bound(this.size,100);bound(this.seconds,600);this.purger=options.purger??new SlackMessageContentPurger();
    this.kind=options.targetKind??'chat_history_message';
    if(!['chat_history_message','working_memory_entity','plan_step_arg','audit_log_entry','scheduled_workflow_arg'].includes(this.kind))throw new TypeError('INVALID_PURGE_KIND');
  }
  async claim(limit=5):Promise<MessagePurgeLease[]> {
    bound(limit,50);
    const rows=(await this.pool.query(`WITH due AS (SELECT id FROM slack_invalidation_intents WHERE target_kind='${this.kind}'
      AND (status IN ('pending','failed') OR (status='processing' AND leased_until<=clock_timestamp()))
      ORDER BY attempts,created_at,id LIMIT $1 FOR UPDATE SKIP LOCKED)
      UPDATE slack_invalidation_intents j SET status='processing',worker_id=gen_random_uuid()::text,
        leased_until=clock_timestamp()+$2 * interval '1 second',attempts=j.attempts+1
      FROM due WHERE j.id=due.id RETURNING j.id,j.worker_id,j.leased_until::text AS expiry`,[limit,this.seconds])).rows;
    return rows.map(r=>({id:r.id,workerNonce:r.worker_id,leaseUntil:r.expiry}));
  }
  async runOnce(limit=5,signal?:AbortSignal):Promise<{claimed:number;completed:number;retried:number;lost:number}> {
    const stats={claimed:0,completed:0,retried:0,lost:0};if(signal?.aborted)return stats;
    const leases=await this.claim(limit);stats.claimed=leases.length;
    for(const job of leases){if(signal?.aborted)break;stats[await this.process(job,signal)]++;}return stats;
  }
  private async owned(client:pg.PoolClient,job:MessagePurgeLease):Promise<any> {
    const row=(await client.query(`SELECT * FROM slack_invalidation_intents WHERE id=$1 AND worker_id=$2 AND leased_until=$3::timestamptz
      AND leased_until>clock_timestamp() AND status='processing' AND target_kind='${this.kind}'`,[job.id,job.workerNonce,job.leaseUntil])).rows[0];
    if(!row)throw new LostLease();return row;
  }
  private async proof(client:pg.PoolClient,row:any,target:SlackPurgeTarget,lock=false):Promise<SlackInvalidationBarrier> {
    const barrier=(await client.query(`SELECT b.* FROM slack_invalidation_barriers b JOIN slack_invalidation_receipts r ON r.source_event_key=b.source_event_key
      WHERE b.source_event_key=$1 AND b.effect_key=$2 AND b.active=true ${lock?'FOR SHARE OF b':''}`,[row.source_event_key,row.effect_key])).rows[0];
    return proofBarrier(barrier,target);
  }
  private async candidates(client:pg.PoolClient,t:SlackPurgeTarget,cutoff:string,unresolvedOnly=false):Promise<any[]> {
    const {sql,values}=selection(t);
    const orphanOwner=t.scope==='resource_lifecycle'||t.scope==='workspace_consent_revocation'?undefined:
      t.scope==='policy_epoch_invalidated'?t.epoch.binding.atiUserId:t.binding.atiUserId;
    let orphanScope='';if(orphanOwner){values.push(orphanOwner);orphanScope=`AND c.ati_user_id=$${values.length}::uuid`;}
    values.push(cutoff);const date=`$${values.length}`;values.push(this.size+1);const pageSize=`$${values.length}`;
    values.push(0);const offset=`$${values.length}`;
    const query = `WITH candidates AS (SELECT c.id,c.target_version,c.target_fingerprint,c.status,c.target_kind,c.target_sub_id,c.created_at::text AS created_exact,
        m.payload AS artifact_payload,m.payload IS NOT NULL AS artifact_payload_present,
        CASE WHEN c.status='active' AND c.created_at<=${date}::timestamptz THEN 0 ELSE 1 END AS priority,
        n.id AS replacement_id,n.target_version AS replacement_version,n.target_fingerprint AS replacement_fingerprint,
        (EXISTS(SELECT 1 FROM slack_derived_provenance_segments s WHERE s.derived_copy_id=n.id) AND
         NOT EXISTS(SELECT 1 FROM slack_derived_provenance_segments s WHERE s.derived_copy_id=n.id AND s.ati_user_id<>n.ati_user_id) AND
         NOT EXISTS(SELECT 1 FROM slack_derived_provenance_segments s WHERE s.derived_copy_id=n.id AND (${sql}))) AS replacement_outside_target
      FROM slack_derived_copies c LEFT JOIN slack_derived_artifact_payloads m ON m.copy_id=c.id
      LEFT JOIN slack_derived_copies n ON c.status='purged' AND n.status='active' AND n.ati_user_id=c.ati_user_id
        AND n.target_kind=c.target_kind AND n.target_id=c.target_id AND n.target_sub_id=c.target_sub_id AND n.target_version>c.target_version
      WHERE c.target_kind='${this.kind}' AND (c.status='active' OR (c.status='retired' AND c.retired_reason='fingerprint_mismatch') OR
        (c.status='purged' AND m.copy_id IS NOT NULL AND NOT slack_artifact_erased(c.target_kind,c.target_sub_id,m.payload)))
      AND NOT(c.status='purged' AND c.target_kind='scheduled_workflow_arg' AND c.target_sub_id='title' AND EXISTS(SELECT 1 FROM conversations v WHERE v.id::text=c.target_id AND v.slack_title_manual_fingerprint=encode(sha256(convert_to(to_jsonb(v.title)::text,'UTF8')),'hex') AND NOT EXISTS(SELECT 1 FROM slack_derived_copies active WHERE active.target_id=c.target_id AND active.target_kind=c.target_kind AND active.status='active')))
      AND (EXISTS(SELECT 1 FROM slack_derived_provenance_segments s WHERE s.derived_copy_id=c.id AND (${sql})) OR
        (NOT EXISTS(SELECT 1 FROM slack_derived_provenance_segments s WHERE s.derived_copy_id=c.id) ${orphanScope})))
      SELECT * FROM candidates
      ORDER BY priority,id
      LIMIT ${pageSize} OFFSET ${offset}`;
    for (let page=0;page<100;page++) {
    const result = (await client.query(query,values)).rows;
    // Read the current concrete selector, including JSON/memory IDs, before trusting a successor.
    for(const row of result) {
      if(row.replacement_outside_target===true) {
        try {row.replacement_outside_target=messageFingerprint(row.artifact_payload_present?row.artifact_payload:undefined,row.target_sub_id)===row.replacement_fingerprint;}
        catch {row.replacement_outside_target=false;}
      }
      delete row.artifact_payload;delete row.artifact_payload_present;
    }
    if(!unresolvedOnly)return result;
    const unresolved=result.filter(row=>!(row.status==='purged'&&row.replacement_outside_target===true));
    if(unresolved.length || result.length<this.size+1)return unresolved;
    // Do not certify closure from only the first page of valid fresh replacements.
    values[values.length-1]=Number(values[values.length-1])+result.length;
    }
    throw new Failure('RETRY_SCAN');
  }
  private async finish(client:pg.PoolClient,job:MessagePurgeLease,code?:Code,identity?:{target:unknown;cutoff:string}):Promise<boolean> {
    // Lock first, then evaluate the volatile server clock in a new statement.
    await client.query("SELECT id FROM slack_invalidation_intents WHERE id=$1 AND worker_id=$2 AND status='processing' FOR UPDATE",[job.id,job.workerNonce]);
    const result=await client.query(`UPDATE slack_invalidation_intents SET status=$4,last_error=$5,
      completed_at=CASE WHEN $4='completed' THEN clock_timestamp() ELSE NULL END,worker_id=NULL,leased_until=NULL
      WHERE id=$1 AND worker_id=$2 AND leased_until=$3::timestamptz AND leased_until>clock_timestamp() AND status='processing'
      AND ($6::jsonb IS NULL OR purge_target=$6::jsonb) AND ($7::timestamptz IS NULL OR created_at=$7::timestamptz)`,
    [job.id,job.workerNonce,job.leaseUntil,code?'failed':'completed',code?`code:${code}`:null,identity?JSON.stringify(identity.target):null,identity?.cutoff??null]);return result.rowCount===1;
  }
  async process(job:MessagePurgeLease,signal?:AbortSignal):Promise<Outcome> {
    validateLease(job);const client=await this.pool.connect();let failure:Code|undefined;
    try {
      await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='2s'");
      if(signal?.aborted)throw new Failure('ABORTED');
      const row=await this.owned(client,job);let target:SlackPurgeTarget;
      try {target=validateSlackPurgeTarget(row.purge_target);}catch{throw new Failure('INVALID_PROVENANCE');}
      if(!target.cascadeTargetKinds.includes(this.kind))throw new Failure('INVALID_PROVENANCE');
      const barrier=await this.proof(client,row,target),cutoff=(await client.query('SELECT created_at::text AS cutoff FROM slack_invalidation_intents WHERE id=$1',[job.id])).rows[0].cutoff;
      const first=await this.candidates(client,target,cutoff),ids=[...new Set<string>(first.slice(0,this.size).flatMap(r=>
        r.status==='purged'&&r.replacement_id?[r.id,r.replacement_id]:[r.id]))];
      let keys:string[];try {keys=await this.purger.sourceLockKeysInTransaction(client,ids);}catch{throw new Failure('STALE_LINEAGE');}
      await acquireSlackInvalidationLocks(client,[...slackInvalidationLockKeys(barrier),...keys]);
      if(signal?.aborted)throw new Failure('ABORTED');await this.owned(client,job);await this.proof(client,row,target,true);
      const second=await this.candidates(client,target,cutoff),freshKeys=await this.purger.sourceLockKeysInTransaction(client,ids);
      if(JSON.stringify(first)!==JSON.stringify(second)||JSON.stringify(keys)!==JSON.stringify(freshKeys))throw new Failure('RETRY_SCAN');
      // Different workspace bindings can touch the same conversations without
      // sharing source keys. Order ALL parents before any per-copy erasure.
      await client.query(`SELECT v.id FROM conversations v JOIN (
        SELECT DISTINCT m.conv_id,c.ati_user_id FROM slack_derived_copies c JOIN slack_derived_artifact_payloads m ON m.copy_id=c.id
        WHERE c.id=ANY($1::uuid[])) parents ON v.id=parents.conv_id AND v.user_id=parents.ati_user_id
        ORDER BY v.id FOR UPDATE OF v`,[ids]);
      // Fingerprint/supersession checks above read the artifact without its row
      // lock. Recheck while parents serialize the actual registered writer.
      if(JSON.stringify(first)!==JSON.stringify(await this.candidates(client,target,cutoff)))throw new Failure('RETRY_SCAN');
      let code:Code|undefined;
      for(const copy of first.slice(0,this.size)) {
        if(signal?.aborted)throw new Failure('ABORTED');
        // This old physical payload was already erased. A newer, structurally
        // valid registered version now owns the exact text and is outside the
        // old target. Its source keys and parent are held with the old copy's.
        if(copy.status==='purged'&&copy.replacement_id&&copy.replacement_outside_target===true)continue;
        const result=await this.purger.purgeInTransaction(client,{intentId:job.id,derivedCopyId:copy.id,expectedTargetVersion:copy.target_version,signal});
        if(!['purged','already_purged'].includes(result.status))code=result.status==='missing_handler'?'MISSING_HANDLER':'STALE_LINEAGE';
      }
      // Recheck all remaining work under the target barrier. Server-registered
      // successor text outside that target is not an unresolved physical copy;
      // otherwise batches of already-purged history could never make progress.
      // This metadata test grants no authority to read the successor content.
      if(!code&&(await this.candidates(client,target,cutoff,true)).length>0)code='PARTIAL_PURGE';
      if(signal?.aborted)throw new Failure('ABORTED');if(!await this.finish(client,job,code,{target:row.purge_target,cutoff}))throw new LostLease();
      if(signal?.aborted)throw new Failure('ABORTED');await client.query('COMMIT');return code?'retried':'completed';
    }catch(error){await client.query('ROLLBACK').catch(()=>{});if(error instanceof LostLease)return 'lost';failure=error instanceof Failure?error.safeCode:'PURGE_FAILED';}
    finally{client.release();}
    // Reuse no held pool client: a one-connection pool must also recover errors.
    const retry=await this.pool.connect();
    try {await retry.query('BEGIN');await retry.query("SET LOCAL statement_timeout='2s'");const owned=await this.finish(retry,job,failure!);await retry.query('COMMIT');return owned?'retried':'lost';}
    catch(error){await retry.query('ROLLBACK').catch(()=>{});throw error;}finally{retry.release();}
  }
}
