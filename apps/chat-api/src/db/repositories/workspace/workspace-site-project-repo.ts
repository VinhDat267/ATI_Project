import type pg from 'pg';
import { isUuid } from '../uuid.js';
import { WorkspaceRepoError } from './errors.js';
import { withTransaction } from './transaction.js';
import { assertValidExpectedVersion } from './shared-auth.js';
import type {
  LinkWorkspaceSiteRequest,
  LinkWorkspaceSiteResponse,
  UpdateWorkspaceSiteRequest,
  UpdateWorkspaceSiteResponse,
  ConfigureWorkspaceProjectsRequest,
  ConfigureWorkspaceProjectsResponse,
  WorkspaceSiteItem,
  GetWorkspaceProjectsResponse,
  WorkspaceJiraCapabilitiesResponse,
} from '@wap/tool-schemas';

// ============================================================================
// Native Admin Verifier Interfaces (Exported Server-Side Contract)
// ============================================================================

export interface NativeAdminVerifierEvidence {
  actorId: string;
  localAccountId: string;
  atlassianAccountId: string;
  grantId: string;
  identityVersion: number;
  workspaceId: string;
  cloudId: string;
  operation: 'link_site' | 'activate_site' | 'configure_projects';
}

export type NativeAdminVerifierResult =
  | {
      status: 'granted';
      siteName: string;
      siteUrl: string;
      verifiedProjectIds: string[];
      verifiedProjects: Array<{ projectId: string; key: string; name: string }>;
    }
  | { status: 'denied'; reason?: string }
  | { status: 'unavailable'; reason?: string };

export interface NativeAdminVerifier {
  verifyAdminister(evidence: NativeAdminVerifierEvidence): Promise<NativeAdminVerifierResult>;
}

export interface WorkspaceSiteProjectRepoOptions {
  verifier?: NativeAdminVerifier;
}

// ============================================================================
// Input Validation Helpers
// ============================================================================

function assertValidCloudId(cloudId: unknown): string {
  if (typeof cloudId !== 'string' || !cloudId.trim() || cloudId.length > 255) {
    throw new WorkspaceRepoError(400, 'INVALID_CLOUD_ID', 'cloudId must be a non-empty string');
  }
  return cloudId.trim();
}

function assertValidProjectIds(selectedProjectIds: unknown): string[] {
  if (!Array.isArray(selectedProjectIds)) {
    throw new WorkspaceRepoError(400, 'INVALID_PROJECT_ID', 'selectedProjectIds must be an array');
  }
  if (selectedProjectIds.length > 100) {
    throw new WorkspaceRepoError(
      400,
      'EXCESSIVE_PROJECT_IDS',
      'selectedProjectIds cannot exceed 100 projects'
    );
  }
  const seen = new Set<string>();
  for (const id of selectedProjectIds) {
    if (typeof id !== 'string' || !/^[1-9][0-9]*$/.test(id)) {
      throw new WorkspaceRepoError(400, 'INVALID_PROJECT_ID', `Invalid project ID: ${String(id)}`);
    }
    if (seen.has(id)) {
      throw new WorkspaceRepoError(400, 'DUPLICATE_PROJECT_ID', `Duplicate project ID: ${id}`);
    }
    seen.add(id);
  }
  return selectedProjectIds;
}

function assertValidSiteUrl(urlStr: string): string {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new WorkspaceRepoError(
      503,
      'NATIVE_VERIFIER_UNAVAILABLE',
      'Verifier returned invalid siteUrl format'
    );
  }
  if (parsed.protocol !== 'https:') {
    throw new WorkspaceRepoError(
      503,
      'NATIVE_VERIFIER_UNAVAILABLE',
      'Verifier siteUrl must be HTTPS'
    );
  }
  if (parsed.username || parsed.password) {
    throw new WorkspaceRepoError(
      503,
      'NATIVE_VERIFIER_UNAVAILABLE',
      'Verifier siteUrl must not contain credentials'
    );
  }
  if (parsed.search || parsed.hash) {
    throw new WorkspaceRepoError(
      503,
      'NATIVE_VERIFIER_UNAVAILABLE',
      'Verifier siteUrl must not contain query or fragment'
    );
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith('.atlassian.net') && !hostname.endsWith('.jira.com')) {
    throw new WorkspaceRepoError(
      503,
      'NATIVE_VERIFIER_UNAVAILABLE',
      'Verifier siteUrl hostname must belong to Atlassian domain'
    );
  }
  return parsed.origin;
}

