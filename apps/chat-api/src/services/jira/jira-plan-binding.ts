import type pg from 'pg';
import {
  validateJiraPlanConnection,
  type JiraPlanConnection,
  type JiraPlanStepScope,
  type PlanStep,
} from '@wap/tool-schemas';

export class JiraBindingError extends Error {
  readonly code: string;
  readonly suggestion?: string;

  constructor(message: string, code = 'JIRA_BINDING_FAILED', suggestion?: string) {
    super(message);
    this.name = 'JiraBindingError';
    this.code = code;
    this.suggestion = suggestion;
  }
}

export interface ConversationContext {
  id: string;
  user_id: string;
  workspace_id?: string | null;
  workspace_mode?: string;
  jira_context?: boolean;
}

export interface JiraPlanBinderOptions {
  pool: pg.Pool;
  lookupIssue?: (
    siteId: string,
    cloudId: string,
    issueKey: string,
    signal?: AbortSignal
  ) => Promise<{ projectKey: string; numericProjectId?: string } | null>;
}

export class JiraPlanBinder {
  private readonly pool: pg.Pool;
  private readonly lookupIssue?: JiraPlanBinderOptions['lookupIssue'];

  constructor(options: JiraPlanBinderOptions) {
    if (!options?.pool) {
      throw new TypeError('JiraPlanBinder requires a pg.Pool');
    }
    this.pool = options.pool;
    this.lookupIssue = options.lookupIssue;
  }

