import type pg from 'pg';
import type { ServiceCredentialRow } from './credential-repo.js';

const SERVICE = 'gmail';

/**
 * Saving and removing a member's own Gmail connection. Both take the same
 * advisory lock as CredentialRepo.saveCredentials, so a token exchange that
 * finishes after "disconnect" or after logout cannot bring the connection back.
 */
export class GmailConnectionRepo {
  constructor(private pool: pg.Pool) {}

  /**
   * Saves only while the consumed connect_gmail state still exists (disconnect
   * deletes the owner's states) and its session is still signed in. Returns
   * null when the late callback must not write anything.
   */
  async saveConnection(userId: string, stateId: string, config: string, now: number): Promise<ServiceCredentialRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [SERVICE, userId]);
      const live = await client.query(`SELECT 1 FROM oauth_states o
        JOIN auth_sessions s ON s.id = o.session_id AND s.user_id = o.user_id
        JOIN users u ON u.id = o.user_id
        WHERE o.id = $1 AND o.user_id = $2 AND o.mode = 'connect_gmail' AND o.used_at IS NOT NULL
          AND s.revoked_at IS NULL AND s.expires_at > $3 AND u.status = 'active'`, [stateId, userId, new Date(now)]);
      if (!live.rows.length) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('DELETE FROM service_credentials WHERE service = $1 AND user_id = $2', [SERVICE, userId]);
      const row = (await client.query<ServiceCredentialRow>(
        'INSERT INTO service_credentials (service, user_id, config) VALUES ($1, $2, $3) RETURNING *', [SERVICE, userId, config])).rows[0]!;
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Deletes the connection and every connect_gmail state of the owner; returns the removed row for token revocation. */
  async disconnect(userId: string): Promise<ServiceCredentialRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [SERVICE, userId]);
      await client.query("DELETE FROM oauth_states WHERE user_id = $1 AND mode = 'connect_gmail'", [userId]);
      const removed = (await client.query<ServiceCredentialRow>(
        'DELETE FROM service_credentials WHERE service = $1 AND user_id = $2 RETURNING *', [SERVICE, userId])).rows[0] ?? null;
      await client.query('COMMIT');
      return removed;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
