import { createHash } from 'node:crypto';
import type pg from 'pg';
import { decryptCredentials } from '@wap/tool-adapters';
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

/** Private metadata-only consumer. Unknown/rotating refresh outcomes keep the gate
 * closed; this worker never calls refresh/revoke or processes Slack content.
 */
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

  private async owned(client:pg.PoolClient,job:ClaimedValidationJob,p:Payload,lock=false):Promise<void> {
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
  }

  private async process(job:ClaimedValidationJob,signal?:AbortSignal):Promise<Result> {
    let p:Payload;
    try { p=payload(job.payload); if (p.intentType!==job.intentType) throw new InvalidJob(); }
    catch { return {retry:'invalid_job'}; }
    const client=await this.options.pool.connect();
    let held=false,transaction=false;
    try {
      if (signal?.aborted) return {retry:'aborted'};
      held=(await client.query("SELECT pg_try_advisory_lock(hashtext('ati-slack-owner'),hashtext($1)) AS locked",[p.binding.atiUserId])).rows[0]?.locked===true;
      if (!held) return {retry:'owner_busy'};
      await this.owned(client,job,p);
      const row=(await client.query('SELECT * FROM slack_connections WHERE id=$1 AND user_id=$2',[p.binding.connectionId,p.binding.atiUserId])).rows[0];
      const stale=!row || row.identity_version!==p.binding.identityVersion || row.workspace_id!==p.binding.workspaceId ||
        row.actor_id!==p.binding.slackUserId || row.status==='disconnected' || (row.config && hash(row.config)!==p.credentialFingerprint);
      let outcome:ValidationOutcome='superseded';
      if (!stale) {
        if (!row.config || row.refresh_in_flight) return {retry:'credential_uncertain'};
        let config:any;
        try { config=decryptCredentials(row.config,this.options.encryptionKey); } catch { return {retry:'credential_uncertain'}; }
        if (typeof config.accessToken!=='string' || !config.accessToken || /[\r\n]/.test(config.accessToken) ||
            (config.expiresAt!==undefined && (typeof config.expiresAt!=='number' || !Number.isFinite(config.expiresAt) || config.expiresAt<=Date.now()))) return {retry:'credential_uncertain'};
        const timeout=AbortSignal.timeout(this.timeout);
        const combined=signal?AbortSignal.any([signal,timeout]):timeout;
        try {
          await this.options.oauth.verify(config.accessToken,p.binding.workspaceId,p.binding.slackUserId,combined);
          if (combined.aborted) return {retry:signal?.aborted?'aborted':'probe_transient'};
          outcome='valid';
        } catch (error) {
          if (signal?.aborted) return {retry:'aborted'};
          if (!(error instanceof SlackProviderError) || !error.authenticationLost) return {retry:'probe_transient'};
          if (config.refreshToken || error.authCode==='token_expired' || error.authCode==='unknown') return {retry:'credential_uncertain'};
          if (!['invalid_auth','token_revoked','account_inactive','identity_mismatch'].includes(error.authCode)) return {retry:'probe_transient'};
          outcome='invalid';
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
      if (outcome!=='superseded' && (!current || current.identity_version!==p.binding.identityVersion || current.workspace_id!==p.binding.workspaceId ||
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
