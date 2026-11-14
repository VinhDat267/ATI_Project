import type pg from 'pg';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';

export type CredentialStatus = 'active' | 'reconnect_required';
export type CredentialRefreshState = 'idle' | 'refreshing' | 'failed';

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
  refresh_state?: CredentialRefreshState;
  refresh_attempt_id?: string | null;
  refresh_started_at?: Date | null;
  token_version?: number;
  status_reason?: string | null;
  access_expires_at?: Date | null;
}

export type PersonalRefreshPollResult =
  | { kind: 'missing' }
  | { kind: 'reconnect_required'; statusReason: string | null }
  | {
      kind: 'active';
      refreshState: CredentialRefreshState;
      tokenVersion: number;
      refreshElapsedMs: number | null;
      accessToken?: string;
      expiresAtMs?: number;
      statusReason: string | null;
    };

export type PersonalRefreshClaimResult =
  | { kind: 'missing' }
  | { kind: 'reconnect_required'; statusReason: string | null }
  | { kind: 'failed_closed'; statusReason: string }
  | { kind: 'already_refreshed'; accessToken: string; expiresAtMs: number; tokenVersion: number }
  | { kind: 'busy'; tokenVersion: number; refreshElapsedMs: number }
  | { kind: 'claimed'; attemptId: string; refreshToken: string; tokenVersion: number };

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

  async saveCredential(
    userId: string,
    service: string,
    payload: string | { encryptedData: string; iv: string; authTag: string },
  ): Promise<ServiceCredentialRow> {
    const config =
      typeof payload === 'string'
        ? payload
        : `v1:${payload.iv}:${payload.authTag}:${payload.encryptedData}`;
    return this.saveCredentials(service, config, userId);
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
       SET id = gen_random_uuid(),
           config = EXCLUDED.config,
           status = EXCLUDED.status,
           status_changed_at = NULL,
           refresh_state = 'idle',
           refresh_attempt_id = NULL,
           refresh_started_at = NULL,
           token_version = 1,
           status_reason = NULL,
           access_expires_at = NULL
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
  async markReconnectRequired(
    service: string,
    userId: string,
    credentialId: string,
    statusReason?: string
  ): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE service_credentials
       SET status = 'reconnect_required',
           status_changed_at = clock_timestamp(),
           refresh_state = 'idle',
           refresh_attempt_id = NULL,
           status_reason = COALESCE($4, status_reason)
       WHERE id = $3 AND service = $1 AND user_id = $2 AND workspace_id IS NULL AND status = 'active'`,
      [service, requireUser(userId), credentialId, statusReason ?? null]
    );
    return (res.rowCount ?? 0) > 0;
  }

  private scrubSecretConfig(rawConfig: string): string {
    try {
      const data = decryptCredentials<Record<string, any>>(rawConfig, this.encryptionKey);
      const { refreshToken: _rt, accessToken: _at, expiresAt: _exp, ...metadata } = data;
      return encryptCredentials(metadata, this.encryptionKey);
    } catch {
      return encryptCredentials({}, this.encryptionKey);
    }
  }

  private parseAccessSnapshot(row: ServiceCredentialRow): { accessToken?: string; expiresAtMs?: number; refreshToken?: string } {
    try {
      const data = decryptCredentials<Record<string, any>>(row.config, this.encryptionKey);
      const accessToken = typeof data.accessToken === 'string' && data.accessToken ? data.accessToken : undefined;
      const refreshToken = typeof data.refreshToken === 'string' && data.refreshToken.trim() ? data.refreshToken : undefined;
      const expiresAtMs = row.access_expires_at
        ? new Date(row.access_expires_at).getTime()
        : typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt)
          ? data.expiresAt
          : undefined;
      return { accessToken, expiresAtMs, refreshToken };
    } catch {
      return {};
    }
  }

  /** Reads current personal credential refresh state without holding any DB lock. */
  async pollPersonalRefresh(input: {
    service: 'trello' | 'github';
    userId: string;
    credentialId: string;
  }): Promise<PersonalRefreshPollResult> {
    const res = await this.pool.query<ServiceCredentialRow & { refresh_elapsed_ms: string | number | null }>(
      `SELECT *,
              CASE
                WHEN refresh_started_at IS NULL THEN NULL
                ELSE GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - refresh_started_at)) * 1000)
              END AS refresh_elapsed_ms
       FROM service_credentials
       WHERE id = $1 AND service = $2 AND user_id = $3 AND workspace_id IS NULL`,
      [input.credentialId, input.service, requireUser(input.userId)]
    );
    const row = res.rows[0];
    if (!row) return { kind: 'missing' };
    if (row.status !== 'active') {
      return { kind: 'reconnect_required', statusReason: row.status_reason ?? null };
    }
    const { accessToken, expiresAtMs } = this.parseAccessSnapshot(row);
    const elapsed = row.refresh_elapsed_ms === null || row.refresh_elapsed_ms === undefined
      ? null
      : Number(row.refresh_elapsed_ms);
    return {
      kind: 'active',
      refreshState: (row.refresh_state ?? 'idle') as CredentialRefreshState,
      tokenVersion: Number(row.token_version ?? 1),
      refreshElapsedMs: elapsed !== null && Number.isFinite(elapsed) ? elapsed : null,
      accessToken,
      expiresAtMs,
      statusReason: row.status_reason ?? null,
    };
  }

  /**
   * Acquires or observes the multi-process refresh lease in a short transaction and releases
   * the PG connection before any outbound provider HTTP request begins.
   */
  async claimPersonalRefresh(input: {
    service: 'trello' | 'github';
    userId: string;
    credentialId: string;
    minTokenVersion?: number;
    forceRefresh?: boolean;
    refreshTimeoutMs: number;
    attemptId: string;
    nowMs?: number;
  }): Promise<PersonalRefreshClaimResult> {
    const userId = requireUser(input.userId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<ServiceCredentialRow & { refresh_elapsed_ms: string | number | null }>(
        `SELECT *,
                CASE
                  WHEN refresh_started_at IS NULL THEN NULL
                  ELSE GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - refresh_started_at)) * 1000)
                END AS refresh_elapsed_ms
         FROM service_credentials
         WHERE id = $1 AND service = $2 AND user_id = $3 AND workspace_id IS NULL
         FOR UPDATE`,
        [input.credentialId, input.service, userId]
      );
      const row = res.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return { kind: 'missing' };
      }
      if (row.status !== 'active') {
        await client.query('COMMIT');
        return { kind: 'reconnect_required', statusReason: row.status_reason ?? null };
      }

      const tokenVersion = Number(row.token_version ?? 1);
      const refreshState = (row.refresh_state ?? 'idle') as CredentialRefreshState;
      const { accessToken, expiresAtMs, refreshToken } = this.parseAccessSnapshot(row);

      if (
        refreshState === 'idle' &&
        accessToken &&
        ((typeof input.minTokenVersion === 'number' && tokenVersion > input.minTokenVersion) ||
          (!input.forceRefresh && typeof input.nowMs === 'number' && typeof expiresAtMs === 'number' && expiresAtMs - input.nowMs > 60_000))
      ) {
        await client.query('COMMIT');
        return {
          kind: 'already_refreshed',
          accessToken,
          expiresAtMs: expiresAtMs ?? ((input.nowMs ?? Date.now()) + 3600_000),
          tokenVersion,
        };
      }

      if (refreshState === 'refreshing') {
        const elapsed =
          row.refresh_started_at && row.refresh_elapsed_ms !== null && row.refresh_elapsed_ms !== undefined
            ? Number(row.refresh_elapsed_ms)
            : Number.POSITIVE_INFINITY;
        if (elapsed >= input.refreshTimeoutMs) {
          const scrubbedConfig = this.scrubSecretConfig(row.config);
          await client.query(
            `UPDATE service_credentials
             SET config = $1,
                 status = 'reconnect_required',
                 status_reason = 'CRASH_UNKNOWN_ROTATION',
                 refresh_state = 'idle',
                 refresh_attempt_id = NULL,
                 access_expires_at = NULL,
                 status_changed_at = clock_timestamp()
             WHERE id = $2 AND status = 'active'`,
            [scrubbedConfig, row.id]
          );
          await client.query('COMMIT');
          return { kind: 'failed_closed', statusReason: 'CRASH_UNKNOWN_ROTATION' };
        }
        await client.query('COMMIT');
        return { kind: 'busy', tokenVersion, refreshElapsedMs: Number.isFinite(elapsed) ? elapsed : 0 };
      }

      if (refreshState === 'failed' || !refreshToken) {
        const reason = refreshState === 'failed' ? row.status_reason ?? 'REFRESH_FAILED' : 'NO_REFRESH_TOKEN';
        const scrubbedConfig = this.scrubSecretConfig(row.config);
        await client.query(
          `UPDATE service_credentials
           SET config = $1,
               status = 'reconnect_required',
               status_reason = $2,
               refresh_state = 'idle',
               refresh_attempt_id = NULL,
               access_expires_at = NULL,
               status_changed_at = clock_timestamp()
           WHERE id = $3 AND status = 'active'`,
          [scrubbedConfig, reason, row.id]
        );
        await client.query('COMMIT');
        return { kind: 'failed_closed', statusReason: reason };
      }

      await client.query(
        `UPDATE service_credentials
         SET refresh_state = 'refreshing',
             refresh_attempt_id = $1,
             refresh_started_at = clock_timestamp()
         WHERE id = $2 AND status = 'active'`,
        [input.attemptId, row.id]
      );
      await client.query('COMMIT');
      return { kind: 'claimed', attemptId: input.attemptId, refreshToken, tokenVersion };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Fenced compare-and-swap commit after upstream rotation; honors Disconnect-Wins. */
  async commitPersonalRefresh(input: {
    service: 'trello' | 'github';
    userId: string;
    credentialId: string;
    attemptId: string;
    nextRefreshToken: string;
    nextAccessToken: string;
    accessExpiresAt: Date;
  }): Promise<'committed' | 'disconnected'> {
    const userId = requireUser(input.userId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<ServiceCredentialRow>(
        `SELECT * FROM service_credentials
         WHERE id = $1 AND service = $2 AND user_id = $3 AND workspace_id IS NULL
         FOR UPDATE`,
        [input.credentialId, input.service, userId]
      );
      const row = res.rows[0];
      if (!row || row.status !== 'active' || row.refresh_attempt_id !== input.attemptId) {
        await client.query('COMMIT');
        return 'disconnected';
      }

      let data: Record<string, any>;
      try {
        data = decryptCredentials(row.config, this.encryptionKey);
      } catch {
        data = {};
      }
      const updatedConfig = encryptCredentials(
        {
          ...data,
          refreshToken: input.nextRefreshToken,
          accessToken: input.nextAccessToken,
          expiresAt: input.accessExpiresAt.getTime(),
        },
        this.encryptionKey
      );

      const updateRes = await client.query(
        `UPDATE service_credentials
         SET config = $1,
             token_version = token_version + 1,
             refresh_state = 'idle',
             refresh_attempt_id = NULL,
             status_reason = NULL,
             access_expires_at = $2,
             status = 'active'
         WHERE id = $3 AND refresh_attempt_id = $4 AND status = 'active'`,
        [updatedConfig, input.accessExpiresAt, row.id, input.attemptId]
      );
      await client.query('COMMIT');
      return (updateRes.rowCount ?? 0) > 0 ? 'committed' : 'disconnected';
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Fails closed and scrubs tokens on post-dispatch error while preserving Disconnect-Wins. */
  async failPersonalRefresh(input: {
    service: 'trello' | 'github';
    userId: string;
    credentialId: string;
    attemptId: string;
    statusReason: string;
  }): Promise<'fenced' | 'disconnected'> {
    const userId = requireUser(input.userId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<ServiceCredentialRow>(
        `SELECT * FROM service_credentials
         WHERE id = $1 AND service = $2 AND user_id = $3 AND workspace_id IS NULL
         FOR UPDATE`,
        [input.credentialId, input.service, userId]
      );
      const row = res.rows[0];
      if (!row || row.status !== 'active' || row.refresh_attempt_id !== input.attemptId) {
        await client.query('COMMIT');
        return 'disconnected';
      }

      const scrubbedConfig = this.scrubSecretConfig(row.config);
      const updateRes = await client.query(
        `UPDATE service_credentials
         SET config = $1,
             status = 'reconnect_required',
             status_reason = $2,
             refresh_state = 'idle',
             refresh_attempt_id = NULL,
             access_expires_at = NULL,
             status_changed_at = clock_timestamp()
         WHERE id = $3 AND refresh_attempt_id = $4 AND status = 'active'`,
        [scrubbedConfig, input.statusReason, row.id, input.attemptId]
      );
      await client.query('COMMIT');
      return (updateRes.rowCount ?? 0) > 0 ? 'fenced' : 'disconnected';
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Rotates a personal single-use refresh token inside a transaction with plaintext comparison. */
  async rotatePersonalSecret(input: {
    service: 'trello' | 'github';
    userId: string;
    credentialId: string;
    previousRefreshToken: string;
    nextRefreshToken: string;
    nextAccessToken?: string;
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

      const updatedData = {
        ...data,
        refreshToken: input.nextRefreshToken,
        ...(input.nextAccessToken ? { accessToken: input.nextAccessToken } : {}),
      };
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
