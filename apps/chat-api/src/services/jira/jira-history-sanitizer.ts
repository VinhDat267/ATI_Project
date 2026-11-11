import { validateJiraSourceRef, type JiraModelBlockReason, type JiraSourceRef } from '@wap/tool-schemas';
import type { MessageRow } from '../../db/repositories/message-repo.js';
import type { JiraPolicyService } from './jira-policy-service.js';

function extractEmbeddedRefs(item: unknown): JiraSourceRef[] {
  if (!item || typeof item !== 'object') return [];
  const rec = item as Record<string, unknown>;
  const out: JiraSourceRef[] = [];
  if (rec._sourceRef) out.push(rec._sourceRef as JiraSourceRef);
  if (rec.sourceRef) out.push(rec.sourceRef as JiraSourceRef);
  if (Array.isArray(rec._sourceRefs)) {
    for (const r of rec._sourceRefs) if (r) out.push(r as JiraSourceRef);
  }
  if (Array.isArray(rec.sourceRefs)) {
    for (const r of rec.sourceRefs) if (r) out.push(r as JiraSourceRef);
  }
  return out;
}

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

  private async isJiraMemoryEntityAllowed(
    userId: string,
    entity: unknown,
    expectedWorkspaceId?: string
  ): Promise<boolean> {
    const refs = extractEmbeddedRefs(entity);
    if (refs.length === 0) return false;
    for (const rawRef of refs) {
      let ref: JiraSourceRef;
      try {
        ref = validateJiraSourceRef(rawRef);
      } catch {
        return false;
      }
      if (
        expectedWorkspaceId &&
        (ref.workspaceId !== expectedWorkspaceId || ref.binding?.workspaceId !== expectedWorkspaceId)
      ) {
        return false;
      }
      const decision = await this.policy.revalidateSource(userId, ref, { expectedWorkspaceId });
      if (!decision.allowed) return false;
    }
    return true;
  }

  private async sanitizeWorkingMemoryMessage(
    userId: string,
    message: MessageRow,
    metaObj: Record<string, unknown>,
    expectedWorkspaceId?: string
  ): Promise<MessageRow> {
    const rawState = metaObj.state;
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
      return message;
    }

    const state = { ...(rawState as Record<string, any>) };
    let modified = false;

    for (const key of Object.keys(state)) {
      if (key.startsWith('jira_')) {
        const entry = state[key];
        const unwrapped = entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry;
        if (Array.isArray(unwrapped)) {
          const kept: unknown[] = [];
          for (const item of unwrapped) {
            if (await this.isJiraMemoryEntityAllowed(userId, item, expectedWorkspaceId)) {
              kept.push(item);
            } else {
              modified = true;
            }
          }
          if (kept.length === 0) {
            delete state[key];
            modified = true;
          } else if (kept.length !== unwrapped.length) {
            state[key] =
              entry && typeof entry === 'object' && 'value' in entry
                ? { ...entry, value: kept }
                : kept;
          }
        } else {
          const allowed = await this.isJiraMemoryEntityAllowed(userId, unwrapped, expectedWorkspaceId);
          if (!allowed) {
            delete state[key];
            modified = true;
          }
        }
      }
    }

    if (state.__observed && typeof state.__observed === 'object') {
      const hasValueWrapper = 'value' in state.__observed && state.__observed.value && typeof state.__observed.value === 'object';
      const obsMap: Record<string, any> = hasValueWrapper
        ? { ...(state.__observed.value as Record<string, any>) }
        : { ...(state.__observed as Record<string, any>) };
      let obsModified = false;

      for (const [obsKey, obsVal] of Object.entries(obsMap)) {
        if (obsKey.startsWith('jira_')) {
          if (Array.isArray(obsVal)) {
            const kept: unknown[] = [];
            for (const item of obsVal) {
              if (await this.isJiraMemoryEntityAllowed(userId, item, expectedWorkspaceId)) {
                kept.push(item);
              } else {
                obsModified = true;
              }
            }
            if (kept.length === 0) {
              delete obsMap[obsKey];
              obsModified = true;
            } else if (kept.length !== obsVal.length) {
              obsMap[obsKey] = kept;
            }
          } else {
            delete obsMap[obsKey];
            obsModified = true;
          }
        }
      }

      if (obsModified) {
        modified = true;
        state.__observed = hasValueWrapper
          ? { ...state.__observed, value: obsMap }
          : obsMap;
      }
    }

    if (!modified) return message;
    const nextMeta = { ...metaObj, state };
    return {
      ...message,
      metadata: typeof message.metadata === 'string' ? JSON.stringify(nextMeta) : nextMeta,
    };
  }

  async sanitizeMessage(userId: string, message: MessageRow, expectedWorkspaceId?: string): Promise<MessageRow> {
    if (message.role === 'user') return message;

    let metadata: unknown;
    try { metadata = typeof message.metadata === 'string' ? JSON.parse(message.metadata) : message.metadata; }
    catch { return message; }

    if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return message;
    }

    const metaObj = metadata as Record<string, unknown>;
    if (message.role === 'system') {
      if (metaObj.type === 'working_memory') {
        return this.sanitizeWorkingMemoryMessage(userId, message, metaObj, expectedWorkspaceId);
      }
      return message;
    }
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
      if (expectedWorkspaceId && (ref.workspaceId !== expectedWorkspaceId || ref.binding?.workspaceId !== expectedWorkspaceId)) {
        return this.masked(message, 'source_mismatch');
      }
      const decision = await this.policy.revalidateSource(userId, ref, { expectedWorkspaceId });
      if (!decision.allowed) return this.masked(message, decision.reason ?? 'invalid_evidence');
    }
    return message;
  }

  async sanitizeMessages(userId: string, messages: MessageRow[], expectedWorkspaceId?: string): Promise<MessageRow[]> {
    return Promise.all(messages.map((message) => this.sanitizeMessage(userId, message, expectedWorkspaceId)));
  }
}
