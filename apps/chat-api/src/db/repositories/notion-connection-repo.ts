import type pg from 'pg';
import { createHash } from 'node:crypto';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export interface NotionConnectionRow {
  id: string; user_id: string; app_id: string; workspace_id: string; workspace_name: string; actor_id: string;
  identity_version: number; status: 'active' | 'reconnect_required' | 'disconnected'; config: string | null;
  scopes: string[]; allowed_databases: string[]; refresh_in_flight: boolean; connected_at: Date;
}
interface SaveInput { appId: string; workspaceId: string; workspaceName: string; actorId: string; config: string; scopes: string[] }
/** Owner lock survives committed refresh checkpoints, also across Node processes. */
export class NotionConnectionRepo {
  constructor(private pool: pg.Pool) {}
  async withOwner<T>(userId: string, action: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('ati-notion-owner'),hashtext($1))", [userId]);
      return await action(client);
    } finally {
      try { await client.query("SELECT pg_advisory_unlock(hashtext('ati-notion-owner'),hashtext($1))", [userId]); }
      finally { client.release(); }
    }
  }
  async start(input: { userId: string; sessionId: string; stateHash: string; browserHash: string }, now = Date.now()): Promise<void> {
    await this.withOwner(input.userId, async c => {
      await c.query('DELETE FROM notion_oauth_states WHERE expires_at<=$1', [new Date(now)]);
      await c.query(`INSERT INTO notion_oauth_states(user_id,session_id,state_hash,browser_hash,expires_at) VALUES($1,$2,$3,$4,$5)`,
        [input.userId, input.sessionId, input.stateHash, input.browserHash, new Date(now + 600000)]);
    });
  }
  async consume(input: { userId: string; sessionId: string; state: string; browser: string }, now = Date.now()): Promise<{ id: string } | null> {
    return (await this.pool.query(`UPDATE notion_oauth_states o SET used_at=$5 WHERE state_hash=$1 AND browser_hash=$2
      AND o.user_id=$3 AND o.session_id=$4 AND o.used_at IS NULL AND o.expires_at>$5 AND EXISTS
      (SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=o.session_id AND s.user_id=o.user_id
       AND s.revoked_at IS NULL AND s.expires_at>$5 AND u.status='active') RETURNING o.id`,
      [hash(input.state), hash(input.browser), input.userId, input.sessionId, new Date(now)])).rows[0] ?? null;
  }
  async list(userId: string): Promise<NotionConnectionRow[]> {
    return (await this.pool.query<NotionConnectionRow>("SELECT * FROM notion_connections WHERE user_id=$1 AND status<>'disconnected' ORDER BY connected_at,id", [userId])).rows;
  }
  async get(client: pg.PoolClient, userId: string, id: string): Promise<NotionConnectionRow | null> {
    return (await client.query<NotionConnectionRow>('SELECT * FROM notion_connections WHERE id=$1 AND user_id=$2', [id, userId])).rows[0] ?? null;
  }
  async save(userId: string, stateId: string, input: SaveInput, clock = Date.now): Promise<NotionConnectionRow | null> {
    return this.withOwner(userId, async c => {
      await c.query('BEGIN');
      try {
        await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
        const state = (await c.query<{ expires_at: Date; state_expires: Date; status: string }>(`SELECT s.expires_at,o.expires_at AS state_expires,u.status FROM notion_oauth_states o
          JOIN auth_sessions s ON s.id=o.session_id AND s.user_id=o.user_id JOIN users u ON u.id=o.user_id
          WHERE o.id=$1 AND o.user_id=$2 AND o.used_at IS NOT NULL AND s.revoked_at IS NULL FOR UPDATE OF s`, [stateId, userId])).rows[0];
        const now = clock();
        if (!state || state.status !== 'active' || state.expires_at.getTime() <= now || state.state_expires.getTime() <= now) { await c.query('ROLLBACK'); return null; }
        const result = await c.query<NotionConnectionRow>(`INSERT INTO notion_connections(user_id,app_id,workspace_id,workspace_name,actor_id,config,scopes,connected_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,app_id,workspace_id) DO UPDATE SET
          workspace_name=excluded.workspace_name,actor_id=excluded.actor_id,config=excluded.config,scopes=excluded.scopes,
          status='active',identity_version=notion_connections.identity_version+1,allowed_databases='{}',refresh_in_flight=false,connected_at=excluded.connected_at RETURNING *`,
          [userId, input.appId, input.workspaceId, input.workspaceName, input.actorId, input.config, input.scopes, new Date(now)]);
        await c.query('DELETE FROM notion_oauth_states WHERE user_id=$1', [userId]);
        await c.query('COMMIT'); return result.rows[0]!;
      } catch (e) { await c.query('ROLLBACK'); if ((e as any).code === '23505') throw new Error('NOTION_IDENTITY_CONFLICT'); throw e; }
    });
  }
  /** Even an already absent connection invalidates callbacks. Provider revoke is under the same owner lock. */
  async selectDatabases(userId: string, id: string, version: number, databases: string[]): Promise<boolean> {
    return this.withOwner(userId, async c => (await c.query("UPDATE notion_connections SET allowed_databases=$4,identity_version=identity_version+1 WHERE id=$1 AND user_id=$2 AND identity_version=$3 AND status='active'", [id, userId, version, databases])).rowCount === 1);
  }
  async disconnect(userId: string, id: string, revoke?: (row: NotionConnectionRow) => Promise<void>): Promise<void> {
    await this.withOwner(userId, async c => {
      const row = await this.get(c, userId, id);
      await c.query('BEGIN');
      try {
        await c.query('DELETE FROM notion_oauth_states WHERE user_id=$1', [userId]);
        await c.query("UPDATE notion_connections SET status='disconnected',config=NULL,identity_version=identity_version+1,refresh_in_flight=false WHERE id=$1 AND user_id=$2 AND status<>'disconnected'", [id, userId]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
      if (row?.status !== 'disconnected' && row?.config && revoke) await revoke(row);
    });
  }
}
