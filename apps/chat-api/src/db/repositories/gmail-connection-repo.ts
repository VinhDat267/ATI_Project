import type pg from 'pg';
import type { ServiceCredentialRow } from './credential-repo.js';

const SERVICE = 'gmail';

/**
 * Saving and removing a member's own Gmail connection. Both take the same
 * advisory lock as CredentialRepo.saveCredentials, so a token exchange that
 * finishes after "disconnect" or after logout cannot bring the connection back.
 */
export class GmailConnectionRepo {
  readonly service: 'gmail' | 'mycalendar';
  readonly mode: 'connect_gmail' | 'connect_mycalendar';

  constructor(
    private pool: pg.Pool,
    service: 'gmail' | 'mycalendar' = 'gmail',
    mode?: 'connect_gmail' | 'connect_mycalendar'
  ) {
    this.service = service;
    this.mode = mode ?? (service === 'mycalendar' ? 'connect_mycalendar' : 'connect_gmail');
  }

  /**
   * Saves only while the consumed state still exists and its session is active.
   * The first successful save invalidates all other flows of this owner.
   * User/session row locks keep logout or disable from passing the validity
   * check before the write commits, in the same user-then-session order as auth.
   */
  async saveConnection(userId: string, stateId: string, config: string, now: number | (() => number)): Promise<ServiceCredentialRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [this.service, userId]);
      const owner = await client.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE", [userId]);
      if (!owner.rows.length) {
        await client.query('ROLLBACK');
        return null;
      }
      const live = await client.query<{ expires_at: Date }>(`SELECT s.expires_at FROM oauth_states o
        JOIN auth_sessions s ON s.id = o.session_id AND s.user_id = o.user_id
        WHERE o.id = $1 AND o.user_id = $2 AND o.mode = $3 AND o.used_at IS NOT NULL
          AND s.revoked_at IS NULL FOR UPDATE OF s`, [stateId, userId, this.mode]);
      if (!live.rows.length) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('DELETE FROM oauth_states WHERE user_id = $1 AND mode = $2', [userId, this.mode]);
      await client.query('DELETE FROM service_credentials WHERE service = $1 AND user_id = $2', [this.service, userId]);
      // Any row lock, including the credential DELETE, can cross expiry. Check
      // just before INSERT; rollback also restores the old credential and states.
      const checkedAt = typeof now === 'function' ? now() : now;
      if (live.rows[0]!.expires_at.getTime() <= checkedAt) {
        await client.query('ROLLBACK');
        return null;
      }
      const row = (await client.query<ServiceCredentialRow>(
        'INSERT INTO service_credentials (service, user_id, config) VALUES ($1, $2, $3) RETURNING *', [this.service, userId, config])).rows[0]!;
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Keep a rejected grant's cleanup decision stable against save/disconnect. */
  async withLockedConnection(userId: string,
    action: (current: ServiceCredentialRow | null, otherFlows: boolean) => Promise<void>, ignoredStateId?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [this.service, userId]);
      // The OAuth-state user FK takes a key-share lock on INSERT, so this also
      // prevents a new flow from beginning during the grant cleanup decision.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const current = (await client.query<ServiceCredentialRow>(
        'SELECT * FROM service_credentials WHERE service = $1 AND user_id = $2 FOR UPDATE', [this.service, userId])).rows[0] ?? null;
      const otherFlows = (await client.query(`SELECT 1 FROM oauth_states WHERE user_id=$1 AND mode=$2
        AND id IS DISTINCT FROM $3::uuid LIMIT 1`, [userId, this.mode, ignoredStateId ?? null])).rows.length > 0;
      await action(current, otherFlows);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Deletes the connection and every state of the owner in this mode; returns the removed row for token revocation. */
  async disconnect(userId: string): Promise<ServiceCredentialRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [this.service, userId]);
      await client.query('DELETE FROM oauth_states WHERE user_id = $1 AND mode = $2', [userId, this.mode]);
      const removed = (await client.query<ServiceCredentialRow>(
        'DELETE FROM service_credentials WHERE service = $1 AND user_id = $2 RETURNING *', [this.service, userId])).rows[0] ?? null;
      await client.query('COMMIT');
      return removed;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Updates an active credential's config under the service advisory lock, verifying
   * expectedCredentialId so concurrent reconnect or disconnect returns null.
   */
  async updateConfigIfActive(
    userId: string,
    expectedCredentialId: string,
    transform: (config: string) => string
  ): Promise<ServiceCredentialRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [this.service, userId]);
      const owner = await client.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE", [userId]);
      if (!owner.rows.length) {
        await client.query('ROLLBACK');
        return null;
      }
      const current = (await client.query<ServiceCredentialRow>(
        'SELECT * FROM service_credentials WHERE id = $1 AND service = $2 AND user_id = $3 AND status = $4 FOR UPDATE',
        [expectedCredentialId, this.service, userId, 'active']
      )).rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return null;
      }
      const newConfig = transform(current.config);
      const updated = (await client.query<ServiceCredentialRow>(
        'UPDATE service_credentials SET config = $1 WHERE id = $2 RETURNING *',
        [newConfig, expectedCredentialId]
      )).rows[0] ?? null;
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
