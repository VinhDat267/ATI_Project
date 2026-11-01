import type pg from 'pg';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';

export type CredentialStatus = 'active' | 'reconnect_required';

export interface ServiceCredentialRow {
  id: string;
  service: string;
  user_id: string | null;
  workspace_id?: string | null;
  workspaceId?: string | null;
  config: string;
  created_at: Date;
  status: CredentialStatus;
  status_changed_at: Date | null;
}

export type CredentialRecord = ServiceCredentialRow;

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
    userId?: string | null,
    workspaceId: string | null = null
  ): Promise<ServiceCredentialRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lockTarget = userId ?? workspaceId ?? 'team-shared';
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [service, lockTarget]);
      if (userId) {
        await client.query('SAVEPOINT sp_user');
        try {
          await client.query('DELETE FROM service_credentials WHERE service = $1 AND user_id = $2 AND workspace_id IS NULL', [service, userId]);
          const res = await client.query(
            `INSERT INTO service_credentials (service, user_id, workspace_id, config, status)
             VALUES ($1, $2, NULL, $3, 'active')
             RETURNING *`,
            [service, userId, config]
          );
          await client.query('RELEASE SAVEPOINT sp_user');
          await client.query('COMMIT');
          const row = res.rows[0];
          return { ...row, workspaceId: row.workspace_id ?? null };
        } catch (err: any) {
          if (err?.code === '42703') {
            await client.query('ROLLBACK TO SAVEPOINT sp_user');
            await client.query('DELETE FROM service_credentials WHERE service = $1 AND user_id = $2', [service, userId]);
            const res = await client.query(
              `INSERT INTO service_credentials (service, user_id, config)
               VALUES ($1, $2, $3)
               RETURNING *`,
              [service, userId, config]
            );
            await client.query('COMMIT');
            return res.rows[0];
          }
          throw err;
        }
      } else {
        await client.query('SAVEPOINT sp_shared');
        try {
          await client.query('DELETE FROM service_credentials WHERE service = $1 AND user_id IS NULL AND workspace_id IS NOT DISTINCT FROM $2', [service, workspaceId]);
          const res = await client.query(
            `INSERT INTO service_credentials (service, user_id, workspace_id, config, status)
             VALUES ($1, NULL, $2, $3, 'active')
             RETURNING *`,
            [service, workspaceId, config]
          );
          await client.query('RELEASE SAVEPOINT sp_shared');
          await client.query('COMMIT');
          const row = res.rows[0];
          return { ...row, workspaceId: row.workspace_id ?? null };
        } catch (err: any) {
          if (err?.code === '42703') {
            await client.query('ROLLBACK TO SAVEPOINT sp_shared');
            await client.query('DELETE FROM service_credentials WHERE service = $1 AND user_id IS NULL', [service]);
            const res = await client.query(
              `INSERT INTO service_credentials (service, user_id, config)
               VALUES ($1, NULL, $2)
               RETURNING *`,
              [service, config]
            );
            await client.query('COMMIT');
            return res.rows[0];
          }
          throw err;
        }
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async upsertCredentials(
    service: string,
    config: string,
    status = 'active',
    updatedBy?: string,
    workspaceId: string | null = null
  ): Promise<ServiceCredentialRow> {
    const res = await this.pool.query(
      `INSERT INTO service_credentials (service, user_id, workspace_id, config, status, created_at)
       VALUES ($1, NULL, $2, $3, $4, now())
       ON CONFLICT (service, user_id, workspace_id) DO UPDATE
       SET id = gen_random_uuid(), config = EXCLUDED.config, status = EXCLUDED.status
       RETURNING *`,
      [service, workspaceId, config, status]
    );
    const row = res.rows[0];
    return { ...row, workspaceId: row.workspace_id };
  }

  async getCredentials(
    service: string,
    workspaceId: string | null = null
  ): Promise<ServiceCredentialRow | null> {
    if (service === 'gmail' && workspaceId) {
      const legacyGmail = await this.pool.query(
        'SELECT * FROM service_credentials WHERE service = $1 AND (user_id = $2 OR user_id IS NULL) ORDER BY user_id NULLS LAST LIMIT 1',
        [service, workspaceId]
      );
      const row = legacyGmail.rows[0];
      return row ? { ...row, workspaceId: row.workspace_id ?? null } : null;
    }

    try {
      const res = await this.pool.query(
        'SELECT * FROM service_credentials WHERE service = $1 AND user_id IS NULL AND workspace_id IS NOT DISTINCT FROM $2',
        [service, workspaceId]
      );
      const row = res.rows[0];
      if (row) return { ...row, workspaceId: row.workspace_id ?? null };
    } catch (err: any) {
      if (err?.code === '42703' && !workspaceId) {
        const legacyRes = await this.pool.query(
          'SELECT * FROM service_credentials WHERE service = $1 AND user_id IS NULL',
          [service]
        );
        const row = legacyRes.rows[0];
        if (row) return { ...row, workspaceId: null };
      } else {
        throw err;
      }
    }

    return null;
  }

  async deleteCredentials(service: string, workspaceIdOrUserId: string | null = null): Promise<void> {
    if (workspaceIdOrUserId) {
      await this.pool.query(
        'DELETE FROM service_credentials WHERE service = $1 AND (user_id = $2 OR (user_id IS NULL AND workspace_id = $2))',
        [service, workspaceIdOrUserId]
      );
    } else {
      await this.pool.query(
        'DELETE FROM service_credentials WHERE service = $1 AND user_id IS NULL AND workspace_id IS NULL',
        [service]
      );
    }
  }

  async listStatuses(
    workspaceId: string | null = null
  ): Promise<Array<{ service: string; status: CredentialStatus; updated_at?: Date }>> {
    const res = await this.pool.query<{ service: string; status: CredentialStatus; created_at: Date }>(
      'SELECT service, status, created_at FROM service_credentials WHERE user_id IS NULL AND workspace_id IS NOT DISTINCT FROM $1',
      [workspaceId]
    );
    return res.rows.map(r => ({ service: r.service, status: r.status, updated_at: r.created_at }));
  }

  async listPersonalStatuses(
    userId: string
  ): Promise<Array<{ service: string; status: CredentialStatus; updated_at?: Date }>> {
    const res = await this.pool.query<{ service: string; status: CredentialStatus; created_at: Date }>(
      'SELECT service, status, created_at FROM service_credentials WHERE user_id = $1 AND workspace_id IS NULL',
      [requireUser(userId)]
    );
    return res.rows.map(r => ({ service: r.service, status: r.status, updated_at: r.created_at }));
  }

  /** A personal connection: only the owner's own active row, never a shared key. */
  async getPersonalCredentials(service: string, userId: string): Promise<ServiceCredentialRow | null> {
    const res = await this.pool.query(
      "SELECT * FROM service_credentials WHERE service = $1 AND user_id = $2 AND workspace_id IS NULL AND status = 'active'",
      [service, requireUser(userId)]
    );
    const row = res.rows[0];
    if (!row) return null;
    return { ...row, workspaceId: row.workspace_id };
  }

  async upsertPersonalCredentials(input: {
    service: string;
    userId: string;
    config: string;
    status?: CredentialStatus;
  }): Promise<ServiceCredentialRow> {
    const res = await this.pool.query(
      `INSERT INTO service_credentials (service, user_id, workspace_id, config, status, created_at)
       VALUES ($1, $2, NULL, $3, $4, now())
       ON CONFLICT (service, user_id, workspace_id) DO UPDATE
       SET id = gen_random_uuid(), config = EXCLUDED.config, status = EXCLUDED.status
       RETURNING *`,
      [input.service, requireUser(input.userId), input.config, input.status ?? 'active']
    );
    const row = res.rows[0];
    return { ...row, workspaceId: row.workspace_id };
  }

  async deletePersonalCredentials(service: string, userId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM service_credentials WHERE service = $1 AND user_id = $2 AND workspace_id IS NULL',
      [service, requireUser(userId)]
    );
  }

  /** The owner's own row in any status, for showing "connected" or "reconnect required". */
  async getPersonalConnectionStatus(service: string, userId: string): Promise<ServiceCredentialRow | null> {
    const res = await this.pool.query(
      'SELECT * FROM service_credentials WHERE service = $1 AND user_id = $2 AND workspace_id IS NULL',
      [service, requireUser(userId)]
    );
    const row = res.rows[0];
    if (!row) return null;
    return { ...row, workspaceId: row.workspace_id };
  }

  /** The grant is gone: keep the row for the UI. A newer connection (another id) is never touched. */
  async markReconnectRequired(service: string, userId: string, credentialId: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE service_credentials SET status = 'reconnect_required', status_changed_at = now()
       WHERE id = $3 AND service = $1 AND user_id = $2 AND workspace_id IS NULL AND status = 'active'`,
      [service, requireUser(userId), credentialId]
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
        'SELECT * FROM service_credentials WHERE id = $1 AND service = $2 AND user_id = $3 AND workspace_id IS NULL FOR UPDATE',
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
    workspaceId: string | null = null
  ): Promise<ServiceCredentialRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [service, workspaceId || 'team-shared']);
      const current = await client.query<ServiceCredentialRow>(
        'SELECT * FROM service_credentials WHERE service = $1 AND user_id IS NULL AND workspace_id IS NOT DISTINCT FROM $2',
        [service, workspaceId]
      );
      const record = current.rows[0];
      if (!record) {
        await client.query('COMMIT');
        return null;
      }
      const updated = await client.query<ServiceCredentialRow>(
        'UPDATE service_credentials SET config = $2 WHERE id = $1 RETURNING *',
        [record.id, transformConfig(record.config)]
      );
      await client.query('COMMIT');
      const row = updated.rows[0];
      return row ? { ...row, workspaceId: row.workspace_id } : null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
