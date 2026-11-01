import { createHash } from 'node:crypto';
import type pg from 'pg';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { SLACK_DERIVED_TARGET_KINDS, validateSlackBinding, type SlackBinding } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';
import { slackEventLockKey, slackEventSourceKey } from '../../db/repositories/slack-event-receipt-repo.js';
import { SlackLifecycleValidationRepo, type ClaimedValidationJob, type ValidationOutcome, type ValidationRetryCode } from '../../db/repositories/slack-lifecycle-validation-repo.js';
import { acquireSlackInvalidationLocks, slackInvalidationLockKeys, type SlackInvalidationService } from './slack-invalidation-service.js';
import { SlackProviderError, type SlackOAuthClient } from './oauth-client.js';

interface Options {
  pool: pg.Pool;
  jobs: SlackLifecycleValidationRepo;
  oauth: Pick<SlackOAuthClient,'verify'>;
  rotation?: {appId:string;client:Pick<SlackOAuthClient,'refresh'>};
  invalidation: Pick<SlackInvalidationService,'stageInTransaction'>;
  encryptionKey: string;
  workerId: string;
  probeTimeoutMs?: number;
}
interface Payload { binding: SlackBinding; credentialFingerprint: string; barrierId: string; intentType: string }
type Result = { outcome: ValidationOutcome } | { retry: ValidationRetryCode };
const hash = (value:string) => createHash('sha256').update(value).digest('hex');
class InvalidJob extends Error {}
function payload(value:unknown): Payload {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new InvalidJob();
  const p=value as Record<string,unknown>;
  if (Object.keys(p).some(k=>!['intentType','binding','credentialFingerprint','barrierId','sourceEventTime'].includes(k)) ||
      !['token_revocation_validation','app_uninstall_validation'].includes(String(p.intentType)) ||
      typeof p.credentialFingerprint!=='string' || !/^[0-9a-f]{64}$/.test(p.credentialFingerprint) ||
      typeof p.barrierId!=='string' || !isUuid(p.barrierId) || typeof p.sourceEventTime!=='string' || !Number.isFinite(Date.parse(p.sourceEventTime))) throw new InvalidJob();
  return { binding:validateSlackBinding(p.binding),credentialFingerprint:p.credentialFingerprint,barrierId:p.barrierId,intentType:String(p.intentType) };
}
function sameBinding(row:any,b:SlackBinding):boolean {
  return row && row.user_id===b.atiUserId && row.connection_id===b.connectionId && row.workspace_id===b.workspaceId &&
    row.slack_user_id===b.slackUserId && row.identity_version===b.identityVersion;
}

/** Private metadata-only consumer. Confirmed rotations are fenced and encrypted;
 * uncertain single-use exchanges keep the gate closed. No revoke/content processing. */
