import type pg from 'pg';
import { SLACK_DERIVED_TARGET_KINDS,validateSlackPolicyEpoch } from '@wap/tool-schemas';
import { hashPolicyEpoch,type SlackInvalidationService } from './slack-invalidation-service.js';

/** Only metadata. Source expiry/raw receipts cannot erase the longer-lived
 * derived obligations. No token, provider call or content authorization here. */
export class SlackDerivedPolicyFanout {
  constructor(private readonly pool:pg.Pool,private readonly invalidation:Pick<SlackInvalidationService,'stageDerivedInTransaction'>) {}
  async runOnce(limit=50):Promise<{staged:number}> {
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new TypeError('INVALID_DERIVED_POLICY_BOUND');
    // Match hashPolicyEpoch's JSON array exactly, including string revisions and
    // Unicode/escaped policy names. SQL provides a lookup key, never authority:
    // validate and recompute it again before every transactional stage.
    const fields=['s.ati_user_id::text','s.connection_id::text','s.workspace_id','s.slack_user_id','s.identity_version',
      's.provider_profile_id','s.config_fingerprint','s.policy_version','s.consent_revision','s.provider_revision'];
    const jsonArray="'[' || "+fields.map(f=>`to_json(${f})::text`).join(" || ',' || ")+" || ']'";
    const pairs=(await this.pool.query(`WITH epochs AS (
      SELECT DISTINCT e.id AS event_id,e.event_type,e.occurred_at,s.ati_user_id,s.connection_id,s.workspace_id,s.slack_user_id,s.identity_version,
        s.provider_profile_id,s.config_fingerprint,s.policy_version,s.consent_revision,s.provider_revision,
        encode(sha256(convert_to(${jsonArray},'UTF8')),'hex') AS epoch_hash
      FROM slack_policy_events e JOIN slack_derived_provenance_segments s ON s.provider_profile_id=e.provider_id
      JOIN slack_derived_copies c ON c.id=s.derived_copy_id
      WHERE (c.status='active' OR (c.status='retired' AND c.retired_reason='fingerprint_mismatch')) AND (
        (e.event_type IN ('consent_granted','consent_revoked') AND (e.workspace_id=s.workspace_id OR e.workspace_id='*')
          AND s.consent_revision::numeric<e.consent_revision) OR
        (e.event_type IN ('provider_attested','provider_updated') AND s.provider_revision::numeric<e.provider_revision)))
      SELECT epochs.* FROM epochs LEFT JOIN slack_invalidation_receipts r
        ON r.source_event_key='derived-policy:'||epochs.event_id::text||':'||epochs.epoch_hash
      WHERE r.id IS NULL ORDER BY epochs.occurred_at,epochs.event_id,epochs.epoch_hash LIMIT $1`,[limit])).rows;
    let staged=0;
    for(const row of pairs) {
      const epoch=validateSlackPolicyEpoch({binding:{atiUserId:row.ati_user_id,connectionId:row.connection_id,workspaceId:row.workspace_id,
        slackUserId:row.slack_user_id,identityVersion:row.identity_version},providerProfileId:row.provider_profile_id,
        configFingerprint:row.config_fingerprint,policyVersion:row.policy_version,consentRevision:row.consent_revision,providerRevision:row.provider_revision});
      const epochHash=hashPolicyEpoch(epoch);
      if(epochHash!==row.epoch_hash)throw new Error('INVALID_DERIVED_POLICY_EPOCH');
      const client=await this.pool.connect();
      try {
        await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='2s'");
        await this.invalidation.stageDerivedInTransaction(client,{sourceEventKey:`derived-policy:${row.event_id}:${epochHash}`,effects:[{
          effectKey:`derived_policy_epoch_invalidated:${epochHash}`,barrier:{barrierType:'epoch',epoch,reason:row.event_type==='consent_revoked'?'consent_revoked':'policy_changed'},
          purgeTarget:{scope:'policy_epoch_invalidated',epoch,cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS],tombstoneReason:'policy_changed'},
        }]});
        await client.query('COMMIT');staged++;
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
    }
    return {staged};
  }
}
