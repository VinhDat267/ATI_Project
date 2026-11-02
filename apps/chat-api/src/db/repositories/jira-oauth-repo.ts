import type pg from 'pg';
import { encryptCredentials, decryptCredentials } from '@wap/tool-adapters';
import type { JiraConnectionState, JiraConnectionStatusResponse } from '@wap/tool-schemas';

export interface JiraAccountRow {
  id: string;
  user_id: string;
  atlassian_account_id: string;
  display_name: string | null;
  status: 'connected' | 'disconnected';
  identity_version: number;
  created_at: Date;
  updated_at: Date;
}

export interface JiraOAuthGrantRow {
  id: string;
  account_id: string;
  app_client_id: string;
  grant_kind: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  scopes: string[];
  token_version: number;
  expires_at: Date | null;
  refresh_state: 'idle' | 'refreshing' | 'failed';
  status: 'active' | 'reconnect_required' | 'revoked';
  status_reason: string | null;
  refresh_attempt_id: string | null;
  refresh_started_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class JiraOAuthRepoError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(`${code}: ${message}`);
    this.name = 'JiraOAuthRepoError';
  }
}

export function deduplicateSites(
  sites: Array<{ id: string; name: string; url: string; scopes: string[] }>
): Array<{ id: string; name: string; url: string; scopes: string[] }> {
  const map = new Map<string, { id: string; name: string; url: string; scopes: string[] }>();
  for (const site of sites) {
    const existing = map.get(site.id);
    if (!existing) {
      map.set(site.id, site);
    } else {
      const sameName = existing.name === site.name;
      const sameUrl = existing.url === site.url;
      const sortedExisting = [...existing.scopes].sort();
      const sortedNew = [...site.scopes].sort();
      const sameScopes =
        sortedExisting.length === sortedNew.length &&
        sortedExisting.every((s, i) => s === sortedNew[i]);

      if (sameName && sameUrl && sameScopes) {
        // Exact identical duplicate -> deduplicate
        continue;
      }
      throw new JiraOAuthRepoError(
        400,
        'SITE_CONFLICT',
        `Conflicting site definitions for cloudId: ${site.id}`
      );
    }
  }
  return Array.from(map.values());
}

export class JiraOAuthRepo {
  constructor(
    private readonly pool: pg.Pool,
    private readonly encryptionKey: string
  ) {}

  async getAccountByUserId(userId: string): Promise<JiraAccountRow | null> {
    const res = await this.pool.query<JiraAccountRow>(
      `SELECT id, user_id, atlassian_account_id, display_name, status, identity_version, created_at, updated_at
       FROM jira_accounts
       WHERE user_id = $1
       ORDER BY CASE WHEN status = 'connected' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      [userId]
    );
    return res.rows[0] ?? null;
  }

  async getAccountByAtlassianId(atlassianAccountId: string): Promise<JiraAccountRow | null> {
    const res = await this.pool.query<JiraAccountRow>(
      `SELECT id, user_id, atlassian_account_id, display_name, status, identity_version, created_at, updated_at
       FROM jira_accounts
       WHERE atlassian_account_id = $1
       ORDER BY CASE WHEN status = 'connected' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      [atlassianAccountId]
    );
    return res.rows[0] ?? null;
  }

  async getActiveGrantByUserId(userId: string): Promise<JiraOAuthGrantRow | null> {
    const res = await this.pool.query<JiraOAuthGrantRow>(
      `SELECT g.*
       FROM jira_oauth_grants g
       JOIN jira_accounts a ON a.id = g.account_id
       WHERE a.user_id = $1 AND a.status = 'connected' AND g.status = 'active'
       ORDER BY g.created_at DESC
       LIMIT 1`,
      [userId]
    );
    return res.rows[0] ?? null;
  }

