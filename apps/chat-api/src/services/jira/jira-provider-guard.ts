import type { Pool } from 'pg';
import type { LLMProvider, LLMGeneratePlanInput } from '@wap/planner';
import type { JiraPolicyService } from './jira-policy-service.js';
import type { JiraLeaseManager } from './jira-lease-manager.js';

export interface JiraGuardedProviderOptions {
  pool?: Pool;
  jiraPolicyService?: JiraPolicyService;
  jiraLeaseManager?: JiraLeaseManager;
  actor?: {
    userId: string;
    workspaceId?: string | null;
    workspaceMode?: 'legacy' | 'personal' | 'organization';
  };
}

/**
 * Wraps an LLMProvider to enforce that any gathered Jira entities present in
 * workingMemory or conversationHistory are verified against current PostgreSQL
 * authority right before model prompt generation.
 *
 * If permissions (membership, OAuth grant, site active, etc.) were revoked
 * after gather but before model dispatch, the revoked entities are purged from
 * workingMemory and masked in conversationHistory so the model never sees them.
 */
export class JiraGuardedProvider implements LLMProvider {
  constructor(
    private readonly baseProvider: LLMProvider,
    private readonly options: JiraGuardedProviderOptions,
  ) {}

  get name(): string {
    return this.baseProvider.name;
  }

  get lastCallMetrics() {
    return this.baseProvider.lastCallMetrics;
  }

  async generatePlan(input: LLMGeneratePlanInput): Promise<string> {
    const sanitizedInput = await this.sanitizeBeforeModel(input);
    return this.baseProvider.generatePlan(sanitizedInput);
  }

