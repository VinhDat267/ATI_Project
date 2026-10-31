import type pg from 'pg';
import {isUuid} from '../../db/repositories/uuid.js';
import {scheduleOriginAllowed} from './slack-schedule-origin.js';

type Options = {afterId?: string; limit?: number; apply?: boolean; signal?: AbortSignal};

/** Bounded maintenance. Default is a dry run. `--apply` still cannot mint a certificate:
 * absence of a Slack copy is not proof, and a certificate that no longer matches is never rewritten. */
export class SlackScheduleOriginBackfill {
  constructor(private readonly pool: pg.Pool) {}
  async page(options: Options = {}) {
    const {afterId, limit = 50, signal} = options;
    signal?.throwIfAborted();
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (afterId !== undefined && !isUuid(afterId))) {
      throw new TypeError('INVALID_ORIGIN_BACKFILL_PAGE');
    }
    const ids = (await this.pool.query('SELECT id FROM schedules WHERE ($1::uuid IS NULL OR id > $1) ORDER BY id LIMIT $2', [afterId ?? null, limit])).rows;
    const counts = {scanned: 0, alreadyValid: 0, eligible: 0, quarantined: 0, applied: 0, nextCursor: ids.length === limit ? ids.at(-1).id as string : null};
    for (const {id} of ids) {
      signal?.throwIfAborted();
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL statement_timeout='5s'");
        const located = (await client.query('SELECT conv_id FROM schedules WHERE id=$1', [id])).rows[0];
        counts.scanned++;
        if (!located) { await client.query('ROLLBACK'); continue; }
        await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [located.conv_id]);
        await client.query('SELECT id FROM schedules WHERE id=$1 FOR UPDATE', [id]);
        const row = (await client.query(`SELECT s.*, v.user_id AS origin_owner FROM schedules s
          JOIN conversations v ON v.id=s.conv_id WHERE s.id=$1 FOR UPDATE OF s`, [id])).rows[0];
        if (!row) { await client.query('ROLLBACK'); continue; }
        if (await scheduleOriginAllowed(client, row, row.origin_owner)) counts.alreadyValid++;
        else counts.quarantined++;
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    }
    return counts;
  }
}
