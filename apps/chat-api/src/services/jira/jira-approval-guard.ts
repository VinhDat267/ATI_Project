import type pg from 'pg';
import {
  JIRA_CAPABILITY_DISABLED_IN_G2A,
  validateJiraPlanConnection,
  type JiraPlanConnection,
} from '@wap/tool-schemas';

export type JiraApprovalValidationResult =
  | { valid: true }
  | {
      valid: false;
      category: 'denied' | 'stale' | 'unavailable';
      status: 403 | 409 | 503;
      reason: string;
    };

export interface JiraApprovalValidationOptions {
  signal?: AbortSignal;
  verifier?: {
    verifyUserPermissions: (
      evidence: { actorId: string; workspaceId?: string; cloudId: string; projectId?: string },
      options?: { signal?: AbortSignal }
    ) => Promise<{ canBrowse: boolean; canCreateIssue: boolean; canAddComment: boolean; status?: string; reason?: string }>;
  };
  requiredPermissions?: {
    browse?: boolean;
    createIssue?: boolean;
    addComment?: boolean;
  };
}

export async function validateJiraApprovalBinding(
  pool: pg.Pool,
  rawConnection: JiraPlanConnection,
  options?: JiraApprovalValidationOptions
): Promise<JiraApprovalValidationResult> {
  if (options?.signal?.aborted) {
    return {
      valid: false,
      category: 'unavailable',
      status: 503,
      reason: 'Validation aborted by caller',
    };
  }

  if (options?.requiredPermissions?.createIssue || options?.requiredPermissions?.addComment) {
    return {
      valid: false,
      category: 'denied',
      status: 403,
      reason: `${JIRA_CAPABILITY_DISABLED_IN_G2A}: Jira write approvals are disabled in G2A read-only mode`,
    };
  }

  let connection: JiraPlanConnection;
  try {
    connection = validateJiraPlanConnection(rawConnection);
  } catch (err: any) {
    return {
      valid: false,
      category: 'denied',
      status: 403,
      reason: `Malformed Jira plan connection: ${err?.message || 'invalid schema'}`,
    };
  }

  const {
    atiUserId,
    workspaceId,
    workspaceVersion,
    membershipVersion,
    identityVersion,
    jiraAccountId,
    atlassianAccountId,
    grantId,
    siteSteps,
  } = connection;

  try {
    // 1. Check workspace
    const wsRes = await pool.query<{ id: string; status: string; version: number }>(
      'SELECT id, status, version FROM ati_workspaces WHERE id = $1',
      [workspaceId]
    );
    const wsRow = wsRes.rows[0];
    if (!wsRow || wsRow.status !== 'active') {
      return {
        valid: false,
        category: 'denied',
        status: 403,
        reason: 'Workspace is inactive or archived',
      };
    }
    if (wsRow.version !== workspaceVersion) {
      return {
        valid: false,
        category: 'stale',
        status: 409,
        reason: 'Workspace version conflict',
      };
    }

    // 2. Check dual-layer membership (ati_workspace_memberships + workspace_members + users)
    const memRes = await pool.query<{
      jira_member_status: string;
      membership_version: number;
      general_member_status: string;
      user_status: string;
    }>(
      `SELECT m.status AS jira_member_status, m.version AS membership_version,
              wm.status AS general_member_status,
              u.status AS user_status
       FROM ati_workspace_memberships m
       JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.user_id = m.user_id
       JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1 AND m.user_id = $2`,
      [workspaceId, atiUserId]
    );
    const memRow = memRes.rows[0];
    if (
      !memRow ||
      memRow.jira_member_status !== 'active' ||
      memRow.general_member_status !== 'active' ||
      memRow.user_status !== 'active'
    ) {
      return {
        valid: false,
        category: 'denied',
        status: 403,
        reason: 'Membership is inactive or removed',
      };
    }
    if (memRow.membership_version !== membershipVersion) {
      return {
        valid: false,
        category: 'stale',
        status: 409,
        reason: 'Membership version conflict',
      };
    }

    // 3. Check Jira account
    const accRes = await pool.query<{
      id: string;
      atlassian_account_id: string;
      status: string;
      identity_version: number;
    }>(
      `SELECT id, atlassian_account_id, status, identity_version
       FROM jira_accounts
       WHERE id = $1 AND user_id = $2`,
      [jiraAccountId, atiUserId]
    );
    const accRow = accRes.rows[0];
    if (
      !accRow ||
      accRow.status !== 'connected' ||
      accRow.atlassian_account_id !== atlassianAccountId
    ) {
      return {
        valid: false,
        category: 'denied',
        status: 403,
        reason: 'Jira account disconnected or changed',
      };
    }
    if (accRow.identity_version !== identityVersion) {
      return {
        valid: false,
        category: 'stale',
        status: 409,
        reason: 'Jira account identity version conflict',
      };
    }

    // 4. Check active OAuth grant
    const grantRes = await pool.query<{ id: string; status: string }>(
      `SELECT id, status
       FROM jira_oauth_grants
       WHERE id = $1 AND account_id = $2`,
      [grantId, jiraAccountId]
    );
    const grantRow = grantRes.rows[0];
    if (!grantRow || grantRow.status !== 'active') {
      return {
        valid: false,
        category: 'denied',
        status: 403,
        reason: 'OAuth grant is revoked or inactive',
      };
    }

    // 5. Check each site and project in siteSteps
    for (const [stepId, scope] of Object.entries(siteSteps)) {
      if (options?.signal?.aborted) {
        return {
          valid: false,
          category: 'unavailable',
          status: 503,
          reason: 'Validation aborted by caller',
        };
      }

      const siteRes = await pool.query<{
        id: string;
        cloud_id: string;
        active: boolean;
        policy_version: number;
        grant_site_id: string | null;
      }>(
        `SELECT s.id, s.cloud_id, s.active, s.policy_version,
                gs.id AS grant_site_id
         FROM ati_workspace_jira_sites s
         LEFT JOIN jira_grant_sites gs ON gs.grant_id = $3 AND gs.cloud_id = s.cloud_id AND gs.product_type = 'jira'
         WHERE s.id = $1 AND s.workspace_id = $2`,
        [scope.siteId, workspaceId, grantId]
      );
      const siteRow = siteRes.rows[0];
      if (!siteRow) {
        return {
          valid: false,
          category: 'denied',
          status: 403,
          reason: `Site not found: ${scope.siteId}`,
        };
      }
      if (!siteRow.active) {
        return {
          valid: false,
          category: 'denied',
          status: 403,
          reason: `Site deactivated: ${scope.siteId}`,
        };
      }
      if (!siteRow.grant_site_id) {
        return {
          valid: false,
          category: 'denied',
          status: 403,
          reason: `Site access revoked from grant: ${scope.siteId}`,
        };
      }
      if (siteRow.cloud_id !== scope.cloudId) {
        return {
          valid: false,
          category: 'denied',
          status: 403,
          reason: `Cloud ID mismatch for site ${scope.siteId}`,
        };
      }
      if (siteRow.policy_version !== scope.sitePolicyVersion) {
        return {
          valid: false,
          category: 'stale',
          status: 409,
          reason: `Site policy version conflict for site ${scope.siteId}`,
        };
      }

      if (scope.projectId !== undefined) {
        const projRes = await pool.query<{
          numeric_project_id: string;
          selected: boolean;
          policy_version: number;
        }>(
          `SELECT numeric_project_id, selected, policy_version
           FROM ati_workspace_jira_projects
           WHERE workspace_id = $1 AND site_id = $2 AND numeric_project_id = $3`,
          [workspaceId, scope.siteId, scope.projectId]
        );
        const projRow = projRes.rows[0];
        if (!projRow || !projRow.selected) {
          return {
            valid: false,
            category: 'denied',
            status: 403,
            reason: `Project not found or unselected: ${scope.projectId}`,
          };
        }
        if (
          scope.projectPolicyVersion !== undefined &&
          projRow.policy_version !== scope.projectPolicyVersion
        ) {
          return {
            valid: false,
            category: 'stale',
            status: 409,
            reason: `Project policy version conflict for project ${scope.projectId}`,
          };
        }
      }

      if (options?.verifier) {
        const nativeRes = await options.verifier.verifyUserPermissions(
          {
            actorId: atiUserId,
            workspaceId,
            cloudId: scope.cloudId,
            projectId: scope.projectId,
          },
          { signal: options.signal }
        );
        if (nativeRes.status === 'unavailable') {
          return {
            valid: false,
            category: 'unavailable',
            status: 503,
            reason: `Native Jira permission verification unavailable: ${nativeRes.reason || 'service unreachable'}`,
          };
        }
        if (nativeRes.status === 'denied' || !nativeRes.canBrowse) {
          return {
            valid: false,
            category: 'denied',
            status: 403,
            reason: `Native Jira permission denied: ${nativeRes.reason || 'User lacks BROWSE_PROJECTS permission'}`,
          };
        }
        if (options.requiredPermissions?.createIssue && !nativeRes.canCreateIssue) {
          return {
            valid: false,
            category: 'denied',
            status: 403,
            reason: 'Native Jira permission denied: User lacks CREATE_ISSUES permission',
          };
        }
        if (options.requiredPermissions?.addComment && !nativeRes.canAddComment) {
          return {
            valid: false,
            category: 'denied',
            status: 403,
            reason: 'Native Jira permission denied: User lacks ADD_COMMENTS permission',
          };
        }
      }
    }

    return { valid: true };
  } catch (err: any) {
    return {
      valid: false,
      category: 'unavailable',
      status: 503,
      reason: `Authority verification unavailable: ${err?.message || 'database error'}`,
    };
  }
}