  private async sanitizeBeforeModel(input: LLMGeneratePlanInput): Promise<LLMGeneratePlanInput> {
    const pool = this.options.pool;
    const actor = this.options.actor;
    if (!pool || !actor?.userId || !actor?.workspaceId) {
      return input;
    }

    // Check overall Jira authority for (workspaceId, userId) in PostgreSQL
    let overallValid = false;
    let inactiveSiteRows: Array<{ id: string; cloud_id: string; site_name: string }> = [];
    try {
      const authQuery = await pool.query<{
        workspace_status: string;
        general_member_status: string;
        jira_member_status: string;
        user_status: string;
        account_status: string;
        grant_status: string;
        active_site_count: number;
      }>(
        `SELECT 
          w.status AS workspace_status,
          wm.status AS general_member_status,
          jm.status AS jira_member_status,
          u.status AS user_status,
          a.status AS account_status,
          g.status AS grant_status,
          (SELECT COUNT(*)::int FROM ati_workspace_jira_sites s WHERE s.workspace_id = $1 AND s.active = true) AS active_site_count
        FROM ati_workspaces w
        LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $2
        LEFT JOIN ati_workspace_memberships jm ON jm.workspace_id = w.id AND jm.user_id = $2
        LEFT JOIN users u ON u.id = $2
        LEFT JOIN jira_accounts a ON a.user_id = $2 AND a.status = 'connected'
        LEFT JOIN jira_oauth_grants g ON g.account_id = a.id AND g.status = 'active'
        WHERE w.id = $1`,
        [actor.workspaceId, actor.userId]
      );

      const row = authQuery.rows[0];
      if (
        row &&
        row.workspace_status === 'active' &&
        row.general_member_status === 'active' &&
        row.jira_member_status === 'active' &&
        row.user_status === 'active' &&
        row.account_status === 'connected' &&
        row.grant_status === 'active' &&
        Number(row.active_site_count) > 0
      ) {
        overallValid = true;
      }

      // Query inactive sites for partial revocation
      const sitesQuery = await pool.query<{ id: string; cloud_id: string; site_name: string }>(
        `SELECT id, cloud_id, site_name FROM ati_workspace_jira_sites WHERE workspace_id = $1 AND active = false`,
        [actor.workspaceId]
      );
      inactiveSiteRows = sitesQuery.rows;
    } catch {
      overallValid = false;
    }

    const workingMemory = input.workingMemory;
    const sanitizedWorkingMemory: Record<string, any> = (workingMemory && typeof workingMemory === 'object')
      ? { ...workingMemory }
      : {};

    const observed = sanitizedWorkingMemory.__observed as Record<string, unknown[]> | undefined;

    // Case 1: Overall Jira authority is completely revoked (membership removed, grant revoked, or all sites disabled)
    if (!overallValid) {
      // Purge all Jira entities from workingMemory
      if (observed && typeof observed === 'object') {
        const sanitizedObserved: Record<string, unknown[]> = {};
        for (const [res, list] of Object.entries(observed)) {
          if (res.startsWith('jira_')) {
            sanitizedObserved[res] = [];
          } else {
            sanitizedObserved[res] = list;
          }
        }
        sanitizedWorkingMemory.__observed = sanitizedObserved;
      }
      delete sanitizedWorkingMemory.jira_site;
      delete sanitizedWorkingMemory.jira_project;
      delete sanitizedWorkingMemory.jira_issue;

      // Mask any conversation history turn containing Jira search results or Jira tool calls
      const sanitizedConversationHistory = input.conversationHistory.map((msg, index) => {
        if (index > 0 || msg.role !== 'user') {
          if (
            msg.content &&
            (msg.content.includes('myjira.') ||
              msg.content.includes('Search results.') ||
              msg.content.includes('jira_site') ||
              msg.content.includes('atlassian.net'))
          ) {
            return {
              ...msg,
              content: '[Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: membership_inactive]',
            };
          }
        }
        return msg;
      });

      // Filter out myjira tools from toolCatalog
      const sanitizedToolCatalog = input.toolCatalog.filter((t) => !t.name.startsWith('myjira.'));

      return {
        ...input,
        toolCatalog: sanitizedToolCatalog,
        workingMemory: sanitizedWorkingMemory,
        conversationHistory: sanitizedConversationHistory,
      };
    }

    // Case 2: Partial site revocation (specific sites deactivated)
    const invalidSiteIds = new Set<string>(inactiveSiteRows.map((r) => r.id));
    const invalidCloudIds = new Set<string>(inactiveSiteRows.map((r) => r.cloud_id));
    const invalidSiteNames = new Set<string>(inactiveSiteRows.map((r) => r.site_name));

    if (invalidSiteIds.size > 0 || invalidCloudIds.size > 0) {
      const isSiteRevoked = (entity: unknown): boolean => {
        if (!entity || typeof entity !== 'object') return false;
        const rec = entity as Record<string, unknown>;
        const sId = (rec.siteId ?? rec.id) as string | undefined;
        const cId = rec.cloudId as string | undefined;
        const sName = (rec.name ?? rec.displayName) as string | undefined;
        return Boolean(
          (sId && invalidSiteIds.has(sId)) ||
          (cId && invalidCloudIds.has(cId)) ||
          (sName && invalidSiteNames.has(sName))
        );
      };

      if (observed && typeof observed === 'object') {
        const sanitizedObserved: Record<string, unknown[]> = {};
        for (const [res, list] of Object.entries(observed)) {
          if (Array.isArray(list)) {
            sanitizedObserved[res] = list.filter((item) => !isSiteRevoked(item));
          } else {
            sanitizedObserved[res] = list;
          }
        }
        sanitizedWorkingMemory.__observed = sanitizedObserved;
      }

      if (Array.isArray(sanitizedWorkingMemory.jira_site)) {
        sanitizedWorkingMemory.jira_site = (sanitizedWorkingMemory.jira_site as unknown[]).filter(
          (item) => !isSiteRevoked(item)
        );
      }
      if (Array.isArray(sanitizedWorkingMemory.jira_project)) {
        sanitizedWorkingMemory.jira_project = (sanitizedWorkingMemory.jira_project as unknown[]).filter(
          (item) => !isSiteRevoked(item)
        );
      }
      if (Array.isArray(sanitizedWorkingMemory.jira_issue)) {
        sanitizedWorkingMemory.jira_issue = (sanitizedWorkingMemory.jira_issue as unknown[]).filter(
          (item) => !isSiteRevoked(item)
        );
      }

      // Mask conversationHistory turns containing revoked Jira data
      const sanitizedConversationHistory = input.conversationHistory.map((msg, index) => {
        let containsRevoked = false;
        for (const siteId of invalidSiteIds) {
          if (msg.content && msg.content.includes(siteId)) {
            containsRevoked = true;
            break;
          }
        }
        if (!containsRevoked) {
          for (const cloudId of invalidCloudIds) {
            if (msg.content && msg.content.includes(cloudId)) {
              containsRevoked = true;
              break;
            }
          }
        }
        if (!containsRevoked) {
          for (const siteName of invalidSiteNames) {
            if (msg.content && msg.content.includes(siteName)) {
              containsRevoked = true;
              break;
            }
          }
        }
        if (containsRevoked && (msg.role !== 'user' || index > 0)) {
          return {
            ...msg,
            content: '[Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: site_disabled]',
          };
        }
        return msg;
      });

      return {
        ...input,
        workingMemory: sanitizedWorkingMemory,
        conversationHistory: sanitizedConversationHistory,
      };
    }

    return input;
  }
}

export function createJiraGuardedProvider(
  baseProvider: LLMProvider,
  options: JiraGuardedProviderOptions
): JiraGuardedProvider {
  return new JiraGuardedProvider(baseProvider, options);
}
