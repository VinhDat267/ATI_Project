import { createHash } from 'node:crypto';
import type pg from 'pg';
import { formatSlackOwnerSourceKey, sameSlackBinding, sameSlackPolicyEpoch, slackPolicyRefToEpoch,
  validateSlackPolicyReference, validateSlackPurgeTarget, validateSlackSourceRef,
  type SlackPolicyReference, type SlackPurgeTarget, type SlackSourceRef } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';
import { acquireSlackInvalidationLocks, compareSlackRevisions, slackSourceWriteLockKeys } from './slack-invalidation-service.js';

interface Input { intentId:string; derivedCopyId:string; expectedTargetVersion:string; signal?:AbortSignal }
export type MessagePurgeResult={status:'purged'|'already_purged'|'skipped'|'stale_lineage'|'missing_handler'};
interface Segment { source:SlackSourceRef; policy:SlackPolicyReference; channelId?:string }
const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
const TOMBSTONE='Slack content is unavailable.';

/** Erasure validates persisted identity, not current authorization: a disconnect or
 * expired consent must never prevent removal of the content it invalidated. */
function segment(row:any,owner:string):Segment {
  const binding={atiUserId:row.ati_user_id,connectionId:row.connection_id,workspaceId:row.workspace_id,
    slackUserId:row.slack_user_id,identityVersion:row.identity_version};
  const source=validateSlackSourceRef({binding,resourceType:row.resource_type,resourceId:row.resource_id,revision:row.revision});
  const policy=validateSlackPolicyReference({binding,purpose:row.policy_purpose,requestedRetentionDays:row.storage_requested_retention_days,
    providerProfileId:row.provider_profile_id,configFingerprint:row.config_fingerprint,policyVersion:row.policy_version,
    consentRevision:row.consent_revision,providerRevision:row.provider_revision});
  if(binding.atiUserId!==owner || policy.purpose!=='storage' || row.owner_source_key!==formatSlackOwnerSourceKey(source)) throw new Error('STALE_LINEAGE');
  let channelId=row.channel_id ?? undefined;
  if(source.resourceType==='message') {
    const tuple:unknown=JSON.parse(source.resourceId);
    if(!Array.isArray(tuple) || tuple.length!==2 || typeof tuple[0]!=='string' || !tuple[0].trim() ||
       typeof tuple[1]!=='string' || !/^[0-9]{1,10}(?:[.][0-9]{1,6})?$/.test(tuple[1]) || JSON.stringify(tuple)!==source.resourceId ||
       (channelId!==undefined && channelId!==tuple[0])) throw new Error('STALE_LINEAGE');
    channelId=tuple[0];
  } else if(source.resourceType==='conversation') {
    if(channelId!==undefined && channelId!==source.resourceId) throw new Error('STALE_LINEAGE');
    channelId=source.resourceId;
  }
  if(channelId!==undefined && (typeof channelId!=='string' || !channelId.trim())) throw new Error('STALE_LINEAGE');
  return {source,policy,channelId};
}
function matches(s:Segment,t:SlackPurgeTarget):boolean {
  const b=s.source.binding,p=s.policy,r=s.source;
  switch(t.scope) {
    case 'authorization_disconnect': return sameSlackBinding(b,t.binding);
    case 'channel_membership_lost': return sameSlackBinding(b,t.binding) && s.channelId===t.channelId;
    case 'policy_epoch_invalidated': return sameSlackPolicyEpoch(slackPolicyRefToEpoch(p),t.epoch);
    case 'workspace_consent_revocation': return b.workspaceId===t.workspaceId && p.providerProfileId===t.providerProfileId &&
      p.policyVersion===t.policyVersion && BigInt(p.consentRevision)<BigInt(t.consentRevision);
    case 'owner_retention': return sameSlackBinding(b,t.binding) && r.resourceType===t.resourceType && r.resourceId===t.resourceId &&
      (t.revision===undefined || r.revision===t.revision) && sameSlackPolicyEpoch(slackPolicyRefToEpoch(p),slackPolicyRefToEpoch(t.policyRef)) &&
      p.purpose===t.policyRef.purpose && p.requestedRetentionDays===t.policyRef.requestedRetentionDays;
    case 'resource_lifecycle': {
      if(b.workspaceId!==t.workspaceId || r.resourceType!==t.resourceType || r.resourceId!==t.resourceId ||
         (t.revision!==undefined && r.revision!==t.revision)) return false;
      if(t.beforeRevision!==undefined) {
        try {return compareSlackRevisions(r.revision,t.beforeRevision)<0;} catch {return true;}
      }
      return true;
    }
  }
}

/** Concrete selector only. Caller must BEGIN and rollback on any throw. This
 * handler neither claims nor completes queue jobs and never certifies full F3. */
