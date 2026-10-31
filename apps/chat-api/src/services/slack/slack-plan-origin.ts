import type pg from 'pg';
import {messageFingerprint} from './slack-message-selectors.js';

export type PlanOriginTable = 'plans' | 'execution_steps';
type Producer = 'plan_writer' | 'step_writer' | 'step_status' | 'backfill_plain' | 'physical_purge';
const cutover = 'plan-origin-v1';

export function planOriginFingerprint(table: PlanOriginTable, row: any, owner: string): string {
  const body = table === 'plans'
    ? {plan_json: row.plan_json, plan_text: row.plan_text, plan_hash: row.plan_hash, resource_labels: row.resource_labels ?? {}}
    : {step_id: row.step_id, tool: row.tool, args_json: row.args_json, output_json: row.output_json, error_json: row.error_json};
  return messageFingerprint({
    protocol: cutover, table, id: row.id, owner,
    convId: row.conv_id, planId: table === 'plans' ? row.id : row.plan_id, body,
  }, 'origin');
}

async function lockedRow(client: pg.PoolClient, table: PlanOriginTable, id: string): Promise<any> {
  const located = table === 'plans'
    ? (await client.query('SELECT conv_id, id AS plan_id FROM plans WHERE id=$1', [id])).rows[0]
    : (await client.query('SELECT p.conv_id, s.plan_id FROM execution_steps s JOIN plans p ON p.id=s.plan_id WHERE s.id=$1', [id])).rows[0];
  if (!located) throw new Error('SLACK_ORIGIN_UNAVAILABLE');
  await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [located.conv_id]);
  await client.query('SELECT id FROM plans WHERE id=$1 FOR UPDATE', [located.plan_id]);
  const row = table === 'plans'
    ? (await client.query(`SELECT p.*, v.user_id AS origin_owner FROM plans p JOIN conversations v ON v.id=p.conv_id WHERE p.id=$1 FOR UPDATE OF p`, [id])).rows[0]
    : (await client.query(`SELECT s.*, p.conv_id, v.user_id AS origin_owner FROM execution_steps s
        JOIN plans p ON p.id=s.plan_id JOIN conversations v ON v.id=p.conv_id WHERE s.id=$1 FOR UPDATE OF s`, [id])).rows[0];
  if (!row) throw new Error('SLACK_ORIGIN_UNAVAILABLE');
  return row;
}

export async function planOriginAllowed(client: pg.PoolClient, table: PlanOriginTable, row: any, owner: string): Promise<boolean> {
  const current = table === 'execution_steps' && row.conv_id === undefined
    ? (await client.query('SELECT s.*, p.conv_id FROM execution_steps s JOIN plans p ON p.id=s.plan_id WHERE s.id=$1', [row.id])).rows[0]
    : row;
  if (!current) return false;
  const proof = (await client.query(`SELECT o.* FROM slack_plan_origins o
    JOIN slack_plan_origin_cutovers c ON c.id=o.cutover_id
    WHERE o.artifact_table=$1 AND o.artifact_id=$2 AND c.id=$3 AND c.enabled FOR SHARE OF o, c`,
  [table, current.id, cutover])).rows[0];
  if (!proof || proof.ati_user_id !== owner) return false;
  try { return planOriginFingerprint(table, current, owner) === proof.remainder_fingerprint; }
  catch { return false; }
}

/** Caller may already hold the conversation lock. This repeats that lock, then the plan, then the artifact. */
export async function sealPlanOrigin(client: pg.PoolClient, table: PlanOriginTable, id: string, producer: Producer): Promise<void> {
  await client.query('SAVEPOINT plan_origin_tx_guard');
  await client.query('RELEASE SAVEPOINT plan_origin_tx_guard');
  const marker = (await client.query('SELECT id FROM slack_plan_origin_cutovers WHERE id=$1 AND enabled FOR SHARE', [cutover])).rows[0];
  if (!marker) throw new Error('SLACK_ORIGIN_CUTOVER_REQUIRED');
  const row = await lockedRow(client, table, id);
  const fingerprint = planOriginFingerprint(table, row, row.origin_owner);
  await client.query(`INSERT INTO slack_plan_origins(artifact_table, artifact_id, ati_user_id, conv_id, plan_id, cutover_id, producer, remainder_fingerprint)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (artifact_table, artifact_id) DO UPDATE SET ati_user_id=excluded.ati_user_id, conv_id=excluded.conv_id,
      plan_id=excluded.plan_id, cutover_id=excluded.cutover_id, producer=excluded.producer,
      remainder_fingerprint=excluded.remainder_fingerprint, recorded_at=clock_timestamp()`,
  [table, id, row.origin_owner, row.conv_id, table === 'plans' ? row.id : row.plan_id, cutover, producer, fingerprint]);
}