export class SlackLifecycleValidationWorker {
  private readonly timeout:number;
  constructor(private readonly options:Options) {
    this.timeout=options.probeTimeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.timeout) || this.timeout<1 || this.timeout>10_000 ||
        !options.workerId.trim() || !options.encryptionKey) throw new TypeError('Invalid lifecycle worker config');
  }
  async runOnce(limit=5,signal?:AbortSignal):Promise<{claimed:number;applied:number;retried:number}> {
    const stats={claimed:0,applied:0,retried:0};
    if (signal?.aborted) return stats;
    const jobs=await this.options.jobs.claim(limit,this.options.workerId,60); stats.claimed=jobs.length;
    for (const job of jobs) {
      if (signal?.aborted) break;
      const result=await this.process(job,signal);
      if ('outcome' in result) stats.applied++;
      else if (await this.options.jobs.retry(job,result.retry,30)) stats.retried++;
    }
    return stats;
  }

  private async owned(client:pg.PoolClient,job:ClaimedValidationJob,p:Payload,lock=false):Promise<string> {
    const current=(await client.query(`SELECT j.intent_type,r.slack_app_id,r.event_id,r.team_id
      FROM slack_lifecycle_intents j JOIN slack_event_receipts r ON r.id=j.receipt_id
      WHERE j.id=$1 AND j.receipt_id=$2 AND j.validation_lease_token=$3 AND j.validation_lease_owner=$4
      AND j.validation_lease_until>clock_timestamp() AND j.status IN ('pending','failed')
      ${lock?'FOR UPDATE OF j':''}`, [job.id,job.receiptId,job.leaseToken,job.workerId])).rows[0];
    if (!current || current.intent_type!==p.intentType || current.team_id!==p.binding.workspaceId) throw new InvalidJob();
    const barrier=(await client.query(`SELECT * FROM slack_invalidation_barriers WHERE id=$1 ${lock?'FOR UPDATE':''}`,[p.barrierId])).rows[0];
    const source=slackEventSourceKey(current.slack_app_id,current.event_id);
    if (!sameBinding(barrier,p.binding) || barrier.barrier_type!=='provisional_auth' || !barrier.provisional || !barrier.active ||
        barrier.credential_fingerprint!==p.credentialFingerprint || barrier.source_event_key!==source ||
        barrier.provisional_source_event_key!==source || barrier.provisional_action!==p.intentType) throw new InvalidJob();
    return current.slack_app_id;
  }

  private async rotationTransaction(client:pg.PoolClient,job:ClaimedValidationJob,p:Payload,config:string,appId:string,
    inFlight:boolean,signal:AbortSignal|undefined,work:()=>Promise<void>):Promise<void> {
    await client.query('BEGIN');
    try {
      await client.query("SET LOCAL statement_timeout='2s'");
      await acquireSlackInvalidationLocks(client,slackInvalidationLockKeys({barrierType:'binding',binding:p.binding,reason:'credential_rotation'}));
      const user=(await client.query('SELECT status FROM users WHERE id=$1 FOR SHARE',[p.binding.atiUserId])).rows[0];
      const row=(await client.query('SELECT * FROM slack_connections WHERE id=$1 FOR UPDATE',[p.binding.connectionId])).rows[0];
      await this.owned(client,job,p,true);
      // The locking query may have waited past lease expiry. Re-read the SQL clock
      // only after all row locks, before checkpoint/token/fingerprint publication.
      await this.owned(client,job,p);
      if(signal?.aborted || user?.status!=='active' || !row || row.user_id!==p.binding.atiUserId || row.app_id!==appId ||
         row.workspace_id!==p.binding.workspaceId || row.actor_id!==p.binding.slackUserId || row.identity_version!==p.binding.identityVersion ||
         row.status==='disconnected' || row.config!==config || row.refresh_in_flight!==inFlight) throw new InvalidJob();
      await work();
      // Guard a lease expiring during the metadata update/row waits as well.
      await this.options.jobs.assertOwnedInTransaction(client,job);
      if(signal?.aborted) throw new InvalidJob();
      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK');throw error;}
  }

  private async process(job:ClaimedValidationJob,signal?:AbortSignal):Promise<Result> {
    let p:Payload;
    try {
      // A confirmed rotation may have advanced a sibling already in this claim batch.
      const fresh=(await this.options.pool.query(`SELECT payload_json FROM slack_lifecycle_intents WHERE id=$1 AND receipt_id=$2
        AND validation_lease_token=$3 AND validation_lease_owner=$4 AND status IN ('pending','failed')`,
        [job.id,job.receiptId,job.leaseToken,job.workerId])).rows[0];
      p=payload(fresh?.payload_json); if (p.intentType!==job.intentType) throw new InvalidJob();
    }
    catch { return {retry:'invalid_job'}; }
    const client=await this.options.pool.connect();
    let held=false,transaction=false;
    try {
      if (signal?.aborted) return {retry:'aborted'};
      held=(await client.query("SELECT pg_try_advisory_lock(hashtext('ati-slack-owner'),hashtext($1)) AS locked",[p.binding.atiUserId])).rows[0]?.locked===true;
      if (!held) return {retry:'owner_busy'};
      const appId=await this.owned(client,job,p);
      const row=(await client.query('SELECT * FROM slack_connections WHERE id=$1 AND user_id=$2',[p.binding.connectionId,p.binding.atiUserId])).rows[0];
      const stale=!row || row.app_id!==appId || row.identity_version!==p.binding.identityVersion || row.workspace_id!==p.binding.workspaceId ||
        row.actor_id!==p.binding.slackUserId || row.status==='disconnected' || (row.config && hash(row.config)!==p.credentialFingerprint);
      let outcome:ValidationOutcome='superseded';
      if (!stale) {
        if (!row.config || row.refresh_in_flight) return {retry:'credential_uncertain'};
        let config:any;
        try { config=decryptCredentials(row.config,this.options.encryptionKey); } catch { return {retry:'credential_uncertain'}; }
        if (typeof config.accessToken!=='string' || !config.accessToken || /[\r\n]/.test(config.accessToken) ||
            (config.expiresAt!==undefined && (typeof config.expiresAt!=='number' || !Number.isFinite(config.expiresAt)))) return {retry:'credential_uncertain'};
        const verify=async()=>{
          const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(this.timeout)]):AbortSignal.timeout(this.timeout);
          await this.options.oauth.verify(config.accessToken,p.binding.workspaceId,p.binding.slackUserId,combined);
          if(combined.aborted) throw new SlackProviderError(false);
        };
        let needsRefresh=config.expiresAt!==undefined && config.expiresAt<=Date.now();
        if(!needsRefresh) {
          try {await verify();outcome='valid';}
          catch(error) {
            if(signal?.aborted) return {retry:'aborted'};
            if(!(error instanceof SlackProviderError) || !error.authenticationLost) return {retry:'probe_transient'};
            if(config.refreshToken && error.authCode==='identity_mismatch') return {retry:'credential_uncertain'};
            if(config.refreshToken) needsRefresh=true;
            else if(error.authCode==='token_expired' || error.authCode==='unknown') return {retry:'credential_uncertain'};
            else if(['invalid_auth','token_revoked','account_inactive','identity_mismatch'].includes(error.authCode)) outcome='invalid';
            else return {retry:'probe_transient'};
          }
        }
        if(needsRefresh) {
          if(!this.options.rotation || this.options.rotation.appId!==appId || typeof config.refreshToken!=='string' || !config.refreshToken || /[\r\n]/.test(config.refreshToken)) return {retry:'credential_uncertain'};
          await this.rotationTransaction(client,job,p,row.config,appId,false,signal,async()=>{
            await client.query('UPDATE slack_connections SET refresh_in_flight=true WHERE id=$1',[p.binding.connectionId]);
          });
          if(signal?.aborted) return {retry:'aborted'};
          let tokens:Awaited<ReturnType<SlackOAuthClient['refresh']>>;
          try {
            const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(this.timeout)]):AbortSignal.timeout(this.timeout);
            tokens=await this.options.rotation.client.refresh(config.refreshToken,combined);
            if(combined.aborted) return {retry:signal?.aborted?'aborted':'credential_uncertain'};
          } catch {return {retry:signal?.aborted?'aborted':'credential_uncertain'};}
          const fresh={accessToken:tokens.accessToken,refreshToken:tokens.refreshToken,expiresAt:Date.now()+tokens.expiresIn*1000};
          const sealed=encryptCredentials(fresh,this.options.encryptionKey),nextFingerprint=hash(sealed),oldFingerprint=p.credentialFingerprint;
          await this.rotationTransaction(client,job,p,row.config,appId,true,signal,async()=>{
            // Only correlate exact private pending jobs whose own signed receipt/barrier
            // still agrees. This changes no active bit and releases no source authority.
            await client.query(`WITH eligible AS (
              SELECT j.id,b.id AS barrier_id FROM slack_lifecycle_intents j
              JOIN slack_event_receipts r ON r.id=j.receipt_id
              JOIN slack_invalidation_barriers b ON b.id::text=j.payload_json->>'barrierId'
              WHERE j.status IN ('pending','failed') AND j.payload_json->'binding'=$1::jsonb
                AND j.payload_json->>'credentialFingerprint'=$2 AND r.slack_app_id=$3 AND r.team_id=$4
                AND b.user_id=$5 AND b.connection_id=$6 AND b.workspace_id=$4 AND b.slack_user_id=$7 AND b.identity_version=$8
                AND b.active AND b.provisional AND b.barrier_type='provisional_auth' AND b.credential_fingerprint=$2
                AND b.provisional_action=j.intent_type AND b.source_event_key=b.provisional_source_event_key
                AND b.source_event_key=('slack:' || r.slack_app_id || ':' || r.event_id)
            ), changed AS (
              UPDATE slack_invalidation_barriers SET credential_fingerprint=$9 WHERE id IN (SELECT barrier_id FROM eligible) RETURNING id
            ) UPDATE slack_lifecycle_intents SET payload_json=jsonb_set(payload_json,'{credentialFingerprint}',to_jsonb($9::text))
              WHERE id IN (SELECT e.id FROM eligible e JOIN changed c ON e.barrier_id=c.id)`,
              [JSON.stringify(p.binding),oldFingerprint,appId,p.binding.workspaceId,p.binding.atiUserId,p.binding.connectionId,p.binding.slackUserId,p.binding.identityVersion,nextFingerprint]);
            await client.query('UPDATE slack_connections SET config=$2,refresh_in_flight=false WHERE id=$1',[p.binding.connectionId,sealed]);
          });
          p.credentialFingerprint=nextFingerprint;row.config=sealed;row.refresh_in_flight=false;config=fresh;
          // Fresh credential still needs its own well-formed principal verification.
          // A failed probe cannot cause another exchange in this attempt or purge a grant.
          try {await verify();outcome='valid';}
          catch(error) {return {retry:signal?.aborted?'aborted':error instanceof SlackProviderError && error.authenticationLost?'credential_uncertain':'probe_transient'};}
        }
      }
      if (signal?.aborted) return {retry:'aborted'};
      const resolutionKey=`slack-validation:${job.id}`;
      await client.query('BEGIN'); transaction=true;
      await client.query("SET LOCAL statement_timeout='2s'");
      await acquireSlackInvalidationLocks(client,[slackEventLockKey(resolutionKey),...slackInvalidationLockKeys({
        barrierType:'binding',binding:p.binding,reason:'validation_resolution',
      })]);
      const user=(await client.query('SELECT status FROM users WHERE id=$1 FOR SHARE',[p.binding.atiUserId])).rows[0];
      const current=(await client.query('SELECT * FROM slack_connections WHERE id=$1 AND user_id=$2 FOR UPDATE',[p.binding.connectionId,p.binding.atiUserId])).rows[0];
      await this.owned(client,job,p,true);
      if (outcome!=='superseded' && (!current || current.app_id!==appId || current.identity_version!==p.binding.identityVersion || current.workspace_id!==p.binding.workspaceId ||
          current.actor_id!==p.binding.slackUserId || current.status==='disconnected' || current.config!==row.config || current.refresh_in_flight)) outcome='superseded';
      if (outcome==='valid') {
        await client.query('UPDATE slack_invalidation_barriers SET active=false WHERE id=$1',[p.barrierId]);
        const other=(await client.query(`SELECT EXISTS(SELECT 1 FROM slack_invalidation_barriers WHERE active=true
          AND barrier_type IN ('binding','provisional_auth') AND user_id=$1 AND connection_id=$2 AND workspace_id=$3
          AND slack_user_id=$4 AND identity_version=$5) AS blocked`,
        [p.binding.atiUserId,p.binding.connectionId,p.binding.workspaceId,p.binding.slackUserId,p.binding.identityVersion])).rows[0].blocked;
        if (!other && user?.status==='active') await client.query("UPDATE slack_connections SET status='active' WHERE id=$1 AND status='reconnect_required'",[p.binding.connectionId]);
      } else if (outcome==='invalid') {
        await this.options.invalidation.stageInTransaction(client,{sourceEventKey:resolutionKey,effects:[{
          effectKey:'confirmed_invalid',barrier:{barrierType:'binding',binding:p.binding,reason:'confirmed_credential_invalid'},
          purgeTarget:{scope:'authorization_disconnect',binding:p.binding,cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS],tombstoneReason:'connection_disconnected'},
        }]});
        const changed=await client.query(`UPDATE slack_connections SET status='disconnected',config=NULL,
          identity_version=identity_version+1,refresh_in_flight=false WHERE id=$1 AND user_id=$2 AND identity_version=$3 AND config=$4`,
        [p.binding.connectionId,p.binding.atiUserId,p.binding.identityVersion,row.config]);
        if (changed.rowCount!==1) throw new InvalidJob();
        await client.query('UPDATE slack_invalidation_barriers SET active=false WHERE id=$1',[p.barrierId]);
      }
      if (signal?.aborted) throw new Error('aborted');
      if (!await this.options.jobs.completeInTransaction(client,job,outcome)) throw new InvalidJob();
      if (signal?.aborted) throw new Error('aborted');
      await client.query('COMMIT'); transaction=false;
      return {outcome};
    } catch (error) {
      if (transaction) await client.query('ROLLBACK').catch(()=>{});
      return {retry:signal?.aborted?'aborted':error instanceof InvalidJob?'invalid_job':'probe_transient'};
    } finally {
      try { if (held) await client.query("SELECT pg_advisory_unlock(hashtext('ati-slack-owner'),hashtext($1))",[p.binding.atiUserId]); }
      finally { client.release(); }
    }
  }
}
