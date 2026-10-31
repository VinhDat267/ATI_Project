import type pg from 'pg';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';

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
  constructor(
    private pool: pg.Pool,
    private encryptionKey: string = process.env.ENCRYPTION_KEY || '01234567890123456789012345678901'
  ) {}

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

  /** Rotates a personal single-use refresh token inside a transaction with plaintext comparison. */
  async rotatePersonalSecret(input: {
    service: 'trello';
    userId: string;
    credentialId: string;
    previousRefreshToken: string;
    nextRefreshToken: string;
  }): Promise<'rotated' | 'mismatch' | 'missing'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<ServiceCredentialRow>(
        'SELECT * FROM service_credentials WHERE id = $1 AND service = $2 AND user_id = $3 FOR UPDATE',
        [input.credentialId, input.service, requireUser(input.userId)]
      );
      const row = res.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return 'missing';
      }

      let data: Record<string, any>;
      try {
        data = decryptCredentials(row.config, this.encryptionKey);
      } catch {
        await client.query('ROLLBACK');
        return 'mismatch';
      }

      if (data.refreshToken !== input.previousRefreshToken) {
        await client.query('ROLLBACK');
        return 'mismatch';
      }

      const updatedData = { ...data, refreshToken: input.nextRefreshToken };
      const newConfig = encryptCredentials(updatedData, this.encryptionKey);

      await client.query(
        `UPDATE service_credentials
         SET config = $1, status = 'active', status_changed_at = now()
         WHERE id = $2`,
        [newConfig, row.id]
      );

      await client.query('COMMIT');
      return 'rotated';
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
