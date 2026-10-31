import {createHash} from 'node:crypto';
import type pg from 'pg';
import {SLACK_DERIVED_TARGET_KINDS,formatSlackOwnerSourceKey,sameSlackBinding,slackPolicyRefToEpoch,validateSlackPolicyReference,validateSlackPurgeTarget,validateSlackSourceRef,type SlackPurgeTarget} from '@wap/tool-schemas';
import {acquireSlackInvalidationLocks,slackSourceWriteLockKeys} from './slack-invalidation-service.js';

const EFFECT='derived_capture_expired';
const exact=(column:string)=>`to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const SELECT=`SELECT s.*,c.ati_user_id AS copy_owner,c.target_version::text AS copy_version,
  c.target_kind AS artifact_kind,c.target_id AS artifact_id,c.target_sub_id AS artifact_selector,c.target_fingerprint AS artifact_fingerprint,
  ${exact('s.captured_at')} AS captured_exact,${exact('s.expires_at')} AS expires_exact,
  s.expires_at<=clock_timestamp() AND s.expires_at>s.captured_at AND
  s.expires_at<=s.captured_at+make_interval(days=>s.effective_retention_days) AND
  s.effective_retention_days<=s.storage_requested_retention_days AND s.effective_retention_days BETWEEN 1 AND 30 AS valid_expiry
  FROM slack_derived_provenance_segments s JOIN slack_derived_copies c ON c.id=s.derived_copy_id`;

function snapshot(row:any){
  const binding={atiUserId:row.ati_user_id,connectionId:row.connection_id,workspaceId:row.workspace_id,slackUserId:row.slack_user_id,identityVersion:row.identity_version};
  const sourceRef=validateSlackSourceRef({binding,resourceType:row.resource_type,resourceId:row.resource_id,revision:row.revision});
  const policyRef=validateSlackPolicyReference({binding,purpose:row.policy_purpose,requestedRetentionDays:row.storage_requested_retention_days,providerProfileId:row.provider_profile_id,configFingerprint:row.config_fingerprint,policyVersion:row.policy_version,consentRevision:row.consent_revision,providerRevision:row.provider_revision});
  if(row.copy_owner!==binding.atiUserId||!sameSlackBinding(sourceRef.binding,policyRef.binding)||row.owner_source_key!==formatSlackOwnerSourceKey(sourceRef)||policyRef.purpose!=='storage'||!row.valid_expiry||!/^[1-9][0-9]*$/.test(row.copy_version))throw Error('INVALID_DERIVED_EXPIRY');
  let channelId=row.channel_id??undefined;
  if(sourceRef.resourceType==='message'){
    const tuple=JSON.parse(sourceRef.resourceId);
    if(!Array.isArray(tuple)||tuple.length!==2||typeof tuple[0]!=='string'||typeof tuple[1]!=='string'||!/^[0-9]{1,10}(?:[.][0-9]{1,6})?$/.test(tuple[1])||JSON.stringify(tuple)!==sourceRef.resourceId||(channelId!==undefined&&channelId!==tuple[0]))throw Error('INVALID_DERIVED_EXPIRY');
    channelId=tuple[0];
  }else if(sourceRef.resourceType==='conversation'){
    if(channelId!==undefined&&channelId!==sourceRef.resourceId)throw Error('INVALID_DERIVED_EXPIRY');channelId=sourceRef.resourceId;
  }
  return {copyId:row.derived_copy_id as string,targetVersion:row.copy_version as string,segmentIndex:row.segment_index as number,
    targetKind:row.artifact_kind as string,targetId:row.artifact_id as string,targetSubId:row.artifact_selector as string,targetFingerprint:row.artifact_fingerprint as string,
    sourceRef,policyRef,channelId:channelId??null,captureHash:row.capture_hash as string,ownerSourceKey:row.owner_source_key as string,
    acquisitionPurpose:row.acquisition_purpose as string,acquisitionRetentionDays:row.acquisition_requested_retention_days as number,
    effectiveRetentionDays:row.effective_retention_days as number,capturedAt:row.captured_exact as string,expiresAt:row.expires_exact as string};
}
type Snapshot=ReturnType<typeof snapshot>;
function digest(value:Snapshot){return createHash('sha256').update(`derived-expiry-proof:v1:${JSON.stringify(value)}`).digest('hex');}
function receiptHash(value:Snapshot,cutoff:string){return createHash('sha256').update(`derived-expiry-receipt:v1:${JSON.stringify({snapshot:value,cutoff})}`).digest('hex');}
function key(value:Snapshot){return `derived-expiry:${digest(value)}`;}
function target(value:Snapshot):SlackPurgeTarget{return validateSlackPurgeTarget({scope:'owner_retention',binding:value.sourceRef.binding,policyRef:value.policyRef,resourceType:value.sourceRef.resourceType,resourceId:value.sourceRef.resourceId,revision:value.sourceRef.revision,cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS],tombstoneReason:'retention_expired'});}
function keys(value:Snapshot){return slackSourceWriteLockKeys({binding:value.sourceRef.binding,epoch:slackPolicyRefToEpoch(value.policyRef),resourceType:value.sourceRef.resourceType,resourceId:value.sourceRef.resourceId,channelId:value.channelId??undefined});}
function same(a:unknown,b:unknown):boolean{
  const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return canonical(a)===canonical(b);
}

/** Current DB time and immutable persisted identity, never a prefix or client
 * claim, authorize this one time-only queue domain. Normal events need barriers. */
export async function derivedExpiryProof(client:pg.PoolClient,intent:any,lock=false):Promise<{lockKeys:string[]}|null>{
  const proof=(await client.query(`SELECT p.*,r.payload_hash,${exact('p.cutoff_at')} AS cutoff_exact,
    p.expires_at<=p.cutoff_at AND i.created_at=p.cutoff_at AND r.created_at=p.cutoff_at AND p.cutoff_at<=clock_timestamp() AS due
    FROM slack_derived_expiry_proofs p JOIN slack_invalidation_receipts r ON r.source_event_key=p.source_event_key
    JOIN slack_invalidation_intents i ON i.id=$2::uuid AND i.source_event_key=p.source_event_key
    WHERE p.source_event_key=$1 ${lock?'FOR SHARE OF p,r':''}`,[intent.source_event_key,intent.id])).rows[0];
  if(!proof)return null;
  const row=(await client.query(`${SELECT} WHERE s.derived_copy_id=$1 AND s.segment_index=$2`,[proof.derived_copy_id,proof.segment_index])).rows[0];
  if(!row)throw Error('INVALID_DERIVED_EXPIRY');
  const value=snapshot(row);
  if(!proof.due||intent.effect_key!==EFFECT||proof.target_version!==value.targetVersion||
    key(value)!==proof.source_event_key||receiptHash(value,proof.cutoff_exact)!==proof.payload_hash||!same(value,proof.snapshot)||
    !same(target(value),intent.purge_target))throw Error('INVALID_DERIVED_EXPIRY');
  // Exact timestamp comparisons remain on PostgreSQL, retaining microseconds.
  const valid=(await client.query('SELECT captured_at=$2::timestamptz AND expires_at=$3::timestamptz AS valid FROM slack_derived_expiry_proofs WHERE source_event_key=$1',[intent.source_event_key,value.capturedAt,value.expiresAt])).rows[0]?.valid;
  if(!valid)throw Error('INVALID_DERIVED_EXPIRY');
  return {lockKeys:keys(value)};
}

export class SlackDerivedExpiryFanout {
  constructor(private readonly pool:pg.Pool){}
  async runOnce(limit=50,signal?:AbortSignal):Promise<{staged:number}>{
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw TypeError('INVALID_DERIVED_EXPIRY_BOUND');
    signal?.throwIfAborted();
    const candidates=(await this.pool.query(`SELECT c.id,c.target_version::text AS version,s.segment_index
      FROM slack_derived_copies c JOIN slack_derived_provenance_segments s ON s.derived_copy_id=c.id
      LEFT JOIN slack_derived_expiry_proofs p ON p.derived_copy_id=c.id AND p.target_version=c.target_version AND p.segment_index=s.segment_index AND p.expires_at=s.expires_at
      WHERE (c.status='active' OR (c.status='retired' AND c.retired_reason IN ('fingerprint_mismatch','manual')))
      AND s.expires_at<=clock_timestamp() AND p.source_event_key IS NULL ORDER BY s.expires_at,c.id,s.segment_index LIMIT $1`,[limit])).rows;
    let staged=0;
    for(const candidate of candidates){
      signal?.throwIfAborted();const client=await this.pool.connect();
      try{
        await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='2s'");
        const first=(await client.query(`${SELECT} WHERE c.id=$1 AND s.segment_index=$2`,[candidate.id,candidate.segment_index])).rows[0];
        if(!first||first.copy_version!==candidate.version){await client.query('ROLLBACK');continue;}
        const value=snapshot(first),eventKey=key(value);
        await acquireSlackInvalidationLocks(client,[...keys(value),`derived-expiry-stage:${eventKey}`]);
        const current=(await client.query(`${SELECT} WHERE c.id=$1 AND s.segment_index=$2 FOR SHARE OF c,s`,[candidate.id,candidate.segment_index])).rows[0];
        if(!current||!same(value,snapshot(current)))throw Error('INVALID_DERIVED_EXPIRY');
        signal?.throwIfAborted();
        const old=(await client.query(`SELECT r.payload_hash,p.snapshot,${exact('p.cutoff_at')} AS cutoff_exact,
          p.cutoff_at=r.created_at AND p.cutoff_at>=p.expires_at AND p.cutoff_at<=clock_timestamp() AS valid
          FROM slack_invalidation_receipts r LEFT JOIN slack_derived_expiry_proofs p ON p.source_event_key=r.source_event_key WHERE r.source_event_key=$1`,[eventKey])).rows[0];
        if(old){if(!old.valid||!same(value,old.snapshot)||old.payload_hash!==receiptHash(value,old.cutoff_exact))throw Error('DERIVED_EXPIRY_RECEIPT_CONFLICT');await client.query('COMMIT');continue;}
        // Seal one actual DB cutoff after source locks, shared by receipt/proof
        // and every kind intent. It is part of the immutable receipt hash.
        const cutoff=(await client.query(`SELECT ${exact('clock_timestamp()')} AS cutoff`)).rows[0].cutoff as string;
        await client.query('INSERT INTO slack_invalidation_receipts(source_event_key,payload_hash,created_at) VALUES($1,$2,$3::timestamptz)',[eventKey,receiptHash(value,cutoff),cutoff]);
        await client.query(`INSERT INTO slack_derived_expiry_proofs(source_event_key,derived_copy_id,target_version,segment_index,captured_at,expires_at,cutoff_at,snapshot)
          VALUES($1,$2,$3::bigint,$4,$5::timestamptz,$6::timestamptz,$7::timestamptz,$8::jsonb)`,[eventKey,value.copyId,value.targetVersion,value.segmentIndex,value.capturedAt,value.expiresAt,cutoff,JSON.stringify(value)]);
        for(const kind of SLACK_DERIVED_TARGET_KINDS)await client.query(`INSERT INTO slack_invalidation_intents(source_event_key,effect_key,target_kind,purge_target,status,created_at)
          VALUES($1,$2,$3,$4,'pending',$5::timestamptz)`,[eventKey,EFFECT,kind,JSON.stringify(target(value)),cutoff]);
        signal?.throwIfAborted();await client.query('COMMIT');staged++;
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
    }
    return {staged};
  }
}