  async saveIdentityGrant(
    userId: string,
    data: {
      atlassianAccountId: string;
      displayName?: string;
      accessToken: string;
      refreshToken?: string;
      expiresInSeconds: number;
      scopes: string[];
    }
  ): Promise<{ accountId: string; grantId: string; connectionState: JiraConnectionState }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Advisory lock serialized per Atlassian account ID
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('jira_identity_' || $1))`,
        [data.atlassianAccountId]
      );

      // Check cross-user collision: another active user holding this Atlassian account
      const ownerRes = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM jira_accounts
         WHERE atlassian_account_id = $1 AND status = 'connected'`,
        [data.atlassianAccountId]
      );
      const existingOwner = ownerRes.rows[0];
      if (existingOwner && existingOwner.user_id !== userId) {
        throw new JiraOAuthRepoError(
          409,
          'ATLASSIAN_ACCOUNT_IN_USE',
          'Atlassian account is already bound to another active user'
        );
      }

      // Check current user: identity swap rejection if already connected to a different account
      const userRes = await client.query<{
        id: string;
        atlassian_account_id: string;
        status: string;
        identity_version: number;
      }>(
        `SELECT id, atlassian_account_id, status, identity_version
         FROM jira_accounts
         WHERE user_id = $1 AND status = 'connected'
         FOR UPDATE`,
        [userId]
      );
      const current = userRes.rows[0];
      if (current && current.atlassian_account_id !== data.atlassianAccountId) {
        throw new JiraOAuthRepoError(
          400,
          'ACCOUNT_CHANGED',
          'Cannot swap Atlassian account without disconnecting existing connection'
        );
      }

      // Upsert or insert account row
      let accountId: string;
      const existingRowRes = await client.query<{
        id: string;
        status: string;
        identity_version: number;
      }>(
        `SELECT id, status, identity_version
         FROM jira_accounts
         WHERE user_id = $1 AND atlassian_account_id = $2
         FOR UPDATE`,
        [userId, data.atlassianAccountId]
      );

      const existing = existingRowRes.rows[0];
      if (existing) {
        accountId = existing.id;
        if (existing.status !== 'connected') {
          await client.query(
            `UPDATE jira_accounts
             SET status = 'connected',
                 identity_version = identity_version + 1,
                 display_name = COALESCE($2, display_name),
                 updated_at = clock_timestamp()
             WHERE id = $1`,
            [accountId, data.displayName ?? null]
          );
        } else if (data.displayName) {
          await client.query(
            `UPDATE jira_accounts
             SET display_name = $2,
                 updated_at = clock_timestamp()
             WHERE id = $1`,
            [accountId, data.displayName]
          );
        }
      } else {
        const insertRes = await client.query<{ id: string }>(
          `INSERT INTO jira_accounts (user_id, atlassian_account_id, display_name, status, identity_version)
           VALUES ($1, $2, $3, 'connected', 1)
           RETURNING id`,
          [userId, data.atlassianAccountId, data.displayName ?? null]
        );
        const inserted = insertRes.rows[0];
        if (!inserted) {
          throw new JiraOAuthRepoError(500, 'INSERT_FAILED', 'Failed to insert Jira account');
        }
        accountId = inserted.id;
      }

      // Encrypt tokens
      const encryptedAccess = encryptCredentials({ token: data.accessToken }, this.encryptionKey);
      const encryptedRefresh = data.refreshToken
        ? encryptCredentials({ token: data.refreshToken }, this.encryptionKey)
        : null;
      const expiresAt = new Date(Date.now() + Math.max(0, data.expiresInSeconds) * 1000);

      // Revoke any previous active grants for this account
      await client.query(
        `UPDATE jira_oauth_grants
         SET status = 'revoked',
             updated_at = clock_timestamp()
         WHERE account_id = $1 AND status = 'active'`,
        [accountId]
      );

      // Insert new active grant
      const grantRes = await client.query<{ id: string }>(
        `INSERT INTO jira_oauth_grants (
           account_id, encrypted_access_token, encrypted_refresh_token,
           scopes, expires_at, status, refresh_state
         )
         VALUES ($1, $2, $3, $4, $5, 'active', 'idle')
         RETURNING id`,
        [accountId, encryptedAccess, encryptedRefresh, data.scopes, expiresAt]
      );
      const grantRow = grantRes.rows[0];
      if (!grantRow) {
        throw new JiraOAuthRepoError(500, 'INSERT_FAILED', 'Failed to insert Jira OAuth grant');
      }
      const grantId = grantRow.id;

      await client.query('COMMIT');
      return {
        accountId,
        grantId,
        connectionState: 'identity_connected',
      };
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (err?.code === '23505') {
        if (
          err.constraint === 'jira_accounts_atlassian_active_idx' ||
          err.message?.includes('jira_accounts_atlassian_active_idx')
        ) {
          throw new JiraOAuthRepoError(
            409,
            'ATLASSIAN_ACCOUNT_IN_USE',
            'Atlassian account is already bound to another active user'
          );
        }
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async saveSitesGrant(
    userId: string,
    data: {
      atlassianAccountId: string;
      accessToken: string;
      refreshToken?: string;
      expiresInSeconds: number;
      scopes: string[];
      sites: Array<{ id: string; name: string; url: string; scopes: string[] }>;
    }
  ): Promise<{ accountId: string; grantId: string; siteCount: number; connectionState: JiraConnectionState }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const accRes = await client.query<{ id: string; atlassian_account_id: string }>(
        `SELECT id, atlassian_account_id FROM jira_accounts
         WHERE user_id = $1 AND status = 'connected'
         FOR UPDATE`,
        [userId]
      );
      const account = accRes.rows[0];
      if (!account) {
        throw new JiraOAuthRepoError(403, 'ACCOUNT_NOT_CONNECTED', 'No connected Jira account');
      }
      if (account.atlassian_account_id !== data.atlassianAccountId) {
        throw new JiraOAuthRepoError(
          400,
          'ACCOUNT_CHANGED',
          'Returned Atlassian account does not match connected account'
        );
      }

      const dedupedSites = deduplicateSites(data.sites);

      const encryptedAccess = encryptCredentials({ token: data.accessToken }, this.encryptionKey);
      const encryptedRefresh = data.refreshToken
        ? encryptCredentials({ token: data.refreshToken }, this.encryptionKey)
        : null;
      const expiresAt = new Date(Date.now() + Math.max(0, data.expiresInSeconds) * 1000);

      const grantRes = await client.query<{ id: string }>(
        `SELECT id FROM jira_oauth_grants
         WHERE account_id = $1 AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [account.id]
      );

      let grantId: string;
      const existingGrant = grantRes.rows[0];
      if (existingGrant) {
        grantId = existingGrant.id;
        await client.query(
          `UPDATE jira_oauth_grants
           SET encrypted_access_token = $1,
               encrypted_refresh_token = COALESCE($2, encrypted_refresh_token),
               scopes = $3,
               expires_at = $4,
               status = 'active',
               status_reason = NULL,
               refresh_state = 'idle',
               updated_at = clock_timestamp()
           WHERE id = $5`,
          [encryptedAccess, encryptedRefresh, data.scopes, expiresAt, grantId]
        );
      } else {
        const newGrantRes = await client.query<{ id: string }>(
          `INSERT INTO jira_oauth_grants (
             account_id, encrypted_access_token, encrypted_refresh_token,
             scopes, expires_at, status, refresh_state
           )
           VALUES ($1, $2, $3, $4, $5, 'active', 'idle')
           RETURNING id`,
          [account.id, encryptedAccess, encryptedRefresh, data.scopes, expiresAt]
        );
        const newGrant = newGrantRes.rows[0];
        if (!newGrant) {
          throw new JiraOAuthRepoError(500, 'INSERT_FAILED', 'Failed to insert Jira OAuth grant');
        }
        grantId = newGrant.id;
      }

      // Snapshot sites
      if (dedupedSites.length === 0) {
        await client.query(`DELETE FROM jira_grant_sites WHERE grant_id = $1`, [grantId]);
      } else {
        const cloudIds = dedupedSites.map((s) => s.id);
        await client.query(
          `DELETE FROM jira_grant_sites WHERE grant_id = $1 AND NOT (cloud_id = ANY($2))`,
          [grantId, cloudIds]
        );
        for (const site of dedupedSites) {
          await client.query(
            `INSERT INTO jira_grant_sites (
               grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at
             )
             VALUES ($1, $2, $3, $4, 'jira', $5, clock_timestamp())
             ON CONFLICT (grant_id, cloud_id) DO UPDATE SET
               site_name = EXCLUDED.site_name,
               site_url = EXCLUDED.site_url,
               scopes = EXCLUDED.scopes,
               last_verified_at = clock_timestamp()`,
            [grantId, site.id, site.name, site.url, site.scopes]
          );
        }
      }

      await client.query('COMMIT');
      const connectionState: JiraConnectionState =
        dedupedSites.length > 0 ? 'connected' : 'identity_connected';
      return {
        accountId: account.id,
        grantId,
        siteCount: dedupedSites.length,
        connectionState,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async syncSites(
    userId: string,
    sites: Array<{ id: string; name: string; url: string; scopes: string[] }>
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const accRes = await client.query<{ id: string }>(
        `SELECT id FROM jira_accounts
         WHERE user_id = $1 AND status = 'connected'`,
        [userId]
      );
      const accRow = accRes.rows[0];
      if (!accRow) {
        throw new JiraOAuthRepoError(403, 'ACCOUNT_NOT_CONNECTED', 'No connected Jira account');
      }
      const accountId = accRow.id;

      const grantRes = await client.query<{ id: string }>(
        `SELECT id FROM jira_oauth_grants
         WHERE account_id = $1 AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [accountId]
      );
      const grantRow = grantRes.rows[0];
      if (!grantRow) {
        throw new JiraOAuthRepoError(403, 'GRANT_NOT_FOUND', 'No active Jira grant found');
      }
      const grantId = grantRow.id;

      const dedupedSites = deduplicateSites(sites);

      if (dedupedSites.length === 0) {
        await client.query(`DELETE FROM jira_grant_sites WHERE grant_id = $1`, [grantId]);
      } else {
        const cloudIds = dedupedSites.map((s) => s.id);
        await client.query(
          `DELETE FROM jira_grant_sites WHERE grant_id = $1 AND NOT (cloud_id = ANY($2))`,
          [grantId, cloudIds]
        );
        for (const site of dedupedSites) {
          await client.query(
            `INSERT INTO jira_grant_sites (
               grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at
             )
             VALUES ($1, $2, $3, $4, 'jira', $5, clock_timestamp())
             ON CONFLICT (grant_id, cloud_id) DO UPDATE SET
               site_name = EXCLUDED.site_name,
               site_url = EXCLUDED.site_url,
               scopes = EXCLUDED.scopes,
               last_verified_at = clock_timestamp()`,
            [grantId, site.id, site.name, site.url, site.scopes]
          );
        }
      }

      await client.query('COMMIT');
      return dedupedSites.length;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getConnectionStatus(userId: string): Promise<JiraConnectionStatusResponse> {
    const accRes = await this.pool.query<JiraAccountRow>(
      `SELECT id, user_id, atlassian_account_id, display_name, status, identity_version
       FROM jira_accounts
       WHERE user_id = $1
       ORDER BY CASE WHEN status = 'connected' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      [userId]
    );

    const account = accRes.rows[0];
    if (!account || account.status === 'disconnected') {
      return {
        connected: false,
        connectionState: 'disconnected',
        jiraAccountId: account ? account.id : null,
        atlassianAccountId: account ? account.atlassian_account_id : null,
        displayName: account?.display_name ?? undefined,
        sites: [],
      };
    }

    const grantRes = await this.pool.query<{
      id: string;
      status: string;
      encrypted_access_token?: string | null;
      encrypted_refresh_token?: string | null;
    }>(
      `SELECT id, status, encrypted_access_token, encrypted_refresh_token FROM jira_oauth_grants
       WHERE account_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [account.id]
    );

    const grant = grantRes.rows[0];
    if (!grant) {
      return {
        connected: true,
        connectionState: 'identity_connected',
        jiraAccountId: account.id,
        atlassianAccountId: account.atlassian_account_id,
        displayName: account.display_name ?? undefined,
        sites: [],
      };
    }

    let grantStatus = grant.status;
    if (grantStatus === 'active' && this.encryptionKey) {
      try {
        if (typeof grant.encrypted_access_token === 'string' && grant.encrypted_access_token) {
          decryptCredentials(grant.encrypted_access_token, this.encryptionKey);
        }
        if (typeof grant.encrypted_refresh_token === 'string' && grant.encrypted_refresh_token) {
          decryptCredentials(grant.encrypted_refresh_token, this.encryptionKey);
        }
      } catch (err: any) {
        console.warn('[jira-oauth-repo] Failed to decrypt stored Jira grant token; reporting reconnect_required', {
          userId,
          grantId: grant.id,
          error: err?.message,
        });
        grantStatus = 'reconnect_required';
      }
    }

    const sitesRes = await this.pool.query<{
      cloud_id: string;
      site_name: string;
      site_url: string;
      last_verified_at: Date;
    }>(
      `SELECT cloud_id, site_name, site_url, last_verified_at
       FROM jira_grant_sites
       WHERE grant_id = $1
       ORDER BY site_name ASC`,
      [grant.id]
    );

    const sites = sitesRes.rows.map((r) => ({
      cloudId: r.cloud_id,
      name: r.site_name,
      siteUrl: r.site_url,
      url: r.site_url,
      lastVerifiedAt: r.last_verified_at ? new Date(r.last_verified_at).toISOString() : undefined,
    }));

    let connectionState: JiraConnectionState;
    if (grantStatus === 'reconnect_required') {
      connectionState = 'reconnect_required';
    } else if (grantStatus === 'revoked') {
      connectionState = 'disconnected';
    } else if (sites.length > 0) {
      connectionState = 'connected';
    } else {
      connectionState = 'identity_connected';
    }

    return {
      connected: grantStatus !== 'revoked',
      connectionState,
      jiraAccountId: account.id,
      atlassianAccountId: account.atlassian_account_id,
      displayName: account.display_name ?? undefined,
      sites,
    };
  }

  async disconnect(
    userId: string
  ): Promise<{ disconnected: boolean; revokedAt: Date; identityVersion: number }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const accRes = await client.query<{ id: string; status: string; identity_version: number }>(
        `SELECT id, status, identity_version FROM jira_accounts
         WHERE user_id = $1 AND status = 'connected'
         FOR UPDATE`,
        [userId]
      );

      const account = accRes.rows[0];
      if (!account) {
        const latestRes = await client.query<{ identity_version: number }>(
          `SELECT identity_version FROM jira_accounts
           WHERE user_id = $1
           ORDER BY updated_at DESC
           LIMIT 1`,
          [userId]
        );
        const latestAccount = latestRes.rows[0];
        await client.query('COMMIT');
        return {
          disconnected: false,
          revokedAt: new Date(),
          identityVersion: latestAccount?.identity_version ?? 1,
        };
      }

      const nextVersion = account.identity_version + 1;
      const revokedAt = new Date();

      await client.query(
        `UPDATE jira_accounts
         SET status = 'disconnected',
             identity_version = $2,
             updated_at = clock_timestamp()
         WHERE id = $1`,
        [account.id, nextVersion]
      );

      await client.query(
        `UPDATE jira_oauth_grants
         SET status = 'revoked',
             encrypted_access_token = NULL,
             encrypted_refresh_token = NULL,
             refresh_state = 'idle',
             updated_at = clock_timestamp()
         WHERE account_id = $1 AND status != 'revoked'`,
        [account.id]
      );

      await client.query(
        `UPDATE jira_authorization_leases
         SET status = 'revoked', released_at = clock_timestamp()
         WHERE jira_account_id = $1 AND status = 'active'`,
        [account.id]
      );

      // Audit logging for active workspaces the user is a member of
      const wsRes = await client.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM ati_workspace_memberships
         WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );
      for (const ws of wsRes.rows) {
        await client.query(
          `INSERT INTO jira_authorization_audit (actor_id, workspace_id, action, decision, version, details)
           VALUES ($1, $2, 'disconnect', 'revoked', $3, '{"reason": "user_disconnect"}')`,
          [userId, ws.workspace_id, nextVersion]
        );
      }

      await client.query('COMMIT');
      return {
        disconnected: true,
        revokedAt,
        identityVersion: nextVersion,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
