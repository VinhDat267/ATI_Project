import type pg from 'pg';
import {messageFingerprint} from './slack-message-selectors.js';

type Producer = 'schedule_writer' | 'backfill_plain' | 'physical_purge';
const cutover = 'schedule-origin-v1';

/** Scheduler columns stay out: tick rewrites status, next_run_at, version and last_proposal_id. */
export function scheduleOriginFingerprint(row: any, owner: string): string {
  return messageFingerprint({
    protocol: cutover, id: row.id, owner, convId: row.conv_id,
    body: {
      name: row.name, request: row.request, recurrence: row.recurrence ?? {},
      services: [...(row.services ?? [])].map(String).sort(),
      userId: row.user_id,
    },
  }, 'origin');
}

export async function scheduleOriginAllowed(client: pg.PoolClient, row: any, owner: string): Promise<boolean> {
  if (!row?.id || row.user_id !== owner) return false;
  const proof = (await client.query(`SELECT o.* FROM slack_schedule_origins o
    JOIN slack_schedule_origin_cutovers c ON c.id=o.cutover_id
    WHERE o.schedule_id=$1 AND c.id=$2 AND c.enabled FOR SHARE OF o, c`,
  [row.id, cutover])).rows[0];
  if (!proof || proof.ati_user_id !== owner) return false;
  try { return scheduleOriginFingerprint(row, owner) === proof.remainder_fingerprint; }
  catch { return false; }
}

/** Caller already holds source keys, then the conversation, then the schedule. */
export async function sealScheduleOrigin(client: pg.PoolClient, id: string, producer: Producer): Promise<void> {
  await client.query('SAVEPOINT schedule_origin_tx_guard');
  await client.query('RELEASE SAVEPOINT schedule_origin_tx_guard');
  const marker = (await client.query('SELECT id FROM slack_schedule_origin_cutovers WHERE id=$1 AND enabled FOR SHARE', [cutover])).rows[0];
  if (!marker) throw new Error('SLACK_ORIGIN_CUTOVER_REQUIRED');
  const located = (await client.query('SELECT conv_id FROM schedules WHERE id=$1', [id])).rows[0];
  if (!located) throw new Error('SLACK_ORIGIN_UNAVAILABLE');
  await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [located.conv_id]);
  await client.query('SELECT id FROM schedules WHERE id=$1 FOR UPDATE', [id]);
  const row = (await client.query(`SELECT s.*, v.user_id AS origin_owner FROM schedules s
    JOIN conversations v ON v.id=s.conv_id WHERE s.id=$1 FOR UPDATE OF s`, [id])).rows[0];
  if (!row) throw new Error('SLACK_ORIGIN_UNAVAILABLE');
  const fingerprint = scheduleOriginFingerprint(row, row.origin_owner);
  await client.query(`INSERT INTO slack_schedule_origins(schedule_id, ati_user_id, conv_id, cutover_id, producer, remainder_fingerprint)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (schedule_id) DO UPDATE SET ati_user_id=excluded.ati_user_id, conv_id=excluded.conv_id,
      cutover_id=excluded.cutover_id, producer=excluded.producer,
      remainder_fingerprint=excluded.remainder_fingerprint, recorded_at=clock_timestamp()`,
  [id, row.origin_owner, row.conv_id, cutover, producer, fingerprint]);
}

/** Test and browser seeds certify a row the real writer did not insert. */
export async function certifyScheduleFixture(db: pg.Pool, scheduleId: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await sealScheduleOrigin(client, scheduleId, 'schedule_writer');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
