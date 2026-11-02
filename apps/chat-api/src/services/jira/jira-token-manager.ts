import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import type { JiraOAuthClient, JiraTokensResult } from './jira-oauth-client.js';
import type { JiraOAuthRepo } from '../../db/repositories/jira-oauth-repo.js';

export class JiraTokenManagerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 403
  ) {
    super(`${code}: ${message}`);
    this.name = 'JiraTokenManagerError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export { JiraTokenManagerError as JiraTokenError };

export interface JiraTokenManagerOptions {
  pool: pg.Pool;
  client: JiraOAuthClient;
  repo?: JiraOAuthRepo;
  encryptionKey: string;
  refreshTimeoutMs?: number;
  onReconnectRequired?: (accountId: string) => void;
}

export interface GetAccessTokenOptions {
  signal?: AbortSignal;
  forceRefresh?: boolean;
}

export class JiraTokenManager {
  private readonly pool: pg.Pool;
  private readonly client: JiraOAuthClient;
  private readonly repo?: JiraOAuthRepo;
  private readonly encryptionKey: string;
  private readonly refreshTimeoutMs: number;
  private readonly onReconnectRequired?: (accountId: string) => void;

  // Single-flight promise map per user in this process instance
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(options: JiraTokenManagerOptions) {
    this.pool = options.pool;
    this.client = options.client;
    this.repo = options.repo;
    this.encryptionKey = options.encryptionKey;
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? 10_000;
    this.onReconnectRequired = options.onReconnectRequired;
  }

  clear(userId?: string): void {
    if (userId) {
      this.inFlight.delete(userId);
    } else {
      this.inFlight.clear();
    }
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new Error('Aborted'));
    }
    return new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const onAbort = () => {
        if (timer) clearTimeout(timer);
        reject(signal?.reason ?? new Error('Aborted'));
      };
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      timer = setTimeout(() => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        resolve();
      }, ms);
    });
  }

  private raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(signal.reason ?? new Error('Request was aborted'));
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(signal.reason ?? new Error('Request was aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (res) => {
          signal.removeEventListener('abort', onAbort);
          resolve(res);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  }

  async getValidAccessToken(userId: string, options?: GetAccessTokenOptions): Promise<string> {
    return this.getAccessToken(userId, options);
  }

  private async markGrantDecryptFailed(
    grantId: string,
    accountId?: string,
    client?: pg.PoolClient
  ): Promise<never> {
    const executor = client ?? this.pool;
    await executor
      .query(
        `UPDATE jira_oauth_grants
         SET status = 'reconnect_required',
             status_reason = 'TOKEN_DECRYPT_FAILED',
             encrypted_access_token = NULL,
             encrypted_refresh_token = NULL,
             refresh_state = 'idle',
             refresh_attempt_id = NULL,
             updated_at = clock_timestamp()
         WHERE id = $1 AND status = 'active'`,
        [grantId]
      )
      .catch(() => null);
    if (client) {
      await client.query('COMMIT').catch(() => {});
    }
    if (accountId && this.onReconnectRequired) {
      this.onReconnectRequired(accountId);
    }
    throw new JiraTokenManagerError(
      'TOKEN_REFRESH_FAILED',
      'Failed to decrypt Jira OAuth token; reconnect required',
      403
    );
  }

  async getAccessToken(userId: string, options?: GetAccessTokenOptions): Promise<string> {
    if (!userId || !userId.trim()) {
      throw new JiraTokenManagerError('INVALID_INPUT', 'userId is required', 400);
    }

    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new Error('Request was aborted');
    }

    // 1. Check current grant status from PostgreSQL
    const statusRes = await this.pool.query<{
      account_id: string;
      account_status: string;
      identity_version: number;
      grant_id: string | null;
      grant_status: string | null;
      status_reason: string | null;
      encrypted_access_token: string | null;
      encrypted_refresh_token: string | null;
      token_version: number | null;
      expires_at: Date | null;
      refresh_state: string | null;
      refresh_attempt_id: string | null;
      refresh_started_at: Date | null;
    }>(
      `SELECT
         a.id AS account_id,
         a.status AS account_status,
         a.identity_version,
         g.id AS grant_id,
         g.status AS grant_status,
         g.status_reason,
         g.encrypted_access_token,
         g.encrypted_refresh_token,
         g.token_version,
         g.expires_at,
         g.refresh_state,
         g.refresh_attempt_id,
         g.refresh_started_at
       FROM jira_accounts a
       LEFT JOIN jira_oauth_grants g ON g.account_id = a.id
       WHERE a.user_id = $1
       ORDER BY
         CASE WHEN a.status = 'connected' THEN 0 ELSE 1 END,
         CASE
           WHEN g.status = 'active' THEN 0
           WHEN g.status = 'reconnect_required' THEN 1
           ELSE 2
         END,
         g.created_at DESC
       LIMIT 1`,
      [userId]
    );

    const row = statusRes.rows[0];
    if (!row) {
      throw new JiraTokenManagerError('ACCOUNT_NOT_FOUND', 'No Jira account found for user', 404);
    }

    if (row.account_status !== 'connected') {
      throw new JiraTokenManagerError('ACCOUNT_DISCONNECTED', 'Jira account is disconnected', 403);
    }

    const grantId = row.grant_id;
    if (!grantId || row.grant_status === 'revoked') {
      throw new JiraTokenManagerError('GRANT_REVOKED', 'Jira grant is revoked or not found', 403);
    }

    if (row.grant_status === 'reconnect_required') {
      throw new JiraTokenManagerError(
        'RECONNECT_REQUIRED',
        `Jira grant requires reconnect: ${row.status_reason ?? 'reconnect_required'}`,
        403
      );
    }

    // 2. If unexpired and idle, return directly from storage (unless forceRefresh)
    const isExpired = !row.expires_at || new Date(row.expires_at).getTime() <= Date.now() + 60_000;
    if (!options?.forceRefresh && !isExpired && row.refresh_state === 'idle' && row.encrypted_access_token) {
      try {
        const dec = decryptCredentials<{ token: string }>(row.encrypted_access_token, this.encryptionKey);
        return dec.token;
      } catch (err: any) {
        console.warn('[jira-token-manager] Failed to decrypt cached Jira access token', {
          userId,
          grantId,
          error: err?.message,
        });
        return await this.markGrantDecryptFailed(grantId, row.account_id);
      }
    }

    // 3. Single-flight check in current process
    const existingInFlight = this.inFlight.get(userId);
    if (existingInFlight && !options?.forceRefresh) {
      if (options?.signal) {
        return await this.raceWithSignal(existingInFlight, options.signal);
      }
      return await existingInFlight;
    }

    // 4. Multi-process coordinated refresh
    const refreshTask = this.coordinateAndRefresh(
      userId,
      grantId,
      row.token_version ?? 1,
      options?.forceRefresh ?? false,
      options?.signal
    );

    this.inFlight.set(userId, refreshTask);
    const cleanup = () => {
      if (this.inFlight.get(userId) === refreshTask) {
        this.inFlight.delete(userId);
      }
    };
    refreshTask.finally(cleanup).catch(() => {});

    if (options?.signal) {
      return await this.raceWithSignal(refreshTask, options.signal);
    }
    return await refreshTask;
  }

  private async coordinateAndRefresh(
    userId: string,
    grantId: string,
    initialVersion: number,
    forceRefresh: boolean,
    callerSignal?: AbortSignal
  ): Promise<string> {
    const client = await this.pool.connect();
    let clientReleased = false;
    const releaseClient = () => {
      if (!clientReleased) {
        clientReleased = true;
        client.release();
      }
    };

    let attemptId: string;
    let rawRefreshToken: string;
    let accountId: string;

    try {
      await client.query('BEGIN');

      const lockRes = await client.query<{
        account_id: string;
        account_status: string;
        identity_version: number;
        grant_id: string;
        grant_status: string;
        refresh_state: string;
        refresh_attempt_id: string | null;
        refresh_started_at: Date | null;
        token_version: number;
        expires_at: Date | null;
        encrypted_refresh_token: string | null;
        encrypted_access_token: string | null;
      }>(
        `SELECT
           a.id as account_id,
           a.status as account_status,
           a.identity_version,
           g.id as grant_id,
           g.status as grant_status,
           g.refresh_state,
           g.refresh_attempt_id,
           g.refresh_started_at,
           g.token_version,
           g.expires_at,
           g.encrypted_refresh_token,
           g.encrypted_access_token
         FROM jira_oauth_grants g
         JOIN jira_accounts a ON a.id = g.account_id
         WHERE a.user_id = $1 AND g.id = $2
         FOR UPDATE OF g`,
        [userId, grantId]
      );

      const row = lockRes.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        throw new JiraTokenManagerError('GRANT_NOT_FOUND', 'Grant not found', 404);
      }

      accountId = row.account_id;

      if (row.account_status !== 'connected' || row.grant_status === 'revoked') {
        await client.query('ROLLBACK');
        throw new JiraTokenManagerError('ACCOUNT_DISCONNECTED', 'Jira account is disconnected or revoked', 403);
      }

      if (row.grant_status === 'reconnect_required') {
        await client.query('ROLLBACK');
        throw new JiraTokenManagerError('RECONNECT_REQUIRED', 'Jira grant requires reconnect', 403);
      }

      // Check if another worker already completed refresh
      if (
        !forceRefresh &&
        row.token_version > initialVersion &&
        row.refresh_state === 'idle' &&
        row.encrypted_access_token
      ) {
        await client.query('COMMIT');
        releaseClient();
        try {
          const dec = decryptCredentials<{ token: string }>(row.encrypted_access_token, this.encryptionKey);
          return dec.token;
        } catch (err: any) {
          console.warn('[jira-token-manager] Failed to decrypt refreshed Jira access token', {
            userId,
            grantId,
            error: err?.message,
          });
          return await this.markGrantDecryptFailed(grantId, accountId);
        }
      }

      // Check if refresh is already in-flight by another worker process
      if (row.refresh_state === 'refreshing') {
        const startedAt = row.refresh_started_at ? new Date(row.refresh_started_at).getTime() : 0;
        const elapsed = Date.now() - startedAt;

        if (elapsed >= this.refreshTimeoutMs) {
          // Stale/orphaned intent from crashed worker -> fail closed, never replay old token
          const updateRes = await client.query(
            `UPDATE jira_oauth_grants
             SET status = 'reconnect_required',
                 status_reason = 'CRASH_UNKNOWN_ROTATION',
                 encrypted_access_token = NULL,
                 encrypted_refresh_token = NULL,
                 refresh_state = 'idle',
                 refresh_attempt_id = NULL,
                 updated_at = clock_timestamp()
             WHERE id = $1 AND status = 'active'`,
            [grantId]
          );
          await client.query('COMMIT');
          releaseClient();

          if (updateRes.rowCount === 0) {
            throw new JiraTokenManagerError(
              'ACCOUNT_DISCONNECTED',
              'Connection was disconnected or revoked',
              403
            );
          }

          if (this.onReconnectRequired) {
            this.onReconnectRequired(accountId);
          }

          throw new JiraTokenManagerError(
            'RECONNECT_REQUIRED',
            'Refresh intent timed out or worker crashed; reconnect required (CRASH_UNKNOWN_ROTATION)',
            403
          );
        }

        // Another active worker is currently refreshing -> release DB lock and poll
        await client.query('COMMIT');
        releaseClient();

        return await this.pollForRefresh(userId, grantId, initialVersion, callerSignal, accountId);
      }

      // refresh_state is 'idle' -> We become the refreshing worker!
      if (!row.encrypted_refresh_token) {
        const updateRes = await client.query(
          `UPDATE jira_oauth_grants
           SET status = 'reconnect_required',
               status_reason = 'NO_REFRESH_TOKEN',
               encrypted_access_token = NULL,
               encrypted_refresh_token = NULL,
               refresh_state = 'idle',
               refresh_attempt_id = NULL,
               updated_at = clock_timestamp()
           WHERE id = $1 AND status = 'active'`,
          [grantId]
        );
        await client.query('COMMIT');
        releaseClient();

        if (updateRes.rowCount === 0) {
          throw new JiraTokenManagerError(
            'ACCOUNT_DISCONNECTED',
            'Connection was disconnected or revoked',
            403
          );
        }

        if (this.onReconnectRequired) {
          this.onReconnectRequired(accountId);
        }

        throw new JiraTokenManagerError(
          'RECONNECT_REQUIRED',
          'No refresh token available; reconnect required',
          403
        );
      }

      attemptId = randomUUID();
      try {
        rawRefreshToken = decryptCredentials<{ token: string }>(
          row.encrypted_refresh_token,
          this.encryptionKey
        ).token;
      } catch (err: any) {
        console.warn('[jira-token-manager] Failed to decrypt Jira refresh token', {
          userId,
          grantId,
          error: err?.message,
        });
        return await this.markGrantDecryptFailed(grantId, accountId, client);
      }

      // Commit intent to database before making network call
      await client.query(
        `UPDATE jira_oauth_grants
         SET refresh_state = 'refreshing',
             refresh_attempt_id = $1,
             refresh_started_at = clock_timestamp(),
             updated_at = clock_timestamp()
         WHERE id = $2`,
        [attemptId, grantId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      releaseClient();
    }

    // --- Outbound Network Call (NO DB lock or connection held) ---
    let tokens: JiraTokensResult;
    let timedOut = false;
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(new Error(`Refresh request timed out after ${this.refreshTimeoutMs}ms`));
    }, this.refreshTimeoutMs);

    try {
      tokens = await this.client.refreshToken(rawRefreshToken, timeoutController.signal);
    } catch (httpErr: unknown) {
      clearTimeout(timer);

      const err = httpErr as { code?: string; message?: string; name?: string } | undefined;
      const isTimeout = timedOut || err?.code === 'PROVIDER_TIMEOUT' || err?.message?.includes('timed out');
      const reason = err?.message?.includes('invalid_grant')
        ? 'invalid_grant'
        : isTimeout
          ? 'REFRESH_TIMEOUT'
          : 'CRASH_UNKNOWN_ROTATION';

      const failRes = await this.pool.query(
        `UPDATE jira_oauth_grants
         SET status = 'reconnect_required',
             status_reason = $1,
             encrypted_access_token = NULL,
             encrypted_refresh_token = NULL,
             refresh_state = 'idle',
             refresh_attempt_id = NULL,
             updated_at = clock_timestamp()
         WHERE id = $2
           AND refresh_attempt_id = $3
           AND status = 'active'`,
        [reason, grantId, attemptId]
      ).catch(() => null);

      if (!failRes || failRes.rowCount === 0) {
        // Disconnect Wins: grant was revoked while HTTP was in-flight!
        // Never overwrite revoked, do NOT fire onReconnectRequired
        throw new JiraTokenManagerError(
          'ACCOUNT_DISCONNECTED',
          'Connection was disconnected or grant revoked while refresh was in flight',
          403
        );
      }

      if (this.onReconnectRequired) {
        this.onReconnectRequired(accountId);
      }

      const errMsg = err?.message ?? 'Unknown error';
      throw new JiraTokenManagerError(
        'RECONNECT_REQUIRED',
        `Token refresh failed (${reason}): ${errMsg}; reconnect required`,
        403
      );
    } finally {
      clearTimeout(timer);
    }

    // Rotating refresh token check
    if (!tokens.refreshToken || !tokens.refreshToken.trim()) {
      const missingRes = await this.pool.query(
        `UPDATE jira_oauth_grants
         SET status = 'reconnect_required',
             status_reason = 'MISSING_ROTATING_TOKEN',
             encrypted_access_token = NULL,
             encrypted_refresh_token = NULL,
             refresh_state = 'idle',
             refresh_attempt_id = NULL,
             updated_at = clock_timestamp()
         WHERE id = $1
           AND refresh_attempt_id = $2
           AND status = 'active'`,
        [grantId, attemptId]
      ).catch(() => null);

      if (!missingRes || missingRes.rowCount === 0) {
        // Disconnect Wins: grant was revoked while HTTP was in-flight!
        throw new JiraTokenManagerError(
          'ACCOUNT_DISCONNECTED',
          'Connection was disconnected or grant revoked while refresh was in flight',
          403
        );
      }

      if (this.onReconnectRequired) {
        this.onReconnectRequired(accountId);
      }

      throw new JiraTokenManagerError(
        'RECONNECT_REQUIRED',
        'Provider did not return a rotating refresh token; reconnect required',
        403
      );
    }

    // Compare-and-Swap commit in database
    const newEncryptedAccess = encryptCredentials({ token: tokens.accessToken }, this.encryptionKey);
    const newEncryptedRefresh = encryptCredentials({ token: tokens.refreshToken }, this.encryptionKey);
    const newExpiresAt = new Date(Date.now() + Math.max(0, tokens.expiresInSeconds) * 1000);

    const casRes = await this.pool.query(
      `UPDATE jira_oauth_grants
       SET encrypted_access_token = $1,
           encrypted_refresh_token = $2,
           token_version = token_version + 1,
           expires_at = $3,
           refresh_state = 'idle',
           refresh_attempt_id = NULL,
           status_reason = NULL,
           updated_at = clock_timestamp()
       WHERE id = $4
         AND refresh_attempt_id = $5
         AND status = 'active'`,
      [newEncryptedAccess, newEncryptedRefresh, newExpiresAt, grantId, attemptId]
    );

    if (casRes.rowCount === 0) {
      // Disconnect Wins: grant was revoked/disconnected while refresh was in-flight
      // New tokens are discarded
      throw new JiraTokenManagerError(
        'ACCOUNT_DISCONNECTED',
        'Connection was disconnected or grant revoked while refresh was in flight',
        403
      );
    }

    return tokens.accessToken;
  }

  private async pollForRefresh(
    userId: string,
    grantId: string,
    initialVersion: number,
    signal?: AbortSignal,
    accountId?: string
  ): Promise<string> {
    const pollIntervalMs = 50;
    const deadline = Date.now() + this.refreshTimeoutMs;

    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw signal.reason ?? new Error('Polling was aborted');
      }

      await this.sleep(pollIntervalMs, signal);

      if (signal?.aborted) {
        throw signal.reason ?? new Error('Polling was aborted');
      }

      const res = await this.pool.query<{
        account_id: string;
        account_status: string;
        grant_status: string;
        refresh_state: string;
        token_version: number;
        encrypted_access_token: string | null;
      }>(
        `SELECT
           a.id as account_id,
           a.status as account_status,
           g.status as grant_status,
           g.refresh_state,
           g.token_version,
           g.encrypted_access_token
         FROM jira_oauth_grants g
         JOIN jira_accounts a ON a.id = g.account_id
         WHERE a.user_id = $1 AND g.id = $2`,
        [userId, grantId]
      );

      const row = res.rows[0];
      if (!row) {
        throw new JiraTokenManagerError('GRANT_NOT_FOUND', 'Grant not found', 404);
      }

      if (row.account_status !== 'connected' || row.grant_status === 'revoked') {
        throw new JiraTokenManagerError('ACCOUNT_DISCONNECTED', 'Jira account is disconnected or revoked', 403);
      }

      if (row.grant_status === 'reconnect_required') {
        throw new JiraTokenManagerError('RECONNECT_REQUIRED', 'Jira grant requires reconnect', 403);
      }

      if (
        (row.token_version > initialVersion || row.refresh_state === 'idle') &&
        row.encrypted_access_token
      ) {
        try {
          const dec = decryptCredentials<{ token: string }>(row.encrypted_access_token, this.encryptionKey);
          return dec.token;
        } catch (err: any) {
          console.warn('[jira-token-manager] Failed to decrypt polled Jira access token', {
            userId,
            grantId,
            error: err?.message,
          });
          return await this.markGrantDecryptFailed(grantId, accountId);
        }
      }
    }

    // Polling timeout waiting for Worker 1 -> fail closed
    const pollTimeoutRes = await this.pool.query(
      `UPDATE jira_oauth_grants
       SET status = 'reconnect_required',
           status_reason = 'CRASH_UNKNOWN_ROTATION',
           encrypted_access_token = NULL,
           encrypted_refresh_token = NULL,
           refresh_state = 'idle',
           refresh_attempt_id = NULL,
           updated_at = clock_timestamp()
       WHERE id = $1
         AND refresh_state = 'refreshing'
         AND status = 'active'`,
      [grantId]
    ).catch(() => null);

    if (!pollTimeoutRes || pollTimeoutRes.rowCount === 0) {
      throw new JiraTokenManagerError(
        'ACCOUNT_DISCONNECTED',
        'Connection was disconnected or grant revoked while polling for refresh',
        403
      );
    }

    if (this.onReconnectRequired && accountId) {
      this.onReconnectRequired(accountId);
    }

    throw new JiraTokenManagerError(
      'RECONNECT_REQUIRED',
      'Timed out waiting for concurrent token refresh; reconnect required (CRASH_UNKNOWN_ROTATION)',
      403
    );
  }
}
