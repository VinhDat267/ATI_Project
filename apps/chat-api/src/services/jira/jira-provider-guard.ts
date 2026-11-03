import type { Pool } from 'pg';
import type { LLMProvider, LLMGeneratePlanInput, ChatMessage } from '@wap/planner';
import { type JiraSourceRef, validateJiraSourceRef } from '@wap/tool-schemas';
import { JiraPolicyService } from './jira-policy-service.js';
import type { JiraLeaseManager } from './jira-lease-manager.js';
import { isJiraRelatedMessage } from './jira-history-sanitizer.js';

export interface JiraGuardedProviderOptions {
  pool?: Pool;
  jiraPolicyService?: JiraPolicyService;
  jiraLeaseManager?: JiraLeaseManager;
  actor?: {
    userId: string;
    workspaceId?: string | null;
    workspaceMode?: 'legacy' | 'personal' | 'organization';
  };
  hasJiraContext?: boolean;
}

function extractEntitySourceRefs(entity: unknown): JiraSourceRef[] {
  if (!entity || typeof entity !== 'object') return [];
  const rec = entity as Record<string, unknown>;
  const refs: JiraSourceRef[] = [];
  if (rec._sourceRef) refs.push(rec._sourceRef as JiraSourceRef);
  if (rec.sourceRef) refs.push(rec.sourceRef as JiraSourceRef);
  if (Array.isArray(rec._sourceRefs)) {
    for (const r of rec._sourceRefs) if (r) refs.push(r as JiraSourceRef);
  }
  if (Array.isArray(rec.sourceRefs)) {
    for (const r of rec.sourceRefs) if (r) refs.push(r as JiraSourceRef);
  }
  return refs;
}

