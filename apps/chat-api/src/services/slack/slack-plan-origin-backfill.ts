import type pg from 'pg';
import {isUuid} from '../../db/repositories/uuid.js';
import {hasSlackMarker} from './slack-message-selectors.js';
import {planOriginAllowed, sealPlanOrigin, type PlanOriginTable} from './slack-plan-origin.js';

type Options = {afterId?: string; limit?: number; apply?: boolean; signal?: AbortSignal};

function mentionsSlack(row: any): boolean {
  return hasSlackMarker(row.plan_json) || hasSlackMarker(row.resource_labels) || hasSlackMarker(row.args_json)
    || hasSlackMarker(row.output_json) || hasSlackMarker(row.error_json)
    || JSON.stringify(row.plan_json ?? '').includes('myslack') || String(row.plan_text ?? '').includes('myslack')
    || JSON.stringify(row.args_json ?? '').includes('myslack');
}

/** Bounded maintenance. Default is a dry run. Ambiguous Slack bytes stay unchanged. */
export class SlackPlanOriginBackfill {
  constructor(private readonly pool: pg.Pool) {}
  async page(table: PlanOriginTable, options: Options = {}) {
    const {afterId, limit = 50, apply = false, signal} = options;
    signal?.throwIfAborted();
    if (!['plans', 'execution_steps'].includes(table) || !Number.isInteger(limit) || limit < 1 || limit > 200 || (afterId !== undefined && !isUuid(afterId))) {
      throw new TypeError('INVALID_ORIGIN_BACKFILL_PAGE');
    }
    const ids = (await this.pool.query(`SELECT id FROM ${table} WHERE ($1::uuid IS NULL OR id > $1) ORDER BY id LIMIT $2`, [afterId ?? null, limit])).rows;
    const counts = {scanned: 0, alreadyValid: 0, eligible: 0, quarantined: 0, applied: 0, nextCursor: ids.length === limit ? ids.at(-1).id as string : null};
    for (const {id} of ids) {
      signal?.throwIfAborted();
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL statement_timeout='5s'");
        const row = table === 'plans'
          ? (await client.query('SELECT p.*, v.user_id AS origin_owner FROM plans p JOIN conversations v ON v.id=p.conv_id WHERE p.id=$1', [id])).rows[0]
          : (await client.query(`SELECT s.*, p.conv_id, v.user_id AS origin_owner FROM execution_steps s
              JOIN plans p ON p.id=s.plan_id JOIN conversations v ON v.id=p.conv_id WHERE s.id=$1`, [id])).rows[0];
        counts.scanned++;
        if (!row) { await client.query('ROLLBACK'); continue; }
        if (await planOriginAllowed(client, table, row, row.origin_owner)) counts.alreadyValid++;
        else if (mentionsSlack(row) || row.slack_lineage_manifest != null) counts.quarantined++;
        else {
          counts.eligible++;
          if (apply) {
            await sealPlanOrigin(client, table, id, 'backfill_plain');
            counts.applied++;
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    }
    return counts;
  }
}