// ============================================================================
// Authority & Grant Lookup Helpers
// ============================================================================

interface ActorGrantTuple {
  localAccountId: string;
  atlassianAccountId: string;
  identityVersion: number;
  grantId: string;
  siteName: string;
  siteUrl: string;
}

async function assertActiveMember(
  poolOrClient: pg.Pool | pg.PoolClient,
  workspaceId: string,
  actorId: string
): Promise<{ role: string }> {
  if (!isUuid(workspaceId) || !isUuid(actorId)) {
    throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
  }

  const res = await poolOrClient.query(
    `SELECT m.role, m.status, w.status AS ws_status, u.status AS user_status
     FROM ati_workspaces w
     LEFT JOIN ati_workspace_memberships m
       ON m.workspace_id = w.id AND m.user_id = $2
     LEFT JOIN users u
       ON u.id = $2
     WHERE w.id = $1`,
    [workspaceId, actorId]
  );

  if (res.rowCount === 0 || res.rows[0].ws_status !== 'active') {
    throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
  }

  const row = res.rows[0];
  if (!row.role || row.status !== 'active' || row.user_status !== 'active') {
    // Outsider, pending, rejected, removed, or disabled user -> 404 Hidden Pattern
    throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
  }

  return { role: row.role };
}

async function assertAdminMemberPreCheck(
  poolOrClient: pg.Pool | pg.PoolClient,
  workspaceId: string,
  actorId: string
): Promise<void> {
  const { role } = await assertActiveMember(poolOrClient, workspaceId, actorId);
  if (role !== 'admin') {
    throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'Admin role required');
  }
}

async function fetchActorJiraGrantPreCheck(
  poolOrClient: pg.Pool | pg.PoolClient,
  actorId: string,
  cloudId: string
): Promise<ActorGrantTuple> {
  const accRes = await poolOrClient.query(
    `SELECT id, atlassian_account_id, status, identity_version
     FROM jira_accounts
     WHERE user_id = $1 AND status = 'connected'`,
    [actorId]
  );

  if (accRes.rowCount === 0) {
    throw new WorkspaceRepoError(403, 'ACCOUNT_NOT_CONNECTED', 'No connected Jira account');
  }
  const account = accRes.rows[0];

  const grantRes = await poolOrClient.query(
    `SELECT g.id AS grant_id, s.site_name, s.site_url
     FROM jira_oauth_grants g
     JOIN jira_grant_sites s ON s.grant_id = g.id
     WHERE g.account_id = $1
       AND s.cloud_id = $2
       AND s.product_type = 'jira'`,
    [account.id, cloudId]
  );

  if (grantRes.rowCount === 0) {
    throw new WorkspaceRepoError(403, 'GRANT_NOT_FOUND', 'No Jira grant found for cloudId');
  }

  const grant = grantRes.rows[0];
  return {
    localAccountId: account.id,
    atlassianAccountId: account.atlassian_account_id,
    identityVersion: account.identity_version,
    grantId: grant.grant_id,
    siteName: grant.site_name,
    siteUrl: grant.site_url,
  };
}

async function invokeVerifier(
  verifier: NativeAdminVerifier | undefined,
  evidence: NativeAdminVerifierEvidence
): Promise<{
  siteName: string;
  siteUrl: string;
  verifiedProjectIds: string[];
  verifiedProjects: Array<{ projectId: string; key: string; name: string }>;
}> {
  if (!verifier) {
    throw new WorkspaceRepoError(
      503,
      'NATIVE_VERIFIER_UNAVAILABLE',
      'Native admin verifier is unavailable'
    );
  }

  let result: NativeAdminVerifierResult;
  try {
    result = await verifier.verifyAdminister(evidence);
  } catch {
    throw new WorkspaceRepoError(
      503,
      'NATIVE_VERIFIER_UNAVAILABLE',
      'Native admin verifier unavailable'
    );
  }

  if (result.status === 'denied') {
    throw new WorkspaceRepoError(
      403,
      'UNVERIFIED_SITE_CANNOT_ACTIVATE',
      'Native admin permission denied'
    );
  }

  if (result.status === 'unavailable') {
    throw new WorkspaceRepoError(
      503,
      'NATIVE_VERIFIER_UNAVAILABLE',
      'Native admin verifier unavailable'
    );
  }

  if (result.status !== 'granted') {
    throw new WorkspaceRepoError(
      503,
      'NATIVE_VERIFIER_UNAVAILABLE',
      'Unknown verifier status'
    );
  }

  if (
    typeof result.siteName !== 'string' ||
    !result.siteName.trim() ||
    result.siteName.length > 255
  ) {
    throw new WorkspaceRepoError(
      503,
      'NATIVE_VERIFIER_UNAVAILABLE',
      'Invalid siteName returned by verifier'
    );
  }

  const validSiteUrl = assertValidSiteUrl(result.siteUrl);

  const verifiedProjectIds = Array.isArray(result.verifiedProjectIds)
    ? result.verifiedProjectIds
    : [];
  const verifiedProjects = Array.isArray(result.verifiedProjects)
    ? result.verifiedProjects
    : [];

  return {
    siteName: result.siteName.trim(),
    siteUrl: validSiteUrl,
    verifiedProjectIds,
    verifiedProjects,
  };
}