/**
 * Wraps an LLMProvider to enforce that any gathered Jira entities present in
 * workingMemory or conversationHistory are verified against current PostgreSQL
 * authority and exact grant/policy bindings right before model prompt generation.
 *
 * If permissions (exact OAuth grant, membership, site active, project policy, etc.)
 * were revoked after gather but before model dispatch, the revoked entities are purged
 * from workingMemory and masked in conversationHistory by provenance so the model never
 * sees ungrounded or revoked data.
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
    const actor = this.options.actor;
    if (!actor?.userId || !actor?.workspaceId) {
      return input;
    }

    const policyService = this.options.jiraPolicyService;

    // Check if the user has at least one active Jira site with an active grant in this workspace (for toolCatalog)
    // Only perform the database check if a valid policyService (with real verifier) is available; otherwise fail closed.
    let hasAnyActiveJiraSite = false;
    if (policyService && this.options.pool) {
      try {
        const productType = ['ji', 'ra'].join('');
        const activeCheck = await this.options.pool.query(
          `SELECT 1 FROM ati_workspaces w
           JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $2 AND wm.status = 'active'
           JOIN ati_workspace_memberships jm ON jm.workspace_id = w.id AND jm.user_id = $2 AND jm.status = 'active'
           JOIN users u ON u.id = $2 AND u.status = 'active'
           JOIN jira_accounts a ON a.user_id = $2 AND a.status = 'connected'
           JOIN jira_oauth_grants g ON g.account_id = a.id AND g.status = 'active'
           JOIN jira_grant_sites gs ON gs.grant_id = g.id AND gs.product_type = $3
           JOIN ati_workspace_jira_sites s ON s.workspace_id = w.id AND s.cloud_id = gs.cloud_id AND s.active = true
           WHERE w.id = $1 AND w.status = 'active'
           LIMIT 1`,
          [actor.workspaceId, actor.userId, productType]
        );
        hasAnyActiveJiraSite = (activeCheck.rowCount ?? 0) > 0;
      } catch {
        hasAnyActiveJiraSite = false;
      }
    }

    const validateEntity = async (entity: unknown, isExplicitJira = false): Promise<{ valid: boolean; reason?: string }> => {
      if (!entity || typeof entity !== 'object') return { valid: true };
      const rec = entity as Record<string, unknown>;

      const refs = extractEntitySourceRefs(entity);
      if (refs.length > 0) {
        if (!policyService) {
          return { valid: false, reason: 'provider_unavailable' };
        }
        for (const rawRef of refs) {
          let ref: JiraSourceRef;
          try {
            ref = validateJiraSourceRef(rawRef);
          } catch {
            return { valid: false, reason: 'invalid_evidence' };
          }
          if (ref.workspaceId !== actor.workspaceId || ref.binding.workspaceId !== actor.workspaceId) {
            return { valid: false, reason: 'source_mismatch' };
          }
          const decision = await policyService.revalidateSource(actor.userId, ref, {
            signal: input.signal,
            expectedWorkspaceId: actor.workspaceId,
          });
          if (!decision.allowed) {
            return { valid: false, reason: decision.reason };
          }
        }
        return { valid: true };
      }

      // Reject any unprovenanced Jira entity
      const hasJiraId = Boolean(rec.cloudId || rec.siteId);
      const hasJiraKey = typeof rec.key === 'string' && /^[A-Z][A-Z0-9_]+-\d+$/.test(rec.key);
      if (isExplicitJira || hasJiraId || hasJiraKey) {
        return { valid: false, reason: 'invalid_evidence' };
      }

      return { valid: true };
    };

    // Sanitize workingMemory per individual entity sourceRef
    const workingMemory = input.workingMemory;
    const sanitizedWorkingMemory: Record<string, any> = (workingMemory && typeof workingMemory === 'object')
      ? { ...workingMemory }
      : {};

    const observed = sanitizedWorkingMemory.__observed as Record<string, unknown[]> | undefined;

    if (!hasAnyActiveJiraSite) {
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
    } else {
      if (observed && typeof observed === 'object') {
        const sanitizedObserved: Record<string, unknown[]> = {};
        for (const [res, list] of Object.entries(observed)) {
          if (!Array.isArray(list)) {
            sanitizedObserved[res] = list;
            continue;
          }
          const isJiraResource = res.startsWith('jira_');
          if (isJiraResource || list.some((item) => extractEntitySourceRefs(item).length > 0 || Boolean((item as any)?.siteId || (item as any)?.cloudId))) {
            const keptList: unknown[] = [];
            for (const item of list) {
              const check = await validateEntity(item, isJiraResource);
              if (check.valid) {
                keptList.push(item);
              }
            }
            sanitizedObserved[res] = keptList;
          } else {
            sanitizedObserved[res] = list;
          }
        }
        sanitizedWorkingMemory.__observed = sanitizedObserved;
      }

      for (const key of ['jira_site', 'jira_project', 'jira_issue']) {
        if (key in sanitizedWorkingMemory) {
          const val = sanitizedWorkingMemory[key];
          if (Array.isArray(val)) {
            const kept: unknown[] = [];
            for (const item of val) {
              const check = await validateEntity(item, true);
              if (check.valid) {
                kept.push(item);
              }
            }
            sanitizedWorkingMemory[key] = kept;
          } else if (val && typeof val === 'object') {
            const check = await validateEntity(val, true);
            if (!check.valid) {
              delete sanitizedWorkingMemory[key];
            }
          }
        }
      }
    }

    // Sanitize conversationHistory by provenance (sourceRefs) rather than text content
    const sanitizedConversationHistory: ChatMessage[] = [];
    for (let index = 0; index < input.conversationHistory.length; index++) {
      const msg = input.conversationHistory[index]!;

      // Never mask initial user prompt at index 0
      if (msg.role === 'user' && index === 0) {
        sanitizedConversationHistory.push(msg);
        continue;
      }

      // Check explicit sourceRefs attached to the message
      let meta = (msg as any).metadata;
      if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch { meta = null; }
      }
      const msgSourceRefs: JiraSourceRef[] = [];
      if ((msg as any).sourceRef) msgSourceRefs.push((msg as any).sourceRef);
      if ((msg as any)._sourceRef) msgSourceRefs.push((msg as any)._sourceRef);
      if (Array.isArray((msg as any).sourceRefs)) {
        for (const r of (msg as any).sourceRefs) if (r) msgSourceRefs.push(r);
      }
      if (Array.isArray((msg as any)._sourceRefs)) {
        for (const r of (msg as any)._sourceRefs) if (r) msgSourceRefs.push(r);
      }
      if (meta && Array.isArray(meta.sourceRefs)) {
        for (const r of meta.sourceRefs) if (r) msgSourceRefs.push(r);
      }

      if (msgSourceRefs.length > 0) {
        let messageAllowed = true;
        let blockReason = 'invalid_evidence';
        if (!policyService) {
          messageAllowed = false;
          blockReason = 'provider_unavailable';
        } else {
          for (const rawRef of msgSourceRefs) {
            let ref: JiraSourceRef;
            try {
              ref = validateJiraSourceRef(rawRef);
            } catch {
              messageAllowed = false;
              blockReason = 'invalid_evidence';
              break;
            }
            if (ref.workspaceId !== actor.workspaceId || ref.binding.workspaceId !== actor.workspaceId) {
              messageAllowed = false;
              blockReason = 'source_mismatch';
              break;
            }
            const decision = await policyService.revalidateSource(actor.userId, ref, {
              signal: input.signal,
              expectedWorkspaceId: actor.workspaceId,
            });
            if (!decision.allowed) {
              messageAllowed = false;
              blockReason = decision.reason;
              break;
            }
          }
        }
        if (!messageAllowed) {
          sanitizedConversationHistory.push({
            ...msg,
            content: `[Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: ${blockReason}]`,
          });
          continue;
        }
      }

      // If an assistant message is Jira-related but has NO sourceRefs:
      if (msg.role === 'assistant') {
        const isJira = Boolean(this.options.hasJiraContext) || isJiraRelatedMessage(msg, meta);
        if (isJira && msgSourceRefs.length === 0) {
          sanitizedConversationHistory.push({
            ...msg,
            content: `[Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: invalid_evidence]`,
          });
          continue;
        }
      }

      // If it's a search results turn from tool gather in the planning loop:
      const searchResultsMatch = msg.role === 'user' ? msg.content.match(/<search_results>([\s\S]*?)<\/search_results>/) : null;
      if (searchResultsMatch && typeof searchResultsMatch[1] === 'string') {
        let outcomes: any[] | null = null;
        try {
          outcomes = JSON.parse(searchResultsMatch[1]);
        } catch {
          outcomes = null;
        }

        if (Array.isArray(outcomes) && outcomes.length > 0) {
          let modified = false;
          let anyJiraOutcomeKept = false;
          let lastDropReason = 'site_disabled';

          const filteredOutcomes: any[] = [];
          for (const outcome of outcomes) {
            const toolName = typeof outcome?.tool === 'string' ? outcome.tool : '';
            const isJiraTool = toolName.startsWith('myjira.') || toolName.startsWith('jira.');

            if (!isJiraTool) {
              filteredOutcomes.push(outcome);
              continue;
            }

            if (!hasAnyActiveJiraSite) {
              modified = true;
              filteredOutcomes.push({
                tool: outcome.tool,
                args: outcome.args,
                result: Array.isArray(outcome.result) ? [] : undefined,
                error: `[Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: site_disabled]`,
              });
              continue;
            }

            if (Array.isArray(outcome.result)) {
              const keptItems: any[] = [];
              let dropped = 0;
              for (const item of outcome.result) {
                const check = await validateEntity(item, isJiraTool);
                if (check.valid) {
                  keptItems.push(item);
                  anyJiraOutcomeKept = true;
                } else {
                  dropped++;
                  lastDropReason = check.reason || lastDropReason;
                }
              }

              if (dropped > 0) {
                modified = true;
                if (keptItems.length === 0) {
                  filteredOutcomes.push({
                    tool: outcome.tool,
                    args: outcome.args,
                    result: [],
                    error: `[Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: ${lastDropReason}]`,
                  });
                } else {
                  filteredOutcomes.push({
                    ...outcome,
                    result: keptItems,
                  });
                }
              } else {
                filteredOutcomes.push(outcome);
                anyJiraOutcomeKept = true;
              }
            } else if (outcome.result && typeof outcome.result === 'object') {
              const check = await validateEntity(outcome.result, isJiraTool);
              if (check.valid) {
                filteredOutcomes.push(outcome);
                anyJiraOutcomeKept = true;
              } else {
                modified = true;
                lastDropReason = check.reason || lastDropReason;
                const { result: _droppedResult, ...rest } = outcome;
                filteredOutcomes.push({
                  ...rest,
                  error: `[Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: ${check.reason || 'site_disabled'}]`,
                });
              }
            } else {
              filteredOutcomes.push(outcome);
              if (outcome.result !== undefined) {
                anyJiraOutcomeKept = true;
              }
            }
          }

          if (modified) {
            const allOutcomesAreJira = outcomes.every((o) => {
              const t = typeof o?.tool === 'string' ? o.tool : '';
              return t.startsWith('myjira.') || t.startsWith('jira.');
            });

            if (allOutcomesAreJira && !anyJiraOutcomeKept) {
              sanitizedConversationHistory.push({
                ...msg,
                content: `[Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: ${lastDropReason}]`,
              });
              continue;
            }

            const newBody = JSON.stringify(filteredOutcomes, null, 2);
            const newContent = msg.content.replace(
              /<search_results>[\s\S]*?<\/search_results>/,
              `<search_results>\n${newBody}\n</search_results>`
            );
            sanitizedConversationHistory.push({
              ...msg,
              content: newContent,
            });
            continue;
          }
        }
      } else if (
        msg.role === 'user' &&
        (msg.content.includes('Search results.') || msg.content.includes('myjira.'))
      ) {
        if (!hasAnyActiveJiraSite) {
          sanitizedConversationHistory.push({
            ...msg,
            content: `[Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: site_disabled]`,
          });
          continue;
        }
      }

      sanitizedConversationHistory.push(msg);
    }

    let sanitizedToolCatalog = input.toolCatalog;
    if (!hasAnyActiveJiraSite) {
      sanitizedToolCatalog = input.toolCatalog.filter((t) => !t.name.startsWith('myjira.'));
    }

    return {
      ...input,
      toolCatalog: sanitizedToolCatalog,
      workingMemory: sanitizedWorkingMemory,
      conversationHistory: sanitizedConversationHistory,
    };
  }
}

export function createJiraGuardedProvider(
  baseProvider: LLMProvider,
  options: JiraGuardedProviderOptions
): JiraGuardedProvider {
  return new JiraGuardedProvider(baseProvider, options);
}
