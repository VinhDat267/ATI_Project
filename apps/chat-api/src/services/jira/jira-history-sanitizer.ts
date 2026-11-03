import { validateJiraSourceRef, type JiraModelBlockReason } from '@wap/tool-schemas';
import type { MessageRow } from '../../db/repositories/message-repo.js';
import type { JiraPolicyService } from './jira-policy-service.js';

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
    let metadata: unknown;
    try { metadata = typeof message.metadata === 'string' ? JSON.parse(message.metadata) : message.metadata; }
    catch { return this.masked(message, 'invalid_evidence'); }
    if (metadata == null) return message.role === 'user' ? message : this.masked(message, 'invalid_evidence');
    if (typeof metadata !== 'object' || Array.isArray(metadata)) return this.masked(message, 'invalid_evidence');
    const sourceRefs = (metadata as Record<string, unknown>).sourceRefs;
    if (sourceRefs === undefined) return message.role === 'user' ? message : this.masked(message, 'invalid_evidence');
    if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) return this.masked(message, 'invalid_evidence');
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
