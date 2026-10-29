import type pg from 'pg';
import { createHash } from 'node:crypto';
import type { SlackInvalidationService } from '../../services/slack/slack-invalidation-service.js';
import type { SlackBinding, SlackPurgeTarget } from '@wap/tool-schemas';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export interface SlackConnectionRow {
  id: string; user_id: string; app_id: string; workspace_id: string; workspace_name: string; actor_id: string;
  identity_version: number; status: 'active' | 'reconnect_required' | 'disconnected'; config: string | null;
  scopes: string[]; refresh_in_flight: boolean; connected_at: Date;
  last_state_order?: string | number;
}
interface SaveInput { appId: string; workspaceId: string; workspaceName: string; actorId: string; config: string; scopes: string[] }
/** Owner lock survives committed refresh checkpoints, also across Node processes. */
export class SlackConnectionRepo {
  constructor(private pool: pg.Pool, private invalidationService?: SlackInvalidationService) {}
  async withOwner<T>(userId: string, action: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('ati-slack-owner'),hashtext($1))", [userId]);
      return await action(client);
    } finally {
      try { await client.query("SELECT pg_advisory_unlock(hashtext('ati-slack-owner'),hashtext($1))", [userId]); }
      finally { client.release(); }
    }
  }
  async start(input: { userId: string; sessionId: string; stateHash: string; browserHash: string; returnTo?: string | null }, now = Date.now()): Promise<void> {
    await this.withOwner(input.userId, async c => {
      await c.query('DELETE FROM slack_oauth_states WHERE expires_at<=$1', [new Date(now)]);
      await c.query(`INSERT INTO slack_oauth_states(user_id,session_id,state_hash,browser_hash,expires_at,return_to) VALUES($1,$2,$3,$4,$5,$6)`,
        [input.userId, input.sessionId, input.stateHash, input.browserHash, new Date(now + 600000), input.returnTo ?? null]);
    });
  }
  async consume(input: { userId: string; sessionId: string; state: string; browser: string }, now = Date.now()): Promise<{ id: string; returnTo?: string } | null> {
    const res = await this.pool.query(`UPDATE slack_oauth_states o SET used_at=$5 WHERE state_hash=$1 AND browser_hash=$2
      AND o.user_id=$3 AND o.session_id=$4 AND o.used_at IS NULL AND o.expires_at>$5 AND EXISTS
      (SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=o.session_id AND s.user_id=o.user_id
       AND s.revoked_at IS NULL AND s.expires_at>$5 AND u.status='active') RETURNING o.id, o.return_to`,
      [hash(input.state), hash(input.browser), input.userId, input.sessionId, new Date(now)]);
    const row = res.rows[0];
    if (!row) return null;
    return { id: row.id, ...(row.return_to ? { returnTo: row.return_to } : {}) };
  }
  async list(userId: string): Promise<SlackConnectionRow[]> {
    return (await this.pool.query<SlackConnectionRow>("SELECT * FROM slack_connections WHERE user_id=$1 AND status<>'disconnected' ORDER BY connected_at,id", [userId])).rows;
  }
  async get(client: pg.PoolClient, userId: string, id: string): Promise<SlackConnectionRow | null> {
    return (await client.query<SlackConnectionRow>('SELECT * FROM slack_connections WHERE id=$1 AND user_id=$2', [id, userId])).rows[0] ?? null;
  }
  async save(userId: string, stateId: string, input: SaveInput, clock = Date.now): Promise<SlackConnectionRow | null> {
    return this.withOwner(userId, async c => {
      await c.query('BEGIN');
      try {
        await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
        const state = (await c.query<{ expires_at: Date; state_expires: Date; status: string; order_seq: string }>(`SELECT s.expires_at,o.expires_at AS state_expires,o.order_seq,u.status FROM slack_oauth_states o
          JOIN auth_sessions s ON s.id=o.session_id AND s.user_id=o.user_id JOIN users u ON u.id=o.user_id
          WHERE o.id=$1 AND o.user_id=$2 AND o.used_at IS NOT NULL AND s.revoked_at IS NULL FOR UPDATE OF s`, [stateId, userId])).rows[0];
        const now = clock();
        if (!state || state.status !== 'active' || state.expires_at.getTime() <= now || state.state_expires.getTime() <= now) { await c.query('ROLLBACK'); return null; }
        const result = await c.query<SlackConnectionRow>(`INSERT INTO slack_connections(user_id,app_id,workspace_id,workspace_name,actor_id,config,scopes,connected_at,last_state_order)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,app_id,workspace_id) DO UPDATE SET
          workspace_name=excluded.workspace_name,actor_id=excluded.actor_id,config=excluded.config,scopes=excluded.scopes,
          status='active',identity_version=slack_connections.identity_version+1,refresh_in_flight=false,connected_at=excluded.connected_at,
          last_state_order=excluded.last_state_order
          WHERE excluded.last_state_order > slack_connections.last_state_order RETURNING *`,
          [userId, input.appId, input.workspaceId, input.workspaceName, input.actorId, input.config, input.scopes, new Date(now), state.order_seq]);
        if (!result.rows[0]) { await c.query('ROLLBACK'); return null; }
        await c.query('DELETE FROM slack_oauth_states WHERE id=$1 AND user_id=$2', [stateId, userId]);
        await c.query('COMMIT'); return result.rows[0]!;
      } catch (e) { await c.query('ROLLBACK'); if ((e as any).code === '23505') throw new Error('SLACK_IDENTITY_CONFLICT'); throw e; }
    });
  }
  /** Even an already absent connection invalidates callbacks. Provider revoke is under the same owner lock. */
  async disconnect(userId: string, id: string, revoke?: (row: SlackConnectionRow) => Promise<void>): Promise<void> {
    await this.withOwner(userId, async c => {
      const row = await this.get(c, userId, id);
      await c.query('BEGIN');
      try {
        await c.query('DELETE FROM slack_oauth_states WHERE user_id=$1', [userId]);
        await c.query("UPDATE slack_connections SET status='disconnected',config=NULL,identity_version=identity_version+1,refresh_in_flight=false WHERE id=$1 AND user_id=$2 AND status<>'disconnected'", [id, userId]);
        if (row && row.status !== 'disconnected' && this.invalidationService) {
          const oldBinding: SlackBinding = {
            atiUserId: row.user_id,
            connectionId: row.id,
            workspaceId: row.workspace_id,
            slackUserId: row.actor_id,
            identityVersion: row.identity_version,
          };
          const purgeTarget: SlackPurgeTarget = {
            scope: 'authorization_disconnect',
            binding: oldBinding,
            cascadeTargetKinds: [
              'chat_history_message',
              'working_memory_entity',
              'plan_step_arg',
              'proposal_excerpt',
              'daily_digest_entry',
              'scheduled_workflow_arg',
              'audit_log_entry',
            ],
            tombstoneReason: 'connection_disconnected',
          };
          await this.invalidationService.stageInTransaction(c, {
            sourceEventKey: `disconnect:${row.id}:${row.identity_version}`,
            effects: [
              {
                effectKey: 'authorization_disconnect',
                barrier: {
                  barrierType: 'binding',
                  binding: oldBinding,
                  reason: 'connection_disconnected',
                },
                purgeTarget,
              },
            ],
          });
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
      if (row?.status !== 'disconnected' && row?.config && revoke) await revoke(row);
    });
  }
}
