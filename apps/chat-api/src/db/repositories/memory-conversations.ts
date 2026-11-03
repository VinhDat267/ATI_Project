import { randomUUID } from 'node:crypto';
import type { ConversationRow, ConversationScope } from './conversation-repo.js';
import type { MessageRow } from './message-repo.js';
import {
  encodeConversationCursor,
  validateConversationPage,
  validateConversationTitle,
  type ConversationPageOptions,
} from './conversation-history.js';

/** Development fallback with the same history contract as PostgreSQL. */
export function createMemoryConversationRepositories() {
  const convMap = new Map<string, ConversationRow>();
  const msgMap = new Map<string, MessageRow[]>();

  const matchesScope = (row: ConversationRow, scope?: ConversationScope): boolean => {
    if (!scope) return true;
    if (scope.workspaceMode === 'personal') {
      return (row.workspace_mode === 'personal' || row.workspace_mode === 'legacy' || !row.workspace_mode) && !row.workspace_id;
    }
    if (scope.workspaceMode === 'organization' && scope.workspaceId) {
      return row.workspace_mode === 'organization' && row.workspace_id === scope.workspaceId;
    }
    if (scope.workspaceMode === 'legacy') {
      return !row.workspace_id;
    }
    return true;
  };

  const sorted = (userId: string, scope?: ConversationScope) =>
    [...convMap.values()]
      .filter((row) => row.user_id === userId && matchesScope(row, scope))
      .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

  const convRepo = {
    async createConversation(
      userId: string,
      titleOrScope?: string | ConversationScope,
      scopeArg?: ConversationScope
    ): Promise<ConversationRow> {
      let title: string | null = null;
      let scope: ConversationScope | undefined = scopeArg;
      if (typeof titleOrScope === 'string') {
        title = titleOrScope;
        scope = scopeArg;
      } else if (titleOrScope && typeof titleOrScope === 'object') {
        scope = titleOrScope;
      }
      const workspaceMode = scope?.workspaceMode ?? 'legacy';
      const workspaceId = workspaceMode === 'organization' ? scope?.workspaceId ?? null : null;

      const row: ConversationRow = {
        id: randomUUID(),
        user_id: userId,
        status: 'chatting',
        title,
        workspace_id: workspaceId,
        workspace_mode: workspaceMode,
        created_at: new Date(),
        updated_at: new Date(),
      };
      convMap.set(row.id, row);
      msgMap.set(row.id, []);
      return { ...row };
    },
    async getConversation(id: string) {
      const row = convMap.get(id);
      return row ? { ...row } : null;
    },
    async getConversationForUser(userId: string, id: string, scope?: ConversationScope) {
      const row = convMap.get(id);
      if (!row || row.user_id !== userId || !matchesScope(row, scope)) return null;
      return { ...row };
    },
    async listConversations(userId: string, limit = 50, scope?: ConversationScope) {
      return sorted(userId, scope)
        .slice(0, limit)
        .map((row) => ({ ...row }));
    },
    async listConversationPage(userId: string, options: ConversationPageOptions = {}, scope?: ConversationScope) {
      const { limit, search, cursor } = validateConversationPage(options);
      const timestamp = cursor ? Date.parse(cursor.updatedAt) : null;
      const rows = sorted(userId, scope).filter(
        (row) =>
          (!search || row.title?.toLowerCase().includes(search.toLowerCase())) &&
          (!cursor ||
            row.updated_at.getTime() < timestamp! ||
            (row.updated_at.getTime() === timestamp && row.id < cursor.id))
      );
      const conversations = rows.slice(0, limit).map((row) => ({ ...row }));
      const last = conversations.at(-1);
      return {
        conversations,
        nextCursor:
          rows.length > limit && last
            ? encodeConversationCursor({ updatedAt: last.updated_at.toISOString(), id: last.id })
            : null,
      };
    },
    async renameConversation(id: string, userId: string, title: string) {
      const validated = validateConversationTitle(title);
      const row = convMap.get(id);
      if (!row || row.user_id !== userId) return null;
      row.title = validated;
      row.updated_at = new Date();
      return { ...row };
    },
    async updateStatus(id: string, status: string) {
      const row = convMap.get(id);
      if (row) {
        row.status = status;
        row.updated_at = new Date();
      }
    },
  };
  const msgRepo = {
    async createMessage(convId: string, role: string, content: string, metadata?: unknown): Promise<MessageRow> {
      const conversation = convMap.get(convId);
      if (!conversation) throw new Error('Conversation not found');
      const row = {
        id: randomUUID(),
        conv_id: convId,
        role,
        content,
        metadata: metadata ?? null,
        created_at: new Date(),
      };
      msgMap.get(convId)!.push(row);
      if (role === 'user' && conversation.title === null) conversation.title = Array.from(content).slice(0, 60).join('');
      conversation.updated_at = new Date();
      return { ...row };
    },
    async listMessages(convId: string, limit = 100) {
      return (msgMap.get(convId) ?? []).slice(-limit).map((row) => ({ ...row }));
    },
  };
  return { convRepo, msgRepo, convMap };
}