// ============================================================================
// Sub-Repository: WorkspaceSiteProjectRepo
// ============================================================================

export class WorkspaceSiteProjectRepo {
  constructor(
    private readonly pool: pg.Pool,
    private readonly options?: WorkspaceSiteProjectRepoOptions
  ) {}

  /**
   * Links a new Jira site to a workspace.
   * - Phase 1: Reads authority and captures exact evidence tuple outside transaction.
   * - Invokes verifier outside SQL locks.
   * - Phase 2: Locks workspace, actor membership, account, grant in deterministic hierarchy.
   * - Creates site with active = false.
   */
  async linkSite(
    workspaceId: string,
    actorId: string,
    req: LinkWorkspaceSiteRequest
  ): Promise<LinkWorkspaceSiteResponse> {
    if (!this.options?.verifier) {
      throw new WorkspaceRepoError(
        503,
        'NATIVE_VERIFIER_UNAVAILABLE',
        'Native admin verifier is not configured'
      );
    }

    const cloudId = assertValidCloudId(req?.cloudId);

    // Phase 1: Pre-check authority & capture tuple outside transaction
    await assertAdminMemberPreCheck(this.pool, workspaceId, actorId);
    const actorGrant = await fetchActorJiraGrantPreCheck(this.pool, actorId, cloudId);

    const existing = await this.pool.query(
      `SELECT id FROM ati_workspace_jira_sites WHERE workspace_id = $1 AND cloud_id = $2`,
      [workspaceId, cloudId]
    );
    if (existing.rowCount! > 0) {
      throw new WorkspaceRepoError(
        409,
        'SITE_ALREADY_LINKED',
        'Site is already linked to this workspace'
      );
    }

    const evidence: NativeAdminVerifierEvidence = {
      actorId,
      localAccountId: actorGrant.localAccountId,
      atlassianAccountId: actorGrant.atlassianAccountId,
      grantId: actorGrant.grantId,
      identityVersion: actorGrant.identityVersion,
      workspaceId,
      cloudId,
      operation: 'link_site',
    };

    // Invoke verifier outside transaction
    const verifierResult = await invokeVerifier(this.options.verifier, evidence);

    // Phase 2: Persistence transaction with locks
    return withTransaction(this.pool, async (client) => {
      // 1. Lock workspace
      const wsRes = await client.query(
        `SELECT id, status, version FROM ati_workspaces WHERE id = $1 FOR UPDATE`,
        [workspaceId]
      );
      if (wsRes.rowCount === 0 || wsRes.rows[0].status !== 'active') {
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      }

      // 2. Lock actor membership
      const memRes = await client.query(
        `SELECT role, status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
        [workspaceId, actorId]
      );
      if (memRes.rowCount === 0 || memRes.rows[0].status !== 'active') {
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      }
      if (memRes.rows[0].role !== 'admin') {
        throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'Admin role required');
      }

      // 3. Lock actor user FOR SHARE
      const userRes = await client.query(
        `SELECT id, status FROM users WHERE id = $1 FOR SHARE`,
        [actorId]
      );
      if (userRes.rowCount === 0 || userRes.rows[0].status !== 'active') {
        throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'Admin user not active');
      }

      // 4. Lock account (reassert owner, native identity, connected status, identityVersion)
      const accRes = await client.query(
        `SELECT id, status, identity_version FROM jira_accounts WHERE id = $1 AND user_id = $2 AND atlassian_account_id = $3 FOR UPDATE`,
        [actorGrant.localAccountId, actorId, actorGrant.atlassianAccountId]
      );
      if (
        accRes.rowCount === 0 ||
        accRes.rows[0].status !== 'connected' ||
        accRes.rows[0].identity_version !== actorGrant.identityVersion
      ) {
        throw new WorkspaceRepoError(
          403,
          'ACCOUNT_NOT_CONNECTED',
          'Account disconnected or changed'
        );
      }

      // 5. Lock grant and grant site (reassert product_type = 'jira')
      const grantRes = await client.query(
        `SELECT g.id FROM jira_oauth_grants g
         JOIN jira_grant_sites s ON s.grant_id = g.id
         WHERE g.id = $1 AND g.account_id = $2 AND s.cloud_id = $3 AND s.product_type = 'jira' FOR UPDATE`,
        [actorGrant.grantId, actorGrant.localAccountId, cloudId]
      );
      if (grantRes.rowCount === 0) {
        throw new WorkspaceRepoError(403, 'GRANT_NOT_FOUND', 'Grant not found');
      }

      // Re-check site not already linked under lock
      const checkRes = await client.query(
        `SELECT id FROM ati_workspace_jira_sites WHERE workspace_id = $1 AND cloud_id = $2`,
        [workspaceId, cloudId]
      );
      if (checkRes.rowCount! > 0) {
        throw new WorkspaceRepoError(
          409,
          'SITE_ALREADY_LINKED',
          'Site is already linked to this workspace'
        );
      }

      // Insert site row
      const insertRes = await client.query(
        `INSERT INTO ati_workspace_jira_sites
           (workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by, verified_admin_by, admin_verified_at)
         VALUES ($1, $2, $3, $4, false, 1, $5, $5, clock_timestamp())
         RETURNING id, workspace_id, cloud_id, site_name, site_url, active, policy_version`,
        [workspaceId, cloudId, verifierResult.siteName, verifierResult.siteUrl, actorId]
      );
      const siteRow = insertRes.rows[0];

      // Audit log
      await client.query(
        `INSERT INTO jira_authorization_audit
           (actor_id, workspace_id, site_id, action, decision, version, details)
         VALUES ($1, $2, $3, 'link_site', 'granted', 1, $4)`,
        [actorId, workspaceId, siteRow.id, JSON.stringify({ cloudId, active: false })]
      );

      return {
        site: {
          siteId: siteRow.id,
          cloudId: siteRow.cloud_id,
          name: siteRow.site_name,
          url: siteRow.site_url,
          active: siteRow.active,
          policyVersion: siteRow.policy_version,
        },
      };
    });
  }

  /**
   * Updates an existing Jira site policy (activate / deactivate).
   * - Deactivation: allowed without verifier for current active admin.
   * - Activation: verifier required outside transaction, re-validated in transaction.
   */
  async updateSite(
    workspaceId: string,
    actorId: string,
    siteId: string,
    req: UpdateWorkspaceSiteRequest
  ): Promise<UpdateWorkspaceSiteResponse> {
    assertValidExpectedVersion(req?.expectedPolicyVersion);
    if (typeof req?.active !== 'boolean') {
      throw new WorkspaceRepoError(400, 'INVALID_ACTIVE', 'active must be a boolean');
    }
    if (!isUuid(siteId)) {
      throw new WorkspaceRepoError(404, 'SITE_NOT_FOUND', 'Site not found');
    }

    const isDeactivation = req.active === false;

    if (!isDeactivation && !this.options?.verifier) {
      throw new WorkspaceRepoError(
        503,
        'NATIVE_VERIFIER_UNAVAILABLE',
        'Native admin verifier is not configured'
      );
    }

    // Phase 1: Pre-check authority outside transaction
    await assertAdminMemberPreCheck(this.pool, workspaceId, actorId);

    const sitePreRes = await this.pool.query(
      `SELECT id, cloud_id, site_name, site_url, active, policy_version
       FROM ati_workspace_jira_sites
       WHERE id = $1 AND workspace_id = $2`,
      [siteId, workspaceId]
    );
    if (sitePreRes.rowCount === 0) {
      throw new WorkspaceRepoError(404, 'SITE_NOT_FOUND', 'Site not found');
    }
    const preSite = sitePreRes.rows[0];

    if (preSite.policy_version !== req.expectedPolicyVersion) {
      throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Site policy version conflict');
    }

    let actorGrant: ActorGrantTuple | null = null;
    if (!isDeactivation) {
      actorGrant = await fetchActorJiraGrantPreCheck(this.pool, actorId, preSite.cloud_id);
      const evidence: NativeAdminVerifierEvidence = {
        actorId,
        localAccountId: actorGrant.localAccountId,
        atlassianAccountId: actorGrant.atlassianAccountId,
        grantId: actorGrant.grantId,
        identityVersion: actorGrant.identityVersion,
        workspaceId,
        cloudId: preSite.cloud_id,
        operation: 'activate_site',
      };
      await invokeVerifier(this.options?.verifier, evidence);
    }

    // Phase 2: Persistence transaction
    return withTransaction(this.pool, async (client) => {
      // 1. Lock workspace
      const wsRes = await client.query(
        `SELECT id, status, version FROM ati_workspaces WHERE id = $1 FOR UPDATE`,
        [workspaceId]
      );
      if (wsRes.rowCount === 0 || wsRes.rows[0].status !== 'active') {
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      }

      // 2. Lock actor membership
      const memRes = await client.query(
        `SELECT role, status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
        [workspaceId, actorId]
      );
      if (memRes.rowCount === 0 || memRes.rows[0].status !== 'active') {
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      }
      if (memRes.rows[0].role !== 'admin') {
        throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'Admin role required');
      }

      // 3. Lock actor user FOR SHARE
      const userRes = await client.query(
        `SELECT id, status FROM users WHERE id = $1 FOR SHARE`,
        [actorId]
      );
      if (userRes.rowCount === 0 || userRes.rows[0].status !== 'active') {
        throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'Admin user not active');
      }

      // 4. Lock account and grant if activation
      if (!isDeactivation && actorGrant) {
        const accRes = await client.query(
          `SELECT id, status, identity_version FROM jira_accounts WHERE id = $1 AND user_id = $2 AND atlassian_account_id = $3 FOR UPDATE`,
          [actorGrant.localAccountId, actorId, actorGrant.atlassianAccountId]
        );
        if (
          accRes.rowCount === 0 ||
          accRes.rows[0].status !== 'connected' ||
          accRes.rows[0].identity_version !== actorGrant.identityVersion
        ) {
          throw new WorkspaceRepoError(
            403,
            'ACCOUNT_NOT_CONNECTED',
            'Account disconnected or changed'
          );
        }

        const grantRes = await client.query(
          `SELECT g.id FROM jira_oauth_grants g
           JOIN jira_grant_sites s ON s.grant_id = g.id
           WHERE g.id = $1 AND g.account_id = $2 AND s.cloud_id = $3 AND s.product_type = 'jira' FOR UPDATE`,
          [actorGrant.grantId, actorGrant.localAccountId, preSite.cloud_id]
        );
        if (grantRes.rowCount === 0) {
          throw new WorkspaceRepoError(403, 'GRANT_NOT_FOUND', 'Grant not found');
        }
      }

      // 5. Lock site
      const siteRes = await client.query(
        `SELECT id, active, policy_version FROM ati_workspace_jira_sites WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [siteId, workspaceId]
      );
      if (siteRes.rowCount === 0) {
        throw new WorkspaceRepoError(404, 'SITE_NOT_FOUND', 'Site not found');
      }
      const lockedSite = siteRes.rows[0];

      if (lockedSite.policy_version !== req.expectedPolicyVersion) {
        throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Site policy version conflict');
      }

      // 5. Update site
      const updateRes = await client.query(
        `UPDATE ati_workspace_jira_sites
         SET active = $1,
             policy_version = policy_version + 1,
             verified_admin_by = CASE WHEN $1 = true THEN $2 ELSE verified_admin_by END,
             admin_verified_at = CASE WHEN $1 = true THEN clock_timestamp() ELSE admin_verified_at END,
             updated_at = clock_timestamp()
         WHERE id = $3 AND policy_version = $4
         RETURNING id, workspace_id, cloud_id, site_name, site_url, active, policy_version`,
        [req.active, actorId, siteId, req.expectedPolicyVersion]
      );
      if (updateRes.rowCount === 0) {
        throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Site policy version conflict');
      }
      const updatedSite = updateRes.rows[0];

      // 6. Audit log
      const action = req.active ? 'activate_site' : 'deactivate_site';
      await client.query(
        `INSERT INTO jira_authorization_audit
           (actor_id, workspace_id, site_id, action, decision, version, details)
         VALUES ($1, $2, $3, $4, 'granted', $5, $6)`,
        [
          actorId,
          workspaceId,
          siteId,
          action,
          updatedSite.policy_version,
          JSON.stringify({
            active: req.active,
            previousPolicyVersion: req.expectedPolicyVersion,
          }),
        ]
      );

      return {
        site: {
          siteId: updatedSite.id,
          cloudId: updatedSite.cloud_id,
          name: updatedSite.site_name,
          url: updatedSite.site_url,
          active: updatedSite.active,
          policyVersion: updatedSite.policy_version,
        },
      };
    });
  }

  /**
   * Configures selected projects for a workspace Jira site.
   * - Enforces numeric IDs, bounds, duplicate checks, empty selection safe removal.
   * - Verifies selected IDs belong to verified set and maps trusted labels.
   * - Increments site version and changed project policy versions independently.
   */
  async configureProjects(
    workspaceId: string,
    actorId: string,
    siteId: string,
    req: ConfigureWorkspaceProjectsRequest
  ): Promise<ConfigureWorkspaceProjectsResponse> {
    assertValidExpectedVersion(req?.expectedPolicyVersion);
    const selectedIds = assertValidProjectIds(req?.selectedProjectIds);
    if (!isUuid(siteId)) {
      throw new WorkspaceRepoError(404, 'SITE_NOT_FOUND', 'Site not found');
    }

    if (!this.options?.verifier) {
      throw new WorkspaceRepoError(
        503,
        'NATIVE_VERIFIER_UNAVAILABLE',
        'Native admin verifier is not configured'
      );
    }

    // Phase 1: Pre-check authority outside transaction
    await assertAdminMemberPreCheck(this.pool, workspaceId, actorId);

    const sitePreRes = await this.pool.query(
      `SELECT id, cloud_id, policy_version
       FROM ati_workspace_jira_sites
       WHERE id = $1 AND workspace_id = $2`,
      [siteId, workspaceId]
    );
    if (sitePreRes.rowCount === 0) {
      throw new WorkspaceRepoError(404, 'SITE_NOT_FOUND', 'Site not found');
    }
    const preSite = sitePreRes.rows[0];

    if (preSite.policy_version !== req.expectedPolicyVersion) {
      throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Site policy version conflict');
    }

    const actorGrant = await fetchActorJiraGrantPreCheck(this.pool, actorId, preSite.cloud_id);

    const evidence: NativeAdminVerifierEvidence = {
      actorId,
      localAccountId: actorGrant.localAccountId,
      atlassianAccountId: actorGrant.atlassianAccountId,
      grantId: actorGrant.grantId,
      identityVersion: actorGrant.identityVersion,
      workspaceId,
      cloudId: preSite.cloud_id,
      operation: 'configure_projects',
    };

    const verifierResult = await invokeVerifier(this.options.verifier, evidence);

    // Validate that all selected IDs belong to verified set AND have metadata in verifiedProjects
    const verifiedSet = new Set(verifierResult.verifiedProjectIds);
    const trustedMap = new Map<string, { key: string; name: string }>();
    for (const p of verifierResult.verifiedProjects) {
      if (
        p &&
        typeof p.projectId === 'string' &&
        typeof p.key === 'string' &&
        typeof p.name === 'string'
      ) {
        trustedMap.set(p.projectId, { key: p.key.trim(), name: p.name.trim() });
      }
    }

    for (const projId of selectedIds) {
      if (!verifiedSet.has(projId) || !trustedMap.has(projId)) {
        throw new WorkspaceRepoError(
          403,
          'PROJECT_NOT_VERIFIED',
          `Project ID ${projId} is not verified`
        );
      }
    }

    // Phase 2: Persistence transaction
    return withTransaction(this.pool, async (client) => {
      // 1. Lock workspace FIRST
      const wsRes = await client.query(
        `SELECT id, status, version FROM ati_workspaces WHERE id = $1 FOR UPDATE`,
        [workspaceId]
      );
      if (wsRes.rowCount === 0 || wsRes.rows[0].status !== 'active') {
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      }

      // 2. Lock actor membership
      const memRes = await client.query(
        `SELECT role, status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
        [workspaceId, actorId]
      );
      if (memRes.rowCount === 0 || memRes.rows[0].status !== 'active') {
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      }
      if (memRes.rows[0].role !== 'admin') {
        throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'Admin role required');
      }

