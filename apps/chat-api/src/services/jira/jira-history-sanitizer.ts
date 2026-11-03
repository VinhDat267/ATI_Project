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

export class JiraHistorySanitizer {
  constructor(private readonly policy: Pick<JiraPolicyService, 'revalidateSource'>) {}

  private masked(message: MessageRow, reason: JiraModelBlockReason): MessageRow {
    return {
      ...message,
      content: `[Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: ${reason}]`,
      metadata: { masked: true, maskReason: reason },
    };
  }

  async sanitizeMessage(userId: string, message: MessageRow): Promise<MessageRow> {
    if (message.role === 'user' || message.role === 'system') return message;

    let metadata: unknown;
    try { metadata = typeof message.metadata === 'string' ? JSON.parse(message.metadata) : message.metadata; }
    catch { return message; }

    if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return message;
    }

    const metaObj = metadata as Record<string, unknown>;
    if (!isJiraRelatedMessage(message, metaObj)) {
      return message;
    }

    const sourceRefs = metaObj.sourceRefs;
    if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
      return this.masked(message, 'invalid_evidence');
    }
    for (const rawRef of sourceRefs) {
      let ref;
      try { ref = validateJiraSourceRef(rawRef); }
      catch { return this.masked(message, 'invalid_evidence'); }
      const decision = await this.policy.revalidateSource(userId, ref);
      if (!decision.allowed) return this.masked(message, decision.reason);
    }
    return message;
  }

  async sanitizeMessages(userId: string, messages: MessageRow[]): Promise<MessageRow[]> {
    return Promise.all(messages.map((message) => this.sanitizeMessage(userId, message)));
  }
}
