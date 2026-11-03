import { validateJiraSourceRef, type JiraModelBlockReason } from '@wap/tool-schemas';
import type { MessageRow } from '../../db/repositories/message-repo.js';
import type { JiraPolicyService } from './jira-policy-service.js';

export function isJiraRelatedMessage(message: { role: string; content?: string }, metadata: Record<string, unknown> | null): boolean {
  if (message.role === 'user' || message.role === 'system') return false;
  if (!metadata) return false;
  if (metadata.sourceRefs !== undefined) return true;
  if (metadata.ticket !== undefined || metadata.issue !== undefined) return true;
  if (metadata.containsJira === true || metadata.hasJiraSource === true) return true;
  if (metadata.service === 'myjira' || metadata.service === 'jira') return true;
  if (metadata.plan && typeof metadata.plan === 'object' && (metadata.plan as any).connections?.myjira) return true;
  if (Array.isArray(metadata.lookups) && metadata.lookups.some((l: any) => typeof l?.tool === 'string' && (l.tool.startsWith('myjira.') || l.tool.startsWith('jira.')))) return true;
  if (Array.isArray(metadata.usedDirectory) && metadata.usedDirectory.some((s: any) => s === 'myjira' || s === 'jira')) return true;
  return false;
}

export interface JiraSanitizeOptions {
  expectedWorkspaceId?: string;
  hasJiraContext?: boolean;
}

export class JiraHistorySanitizer {
  constructor(private readonly policy: Pick<JiraPolicyService, 'revalidateSource'>) {}

  private masked(message: MessageRow, reason: JiraModelBlockReason): MessageRow {
    return {
      ...message,
      content: `[Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: ${reason}]`,
      metadata: { masked: true, maskReason: reason },
    };
  }

  async sanitizeMessage(
    userId: string,
    message: MessageRow,
    optionsOrWorkspaceId?: string | JiraSanitizeOptions,
    legacyHasJiraContext?: boolean
  ): Promise<MessageRow> {
    if (message.role === 'user' || message.role === 'system') return message;

    let expectedWorkspaceId: string | undefined;
    let hasJiraContext = false;
    if (typeof optionsOrWorkspaceId === 'string') {
      expectedWorkspaceId = optionsOrWorkspaceId;
      hasJiraContext = Boolean(legacyHasJiraContext);
    } else if (optionsOrWorkspaceId && typeof optionsOrWorkspaceId === 'object') {
      expectedWorkspaceId = optionsOrWorkspaceId.expectedWorkspaceId;
      hasJiraContext = Boolean(optionsOrWorkspaceId.hasJiraContext);
    }

    let metadata: Record<string, unknown> | null = null;
    if (message.metadata) {
      if (typeof message.metadata === 'string') {
        try {
          const parsed = JSON.parse(message.metadata);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            metadata = parsed as Record<string, unknown>;
          }
        } catch {
          metadata = null;
        }
      } else if (typeof message.metadata === 'object' && !Array.isArray(message.metadata)) {
        metadata = message.metadata as Record<string, unknown>;
      }
    }

    if (metadata?.masked === true) {
      return message;
    }

    const isJira = hasJiraContext || isJiraRelatedMessage(message, metadata);
    if (!isJira) {
      return message;
    }

    const sourceRefs = metadata?.sourceRefs;
    if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
      return this.masked(message, 'invalid_evidence');
    }

    if (!this.policy || typeof this.policy.revalidateSource !== 'function') {
      return this.masked(message, 'provider_unavailable');
    }

    for (const rawRef of sourceRefs) {
      let ref;
      try { ref = validateJiraSourceRef(rawRef); }
      catch { return this.masked(message, 'invalid_evidence'); }
      if (expectedWorkspaceId && (ref.workspaceId !== expectedWorkspaceId || ref.binding?.workspaceId !== expectedWorkspaceId)) {
        return this.masked(message, 'source_mismatch');
      }
      const decision = await this.policy.revalidateSource(userId, ref, { expectedWorkspaceId });
      if (!decision.allowed) return this.masked(message, decision.reason ?? 'invalid_evidence');
    }
    return message;
  }

  async sanitizeMessages(
    userId: string,
    messages: MessageRow[],
    optionsOrWorkspaceId?: string | JiraSanitizeOptions,
    legacyHasJiraContext?: boolean
  ): Promise<MessageRow[]> {
    return Promise.all(messages.map((message) => this.sanitizeMessage(userId, message, optionsOrWorkspaceId, legacyHasJiraContext)));
  }
}