  async bindPlan(
    userId: string,
    conversation: ConversationContext,
    steps: PlanStep[],
    options?: { signal?: AbortSignal }
  ): Promise<JiraPlanConnection> {
    options?.signal?.throwIfAborted();

    if (
      !conversation ||
      conversation.jira_context !== true ||
      conversation.workspace_mode !== 'organization' ||
      !conversation.workspace_id
    ) {
      throw new JiraBindingError(
        'Hội thoại không ở trong ngữ cảnh Jira hợp lệ của tổ chức.',
        'INVALID_JIRA_CONTEXT',
        'Hãy chọn không gian làm việc tổ chức và mở ngữ cảnh Jira để thực hiện kế hoạch này.'
      );
    }

    if (conversation.user_id !== userId) {
      throw new JiraBindingError(
        'Người dùng không phải chủ sở hữu hội thoại.',
        'OWNER_MISMATCH'
      );
    }

    const workspaceId = conversation.workspace_id;

    // 1. Check workspace
    const wsRes = await this.pool.query<{ id: string; status: string; version: number }>(
      'SELECT id, status, version FROM ati_workspaces WHERE id = $1',
      [workspaceId]
    );
    const wsRow = wsRes.rows[0];
    if (!wsRow || wsRow.status !== 'active') {
      throw new JiraBindingError(
        'Workspace tổ chức không hoạt động hoặc đã bị lưu trữ.',
        'WORKSPACE_INACTIVE'
      );
    }
    const workspaceVersion = wsRow.version;

    // 2. Check dual-layer membership (ati_workspace_memberships + workspace_members + users)
    const memRes = await this.pool.query<{
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
      [workspaceId, userId]
    );
    const memRow = memRes.rows[0];
    if (
      !memRow ||
      memRow.jira_member_status !== 'active' ||
      memRow.general_member_status !== 'active' ||
      memRow.user_status !== 'active'
    ) {
      throw new JiraBindingError(
        'Người dùng không phải thành viên hoạt động của Jira workspace.',
        'MEMBERSHIP_INACTIVE'
      );
    }
    const membershipVersion = memRow.membership_version;

    // 3. Check Jira account
    const accRes = await this.pool.query<{
      id: string;
      atlassian_account_id: string;
      status: string;
      identity_version: number;
    }>(
      `SELECT id, atlassian_account_id, status, identity_version
       FROM jira_accounts
       WHERE user_id = $1 AND status = 'connected'`,
      [userId]
    );
    const accRow = accRes.rows[0];
    if (!accRow || accRow.status !== 'connected') {
      throw new JiraBindingError(
        'Tài khoản Jira chưa được kết nối.',
        'ACCOUNT_DISCONNECTED'
      );
    }
    const jiraAccountId = accRow.id;
    const atlassianAccountId = accRow.atlassian_account_id;
    const identityVersion = accRow.identity_version;

    // 4. Check active OAuth grant
    const grantRes = await this.pool.query<{ id: string; status: string }>(
      `SELECT id, status
       FROM jira_oauth_grants
       WHERE account_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [jiraAccountId]
    );
    const grantRow = grantRes.rows[0];
    if (!grantRow || grantRow.status !== 'active') {
      throw new JiraBindingError(
        'Quyền truy cập Jira OAuth không khả dụng hoặc đã bị thu hồi.',
        'GRANT_REVOKED'
      );
    }
    const grantId = grantRow.id;

    // 5. Bind each Jira step
    const siteSteps: Record<string, JiraPlanStepScope> = {};
    const jiraSteps = steps.filter((s) => s.tool.startsWith('myjira.'));

    for (const step of jiraSteps) {
      options?.signal?.throwIfAborted();
      const args = step.args ?? {};
      const siteId = args.siteId;

      if (typeof siteId !== 'string' || !siteId.trim()) {
        throw new JiraBindingError(
          `Bước Jira '${step.id}' thiếu siteId hợp lệ.`,
          'INVALID_SITE_ID'
        );
      }

      // Check site in workspace and that grant has access to cloudId
      const siteRes = await this.pool.query<{
        site_id: string;
        cloud_id: string;
        active: boolean;
        policy_version: number;
        grant_site_id: string | null;
      }>(
        `SELECT s.id AS site_id, s.cloud_id, s.active, s.policy_version,
                gs.id AS grant_site_id
         FROM ati_workspace_jira_sites s
         LEFT JOIN jira_grant_sites gs ON gs.grant_id = $3 AND gs.cloud_id = s.cloud_id AND gs.product_type = 'jira'
         WHERE s.workspace_id = $1 AND s.id = $2`,
        [workspaceId, siteId, grantId]
      );

      const siteRow = siteRes.rows[0];
      if (!siteRow) {
        throw new JiraBindingError(
          `Site Jira '${siteId}' không tồn tại trong workspace.`,
          'SITE_NOT_FOUND'
        );
      }
      if (!siteRow.active) {
        throw new JiraBindingError(
          `Site Jira '${siteId}' đã bị vô hiệu hóa.`,
          'SITE_DEACTIVATED'
        );
      }

      if (!siteRow.grant_site_id) {
        throw new JiraBindingError(
          `Bạn chưa được cấp quyền truy cập Jira site '${siteId}'.`,
          'SITE_GRANT_MISSING'
        );
      }

      const cloudId = siteRow.cloud_id;
      const sitePolicyVersion = siteRow.policy_version;

      // Extract target project key if tool has project scope
      let projectKey: string | undefined;
      if (typeof args.projectKey === 'string' && args.projectKey.trim()) {
        projectKey = args.projectKey.trim();
      } else if (typeof args.issueKey === 'string' && args.issueKey.trim()) {
        projectKey = args.issueKey.trim().split('-')[0];
      }

      // Check moved issue if lookup hook is available
      if (typeof args.issueKey === 'string' && this.lookupIssue) {
        const issueInfo = await this.lookupIssue(siteId, cloudId, args.issueKey.trim(), options?.signal);
        if (issueInfo && issueInfo.projectKey && issueInfo.projectKey !== projectKey) {
          throw new JiraBindingError(
            `Issue '${args.issueKey}' đã bị chuyển sang project '${issueInfo.projectKey}'.`,
            'ISSUE_MOVED'
          );
        }
      }

      let stepScope: JiraPlanStepScope;
      if (projectKey) {
        const projRes = await this.pool.query<{
          numeric_project_id: string;
          policy_version: number;
          selected: boolean;
        }>(
          `SELECT numeric_project_id, policy_version, selected
           FROM ati_workspace_jira_projects
           WHERE workspace_id = $1 AND site_id = $2 AND project_key = $3`,
          [workspaceId, siteId, projectKey]
        );

        const projRow = projRes.rows[0];
        if (!projRow || !projRow.selected) {
          throw new JiraBindingError(
            `Project '${projectKey}' không tồn tại hoặc chưa được chọn trong workspace.`,
            'PROJECT_NOT_SELECTED'
          );
        }

        stepScope = {
          siteId,
          cloudId,
          sitePolicyVersion,
          projectId: projRow.numeric_project_id,
          projectPolicyVersion: projRow.policy_version,
        };
      } else {
        stepScope = {
          siteId,
          cloudId,
          sitePolicyVersion,
        };
      }

      siteSteps[step.id] = stepScope;
    }

    const planConnection: JiraPlanConnection = {
      atiUserId: userId,
      jiraAccountId,
      atlassianAccountId,
      workspaceId,
      membershipVersion,
      grantId,
      identityVersion,
      workspaceVersion,
      siteSteps,
    };

    return validateJiraPlanConnection(planConnection);
  }
}