export class SlackMessageContentPurger {
  async purgeInTransaction(client:pg.PoolClient,input:Input):Promise<MessagePurgeResult> {
    input.signal?.throwIfAborted();
    if(!isUuid(input.intentId) || !isUuid(input.derivedCopyId) || typeof input.expectedTargetVersion!=='string' ||
       !/^[1-9][0-9]{0,18}$/.test(input.expectedTargetVersion) || BigInt(input.expectedTargetVersion)>9223372036854775807n) throw new TypeError('INVALID_PURGE_INPUT');
    await client.query('SAVEPOINT slack_message_purge_tx_guard');
    await client.query('RELEASE SAVEPOINT slack_message_purge_tx_guard');
    const intent=(await client.query('SELECT target_kind,purge_target,created_at::text AS cutoff,status FROM slack_invalidation_intents WHERE id=$1',[input.intentId])).rows[0];
    if(!intent || intent.status==='completed') return {status:'skipped'};
    if(intent.target_kind!=='chat_history_message') return {status:'missing_handler'};
    let target:SlackPurgeTarget;
    try {target=validateSlackPurgeTarget(intent.purge_target);} catch {return {status:'stale_lineage'};}
    if(!target.cascadeTargetKinds.includes('chat_history_message')) return {status:'stale_lineage'};
    const loadCopy=async(lock=false)=>(await client.query(`SELECT *,created_at<=$2::timestamptz AS eligible FROM slack_derived_copies WHERE id=$1 ${lock?'FOR UPDATE':''}`,[input.derivedCopyId,intent.cutoff])).rows[0];
    const first=await loadCopy();
    if(!first) return {status:'skipped'};
    if(first.target_kind!=='chat_history_message' || first.target_sub_id!=='content') return {status:'missing_handler'};
    if(first.target_version!==input.expectedTargetVersion) return {status:'stale_lineage'};
    const loadSegments=async()=>(await client.query('SELECT * FROM slack_derived_provenance_segments WHERE derived_copy_id=$1 ORDER BY segment_index',[input.derivedCopyId])).rows;
    const rows=await loadSegments();
    let segments:Segment[];
    try {
      if(rows.length===0 || rows.length>256) throw new Error('STALE_LINEAGE');
      segments=rows.map(r=>segment(r,first.ati_user_id));
    } catch {return {status:'stale_lineage'};}
    if(!segments.some(s=>matches(s,target))) return {status:'skipped'};
    if(!first.eligible) return {status:'stale_lineage'};
    await acquireSlackInvalidationLocks(client,segments.flatMap(s=>slackSourceWriteLockKeys({binding:s.source.binding,
      epoch:slackPolicyRefToEpoch(s.policy),resourceType:s.source.resourceType,resourceId:s.source.resourceId,channelId:s.channelId})));
    input.signal?.throwIfAborted();
    const found=(await client.query('SELECT conv_id FROM messages WHERE id=$1',[first.target_id])).rows[0];
    if(!found) return {status:'stale_lineage'};
    const parent=await client.query('SELECT id FROM conversations WHERE id=$1 AND user_id=$2 FOR UPDATE',[found.conv_id,first.ati_user_id]);
    if(parent.rowCount!==1) return {status:'stale_lineage'};
    const message=(await client.query('SELECT conv_id,content FROM messages WHERE id=$1 FOR UPDATE',[first.target_id])).rows[0];
    const current=await loadCopy(true),currentSegments=await loadSegments();
    input.signal?.throwIfAborted();
    if(!current || current.target_version!==input.expectedTargetVersion || current.target_fingerprint!==first.target_fingerprint ||
       current.ati_user_id!==first.ati_user_id || current.target_kind!==first.target_kind || current.target_id!==first.target_id || current.target_sub_id!==first.target_sub_id ||
       !current.eligible || JSON.stringify(currentSegments)!==JSON.stringify(rows) || !message || message.conv_id!==found.conv_id) return {status:'stale_lineage'};
    if(current.status==='purged') return {status:message.content===TOMBSTONE?'already_purged':'stale_lineage'};
    if(current.status!=='active') return {status:current.retired_reason==='fingerprint_mismatch'?'stale_lineage':'skipped'};
    if(hash(message.content)!==current.target_fingerprint) {
      await client.query(`UPDATE slack_derived_copies SET status='retired',retired_at=clock_timestamp(),retired_reason='fingerprint_mismatch',updated_at=clock_timestamp() WHERE id=$1 AND status='active'`,[current.id]);
      input.signal?.throwIfAborted();
      return {status:'stale_lineage'};
    }
    const written=await client.query('UPDATE messages SET content=$1 WHERE id=$2 AND conv_id=$3 AND content=$4',[TOMBSTONE,current.target_id,found.conv_id,message.content]);
    const marked=await client.query(`UPDATE slack_derived_copies SET status='purged',purged_at=clock_timestamp(),purge_reason=$3,updated_at=clock_timestamp()
      WHERE id=$1 AND target_version=$2::bigint AND target_fingerprint=$4 AND status='active'`,[current.id,input.expectedTargetVersion,target.tombstoneReason,current.target_fingerprint]);
    if(written.rowCount!==1 || marked.rowCount!==1) throw new Error('STALE_LINEAGE');
    input.signal?.throwIfAborted();
    return {status:'purged'};
  }
}