      // 3. Lock actor user FOR SHARE
      const userRes = await client.query(
        `SELECT id, status FROM users WHERE id = $1 FOR SHARE`,
        [actorId]
      );
      if (userRes.rowCount === 0 || userRes.rows[0].status !== 'active') {
        throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'Admin user not active');
      }

      // 4. Lock account (reassert owner, native identity, connected status, identityVersion)
      const accRes = await client.query(
        `SELECT id, status, identity_version FROM jira_accounts WHERE id = $1 AND user_id = $2 AND atlassian_account_id = $3 FOR UPDATE`,
        [actorGrant.localAccountId, actorId, actorGrant.atlassianAccountId]
      );
      if (
        accRes.rowCount === 0 ||
        accRes.rows[0].status !== 'connected' ||
        accRes.rows[0].identity_version !== actorGrant.identityVersion
      ) {
        throw new WorkspaceRepoError(
          403,
          'ACCOUNT_NOT_CONNECTED',
          'Account disconnected or changed'
        );
      }

      // Lock grant (reassert product_type = 'jira')
      const grantRes = await client.query(
        `SELECT g.id FROM jira_oauth_grants g
         JOIN jira_grant_sites s ON s.grant_id = g.id
         WHERE g.id = $1 AND g.account_id = $2 AND s.cloud_id = $3 AND s.product_type = 'jira' FOR UPDATE`,
        [actorGrant.grantId, actorGrant.localAccountId, preSite.cloud_id]
      );
      if (grantRes.rowCount === 0) {
        throw new WorkspaceRepoError(403, 'GRANT_NOT_FOUND', 'Grant not found');
      }

      // 5. Lock site
      const siteRes = await client.query(
        `SELECT id, active, policy_version, cloud_id FROM ati_workspace_jira_sites WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [siteId, workspaceId]
      );
      if (siteRes.rowCount === 0) {
        throw new WorkspaceRepoError(404, 'SITE_NOT_FOUND', 'Site not found');
      }
      const lockedSite = siteRes.rows[0];

      if (lockedSite.policy_version !== req.expectedPolicyVersion) {
        throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Site policy version conflict');
      }

      // 5. CAS update site policy_version
      const siteUpdateRes = await client.query(
        `UPDATE ati_workspace_jira_sites
         SET policy_version = policy_version + 1, updated_at = clock_timestamp()
         WHERE id = $1 AND policy_version = $2
         RETURNING policy_version`,
        [siteId, req.expectedPolicyVersion]
      );
      if (siteUpdateRes.rowCount === 0) {
        throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Site policy version conflict');
      }
      const newSitePolicyVersion = siteUpdateRes.rows[0].policy_version;

      // 6. Lock and fetch existing project rows
      const existingProjectsRes = await client.query(
        `SELECT id, numeric_project_id, project_key, project_name, selected, policy_version
         FROM ati_workspace_jira_projects
         WHERE workspace_id = $1 AND site_id = $2
         FOR UPDATE`,
        [workspaceId, siteId]
      );

      const existingMap = new Map<
        string,
        {
          id: string;
          numeric_project_id: string;
          project_key: string;
          project_name: string;
          selected: boolean;
          policy_version: number;
        }
      >();

      for (const row of existingProjectsRes.rows) {
        existingMap.set(row.numeric_project_id, row);
      }

      const selectedSet = new Set(selectedIds);
      let updatedCount = 0;

      // Process existing projects:
      for (const [projId, existing] of existingMap.entries()) {
        if (selectedSet.has(projId)) {
          const trusted = trustedMap.get(projId)!;
          const selectionChanged = existing.selected !== true;
          const metadataChanged =
            existing.project_key !== trusted.key ||
            existing.project_name !== trusted.name;

          if (selectionChanged || metadataChanged) {
            await client.query(
              `UPDATE ati_workspace_jira_projects
               SET selected = true,
                   project_key = $1,
                   project_name = $2,
                   policy_version = policy_version + 1,
                   updated_at = clock_timestamp()
               WHERE id = $3`,
              [trusted.key, trusted.name, existing.id]
            );
            updatedCount++;
          }
          // Untouched projects retain their generation
        } else {
          if (existing.selected === true) {
            await client.query(
              `UPDATE ati_workspace_jira_projects
               SET selected = false,
                   policy_version = policy_version + 1,
                   updated_at = clock_timestamp()
               WHERE id = $1`,
              [existing.id]
            );
            updatedCount++;
          }
          // Previously unselected projects retain their generation
        }
      }

      // Process newly selected projects not yet in DB:
      for (const projId of selectedIds) {
        if (!existingMap.has(projId)) {
          const trusted = trustedMap.get(projId)!;
          await client.query(
            `INSERT INTO ati_workspace_jira_projects
               (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version)
             VALUES ($1, $2, $3, $4, $5, $6, true, 1)`,
            [workspaceId, siteId, lockedSite.cloud_id, projId, trusted.key, trusted.name]
          );
          updatedCount++;
        }
      }

      // 7. Audit log
      await client.query(
        `INSERT INTO jira_authorization_audit
           (actor_id, workspace_id, site_id, action, decision, version, details)
         VALUES ($1, $2, $3, 'configure_projects', 'granted', $4, $5)`,
        [
          actorId,
          workspaceId,
          siteId,
          newSitePolicyVersion,
          JSON.stringify({
            selectedProjectIds: selectedIds,
            updatedCount,
            sitePolicyVersion: newSitePolicyVersion,
          }),
        ]
      );

      return {
        sitePolicyVersion: newSitePolicyVersion,
        updatedCount,
      };
    });
  }

  /**
   * Lists allowed sites for a workspace. Accessible to active workspace members and admins.
   * Bound to active workspace, active membership, and active user in a single SQL statement snapshot.
   */
  async listSites(
    workspaceId: string,
    actorId: string
  ): Promise<WorkspaceSiteItem[]> {
    if (!isUuid(workspaceId) || !isUuid(actorId)) {
      throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
    }

    const res = await this.pool.query(
      `SELECT
         w.id AS workspace_id,
         s.id AS site_id,
         s.cloud_id,
         s.site_name,
         s.site_url,
         s.active,
         s.policy_version
       FROM ati_workspaces w
       JOIN ati_workspace_memberships m
         ON m.workspace_id = w.id AND m.user_id = $2 AND m.status = 'active'
       JOIN users u
         ON u.id = $2 AND u.status = 'active'
       LEFT JOIN ati_workspace_jira_sites s
         ON s.workspace_id = w.id
       WHERE w.id = $1 AND w.status = 'active'
       ORDER BY s.created_at ASC`,
      [workspaceId, actorId]
    );

    if (res.rowCount === 0) {
      throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
    }

    // Authorized empty list sentinel: site_id is null when LEFT JOIN finds 0 linked sites
    if (res.rows.length === 1 && !res.rows[0].site_id) {
      return [];
    }

    return res.rows
      .filter((r) => r.site_id !== null)
      .map((r) => ({
        siteId: r.site_id,
        cloudId: r.cloud_id,
        name: r.site_name,
        url: r.site_url,
        active: r.active,
        policyVersion: r.policy_version,
      }));
  }

  /**
   * Retrieves projects configured for a workspace site. Accessible to active members and admins.
   * Reads site policy_version and project rows in the SAME statement snapshot, bound to authority.
   */
  async getProjects(
    workspaceId: string,
    actorId: string,
    siteId: string
  ): Promise<GetWorkspaceProjectsResponse> {
    if (!isUuid(workspaceId) || !isUuid(actorId) || !isUuid(siteId)) {
      throw new WorkspaceRepoError(404, 'SITE_NOT_FOUND', 'Site not found');
    }

    const res = await this.pool.query(
      `SELECT
         s.id AS site_id,
         s.policy_version AS site_policy_version,
         p.id AS project_row_id,
         p.numeric_project_id,
         p.project_key,
         p.project_name,
         p.selected
       FROM ati_workspaces w
       JOIN ati_workspace_memberships m
         ON m.workspace_id = w.id AND m.user_id = $2 AND m.status = 'active'
       JOIN users u
         ON u.id = $2 AND u.status = 'active'
       JOIN ati_workspace_jira_sites s
         ON s.workspace_id = w.id AND s.id = $3
       LEFT JOIN ati_workspace_jira_projects p
         ON p.workspace_id = w.id AND p.site_id = s.id
       WHERE w.id = $1 AND w.status = 'active'
       ORDER BY p.numeric_project_id ASC`,
      [workspaceId, actorId, siteId]
    );

    if (res.rowCount === 0) {
      throw new WorkspaceRepoError(404, 'SITE_NOT_FOUND', 'Site not found');
    }

    const firstRow = res.rows[0];
    const sitePolicyVersion: number = firstRow.site_policy_version;

    const projects = res.rows
      .filter((r) => r.project_row_id !== null)
      .map((p) => ({
        projectId: p.numeric_project_id,
        key: p.project_key,
        name: p.project_name,
        selected: p.selected,
      }));

    return {
      sitePolicyVersion,
      projects,
    };
  }

  /**
   * Capabilities directory endpoint.
   * Explicitly throws 503 CAPABILITIES_UNAVAILABLE until JIRA-05.
   */
  async getCapabilities(
    workspaceId: string,
    actorId: string
  ): Promise<WorkspaceJiraCapabilitiesResponse> {
    await assertActiveMember(this.pool, workspaceId, actorId);

    throw new WorkspaceRepoError(
      503,
      'CAPABILITIES_UNAVAILABLE',
      'Workspace Jira capabilities are unavailable until JIRA-05'
    );
  }
}
