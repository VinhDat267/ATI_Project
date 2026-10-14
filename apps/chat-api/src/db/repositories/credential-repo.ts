import type pg from 'pg';

export type CredentialStatus = 'active' | 'reconnect_required';

export interface ServiceCredentialRow {
  id: string;
  service: string;
  user_id: string | null;
  config: string;
  created_at: Date;
  status: CredentialStatus;
  status_changed_at: Date | null;
}

function requireUser(userId: string | null | undefined): string {
  if (!userId) throw new Error('A personal credential needs a user id');
  return userId;
}

export class CredentialRepo {
  constructor(private pool: pg.Pool) {}

  async saveCredentials(
    service: string,
    config: string,
    userId?: string | null
  ): Promise<ServiceCredentialRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [service, userId || 'team-shared']);
      if (userId) {
        await client.query('DELETE FROM service_credentials WHERE service = $1 AND user_id = $2', [service, userId]);
      } else {
        await client.query('DELETE FROM service_credentials WHERE service = $1 AND user_id IS NULL', [service]);
      }
      const res = await client.query(
        `INSERT INTO service_credentials (service, user_id, config)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [service, userId || null, config]
      );
      await client.query('COMMIT');
      return res.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getCredentials(
    service: string,
    userId?: string | null
  ): Promise<ServiceCredentialRow | null> {
    if (userId) {
      const userRes = await this.pool.query(
        'SELECT * FROM service_credentials WHERE service = $1 AND user_id = $2',
        [service, userId]
      );
      if (userRes.rows[0]) return userRes.rows[0];
    }

    // Fallback to team-shared credentials (user_id IS NULL)
    const sharedRes = await this.pool.query(
      'SELECT * FROM service_credentials WHERE service = $1 AND user_id IS NULL',
      [service]
    );
    return sharedRes.rows[0] || null;
  }

  /** A personal connection (Gmail): only the owner's own active row, never a shared key. */
  async getPersonalCredentials(service: string, userId: string): Promise<ServiceCredentialRow | null> {
    const res = await this.pool.query(
      "SELECT * FROM service_credentials WHERE service = $1 AND user_id = $2 AND status = 'active'",
      [service, requireUser(userId)],
    );
    return res.rows[0] ?? null;
  }

  /** The owner's own row in any status, for showing "connected" or "reconnect required". */
  async getPersonalConnectionStatus(service: string, userId: string): Promise<ServiceCredentialRow | null> {
    const res = await this.pool.query(
      'SELECT * FROM service_credentials WHERE service = $1 AND user_id = $2',
      [service, requireUser(userId)],
    );
    return res.rows[0] ?? null;
  }

  /** The grant is gone: keep the row for the UI. A newer connection (another id) is never touched. */
  async markReconnectRequired(service: string, userId: string, credentialId: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE service_credentials SET status = 'reconnect_required', status_changed_at = now()
       WHERE id = $3 AND service = $1 AND user_id = $2 AND status = 'active'`,
      [service, requireUser(userId), credentialId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Read and transform shared config under the same lock as key replacement. */
  async updateCredentials(
    service: string,
    transformConfig: (config: string) => string,
  ): Promise<ServiceCredentialRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [service, 'team-shared']);
      const current = await client.query<ServiceCredentialRow>(
        'SELECT * FROM service_credentials WHERE service = $1 AND user_id IS NULL', [service],
      );
      const record = current.rows[0];
      if (!record) {
        await client.query('COMMIT');
        return null;
      }
      const updated = await client.query<ServiceCredentialRow>(
        'UPDATE service_credentials SET config = $2 WHERE id = $1 RETURNING *',
        [record.id, transformConfig(record.config)],
      );
      await client.query('COMMIT');
      return updated.rows[0] ?? null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteCredentials(service: string, userId?: string | null): Promise<void> {
    if (userId) {
      await this.pool.query(
        'DELETE FROM service_credentials WHERE service = $1 AND user_id = $2',
        [service, userId]
      );
    } else {
      await this.pool.query(
        'DELETE FROM service_credentials WHERE service = $1 AND user_id IS NULL',
        [service]
      );
    }
  }
}
