import type pg from 'pg';
import {
  decideJiraModelUse,
  validateJiraSourceRef,
  type JiraBinding,
  type JiraModelBlockReason,
  type JiraModelPolicy,
  type JiraSourceRef,
} from '@wap/tool-schemas';
import type { NativeUserPermissionsEvidence, NativeUserPermissionsResult } from './jira-native-verifier.js';

export interface JiraUserPermissionVerifier {
  verifyUserPermissions(evidence: NativeUserPermissionsEvidence, options?: { signal?: AbortSignal }): Promise<NativeUserPermissionsResult>;
}
export type JiraRevalidationResult = { allowed: true } | { allowed: false; reason: JiraModelBlockReason };

/** Rebuilds policy evidence from current PostgreSQL state and current native Jira permission. */
export class JiraPolicyService {
  private readonly pool: pg.Pool;
  private readonly verifier: JiraUserPermissionVerifier;
  constructor(options: { pool: pg.Pool; verifier: JiraUserPermissionVerifier }) {
    this.pool = options.pool;
    this.verifier = options.verifier;
  }

  async revalidateSource(userId: string, rawSource: JiraSourceRef, options?: { signal?: AbortSignal; expectedWorkspaceId?: string }): Promise<JiraRevalidationResult> {
    let source: JiraSourceRef;
    try { source = validateJiraSourceRef(rawSource); }
    catch { return { allowed: false, reason: 'invalid_evidence' }; }
    if (options?.signal?.aborted) return { allowed: false, reason: 'provider_unavailable' };
    if (source.binding.atiUserId !== userId) return { allowed: false, reason: 'identity_changed' };
    if (options?.expectedWorkspaceId && (source.workspaceId !== options.expectedWorkspaceId || source.binding.workspaceId !== options.expectedWorkspaceId)) {
      return { allowed: false, reason: 'source_mismatch' };
    }

    try {
      const [workspace, membership, account, site, project] = await Promise.all([
        this.pool.query<{ status: string; version: number }>('SELECT status, version FROM ati_workspaces WHERE id = $1', [source.workspaceId]),
        this.pool.query<{ status: string; version: number; general_status: string; user_status: string }>(
          `SELECT m.status, m.version, wm.status AS general_status, u.status AS user_status FROM ati_workspace_memberships m
           LEFT JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.user_id = m.user_id
           LEFT JOIN users u ON u.id = m.user_id
           WHERE m.workspace_id = $1 AND m.user_id = $2`, [source.workspaceId, userId]
        ),
        this.pool.query<{ id: string; atlassian_account_id: string; identity_version: number; grant_id: string }>(
          `SELECT a.id, a.atlassian_account_id, a.identity_version, g.id AS grant_id
           FROM jira_accounts a 
           JOIN jira_oauth_grants g ON g.account_id = a.id AND g.status = 'active' AND g.id = $3
           JOIN jira_grant_sites gs ON gs.grant_id = g.id AND gs.cloud_id = $2 AND gs.product_type = 'jira'
           WHERE a.user_id = $1 AND a.id = $4 AND a.status = 'connected'`,
          [userId, source.cloudId, source.binding.grantId, source.binding.jiraAccountId]
        ),
        this.pool.query<{ id: string; active: boolean; policy_version: number }>(
          'SELECT id, active, policy_version FROM ati_workspace_jira_sites WHERE workspace_id = $1 AND cloud_id = $2', [source.workspaceId, source.cloudId]
        ),
        source.resourceType === 'site' ? Promise.resolve(null) : this.pool.query<{ selected: boolean; policy_version: number }>(
          `SELECT selected, policy_version FROM ati_workspace_jira_projects
           WHERE workspace_id = $1 AND cloud_id = $2 AND numeric_project_id = $3`, [source.workspaceId, source.cloudId, source.projectId]
        ),
      ]);
      const ws = workspace.rows[0];
      const mem = membership.rows[0];
      const acc = account.rows[0];
      const currentSite = site.rows[0];
      if (currentSite && currentSite.id !== source.siteId) return { allowed: false, reason: 'source_mismatch' };
      if (!acc) return { allowed: false, reason: 'identity_changed' };

      const currentBinding: JiraBinding = {
        atiUserId: userId, jiraAccountId: acc.id, atlassianAccountId: acc.atlassian_account_id,
        workspaceId: source.workspaceId, membershipVersion: mem?.version ?? source.binding.membershipVersion,
        grantId: acc.grant_id, identityVersion: acc.identity_version,
      };
      const projectRow = project?.rows[0];
      let nativePermission: JiraModelPolicy['nativePermission'] = 'unavailable';
      // Atlassian calls are outside DB transactions. Final outbound guard is a JIRA-08 responsibility.
      if (ws?.status === 'active' && mem?.status === 'active' && mem.general_status === 'active' && mem.user_status === 'active' && currentSite?.active && (source.resourceType === 'site' || projectRow?.selected)) {
        try {
          const native = await this.verifier.verifyUserPermissions({
            actorId: userId, localAccountId: acc.id, identityVersion: acc.identity_version,
            workspaceId: source.workspaceId, cloudId: source.cloudId,
            ...(source.projectId ? { projectId: source.projectId } : {}),
          }, options);
          nativePermission = native.status === 'unavailable' ? 'unavailable'
            : native.status === 'denied' ? 'denied'
            : native.status === 'granted' ? (native.canBrowse ? 'granted' : 'denied')
            : 'unavailable';
        } catch { nativePermission = 'unavailable'; }
      }
      const policy: JiraModelPolicy = {
        source, currentBinding,
        workspaceActive: ws?.status === 'active', currentWorkspaceVersion: ws?.version ?? source.workspaceVersion,
        membershipStatus: mem?.status === 'active' && mem.general_status === 'active' && mem.user_status === 'active' ? 'active' : 'removed',
        siteActive: Boolean(currentSite?.active), currentSitePolicyVersion: currentSite?.policy_version ?? source.sitePolicyVersion,
        projectAllowed: source.resourceType === 'site' ? true : Boolean(projectRow?.selected),
        ...(source.resourceType === 'site' ? {} : { currentProjectPolicyVersion: projectRow?.policy_version ?? source.projectPolicyVersion ?? 1 }),
        nativePermission,
      };
      return decideJiraModelUse(policy, { source });
    } catch {
      return { allowed: false, reason: 'provider_unavailable' };
    }
  }
}
