import type pg from 'pg';
import { isUuid } from './uuid.js';

export type ValidationRetryCode = 'owner_busy' | 'probe_transient' | 'credential_uncertain' | 'aborted' | 'invalid_job';
export type ValidationOutcome = 'valid' | 'invalid' | 'superseded';
export interface ValidationLease {
  id: string; leaseToken: string; workerId: string;
}
export interface ClaimedValidationJob extends ValidationLease {
  receiptId: string;
  intentType: 'token_revocation_validation' | 'app_uninstall_validation';
  /** Private metadata, validated against receipt/barrier ownership by the consumer. */
  payload: unknown;
  attempts: number;
  leaseUntil: Date;
}
const RETRY_CODES: readonly string[] = ['owner_busy','probe_transient','credential_uncertain','aborted','invalid_job'];
function workerName(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new TypeError('Invalid validation worker');
  return value.trim();
}
function clock(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError('Invalid validation clock');
  return value;
}
function lease(input: ValidationLease): void {
  if (!input || !isUuid(input.id) || !isUuid(input.leaseToken) || input.workerId !== workerName(input.workerId)) {
    throw new TypeError('Invalid validation lease');
  }
}
function positive(value: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new TypeError('Invalid validation bound');
}

/** Claims and ownership only; the consumer must verify credential/barrier identity
 * before applying any result. No content, tokens or provider payloads are stored here.
 */
export class SlackLifecycleValidationRepo {
  constructor(private readonly pool: pg.Pool) {}

  async claim(limit: number, workerId: string, leaseSeconds: number, now = new Date()): Promise<ClaimedValidationJob[]> {
    positive(limit,100); positive(leaseSeconds,600); const owner = workerName(workerId); clock(now);
    const result = await this.pool.query(`WITH due AS (
      SELECT id FROM slack_lifecycle_intents
      WHERE status IN ('pending','failed') AND intent_type IN ('token_revocation_validation','app_uninstall_validation')
        AND validation_next_attempt_at<=$1 AND (validation_lease_until IS NULL OR validation_lease_until<=$1)
      ORDER BY validation_next_attempt_at,created_at,id LIMIT $2 FOR UPDATE SKIP LOCKED
    ) UPDATE slack_lifecycle_intents j SET validation_lease_token=gen_random_uuid(),validation_lease_owner=$3,
      validation_lease_until=GREATEST($1::timestamptz,clock_timestamp()) + $4 * interval '1 second',validation_attempts=j.validation_attempts+1
      FROM due WHERE j.id=due.id RETURNING j.*`, [now,limit,owner,leaseSeconds]);
    return result.rows.map(row => ({ id:row.id,receiptId:row.receipt_id,intentType:row.intent_type,payload:row.payload_json,
      leaseToken:row.validation_lease_token,workerId:row.validation_lease_owner,
      attempts:row.validation_attempts,leaseUntil:row.validation_lease_until }));
  }

  async retry(input: ValidationLease, code: ValidationRetryCode, delaySeconds: number, now = new Date()): Promise<boolean> {
    lease(input); positive(delaySeconds,3600); clock(now);
    if (!RETRY_CODES.includes(code)) throw new TypeError('Invalid validation retry code');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='2s'");
      await this.lockLease(client,input);
      const result = await client.query(`UPDATE slack_lifecycle_intents SET status='failed',
      validation_last_error_code=$5,validation_next_attempt_at=$4::timestamptz + $6 * interval '1 second',
      validation_lease_token=NULL,validation_lease_owner=NULL,validation_lease_until=NULL
      WHERE id=$1 AND validation_lease_token=$2 AND validation_lease_owner=$3
      AND validation_lease_until>GREATEST($4::timestamptz,clock_timestamp()) AND status IN ('pending','failed')`,
    [input.id,input.leaseToken,input.workerId,now,code,delaySeconds]);
      await client.query('COMMIT');
      return result.rowCount === 1;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  /** Call only within the same transaction as the consumer's guarded outcome.
   * false means ownership was lost: caller must roll back ALL staged effects.
   */
  async assertOwnedInTransaction(client:pg.PoolClient,input:ValidationLease):Promise<void> {
    lease(input);
    await client.query('SAVEPOINT slack_rotation_tx_guard');
    await client.query('RELEASE SAVEPOINT slack_rotation_tx_guard');
    await this.lockLease(client,input);
    const owned=await client.query(`SELECT id FROM slack_lifecycle_intents WHERE id=$1 AND validation_lease_token=$2
      AND validation_lease_owner=$3 AND validation_lease_until>clock_timestamp() AND status IN ('pending','failed')`,
      [input.id,input.leaseToken,input.workerId]);
    if(owned.rowCount!==1) throw new Error('SLACK_VALIDATION_LEASE_LOST');
  }

  async completeInTransaction(client: pg.PoolClient, input: ValidationLease, outcome: ValidationOutcome, now = new Date()): Promise<boolean> {
    lease(input); clock(now);
    if (!['valid','invalid','superseded'].includes(outcome)) throw new TypeError('Invalid validation outcome');
    await client.query('SAVEPOINT slack_validation_tx_guard');
    await client.query('RELEASE SAVEPOINT slack_validation_tx_guard');
    await this.lockLease(client,input);
    const result = await client.query(`UPDATE slack_lifecycle_intents SET status='applied',applied_at=$4,
      validation_outcome=$5,validation_last_error_code=NULL,
      validation_lease_token=NULL,validation_lease_owner=NULL,validation_lease_until=NULL
      WHERE id=$1 AND validation_lease_token=$2 AND validation_lease_owner=$3
      AND validation_lease_until>GREATEST($4::timestamptz,clock_timestamp()) AND status IN ('pending','failed')`,
    [input.id,input.leaseToken,input.workerId,now,outcome]);
    return result.rowCount === 1;
  }

  private async lockLease(client: pg.PoolClient, input: ValidationLease): Promise<void> {
    // A volatile clock predicate in UPDATE's initial scan can be evaluated before
    // waiting on a row lock. Acquire the row first, THEN test expiry in a new statement.
    await client.query(`SELECT id FROM slack_lifecycle_intents WHERE id=$1
      AND validation_lease_token=$2 AND validation_lease_owner=$3 FOR UPDATE`,
    [input.id,input.leaseToken,input.workerId]);
  }
}
