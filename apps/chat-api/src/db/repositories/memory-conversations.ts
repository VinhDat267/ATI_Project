import { randomUUID } from 'node:crypto';
import type { ConversationRow } from './conversation-repo.js';
import type { MessageRow } from './message-repo.js';
import { encodeConversationCursor, validateConversationPage, validateConversationTitle, type ConversationPageOptions } from './conversation-history.js';

/** Development fallback with the same history contract as PostgreSQL. */
export function createMemoryConversationRepositories() {
  const convMap = new Map<string, ConversationRow>();
  const msgMap = new Map<string, MessageRow[]>();
  const sorted = (userId: string) => [...convMap.values()].filter(row => row.user_id === userId)
    .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const convRepo = {
    async createConversation(userId: string): Promise<ConversationRow> {
      const row = { id: randomUUID(), user_id: userId, status: 'chatting', title: null, created_at: new Date(), updated_at: new Date() };
      convMap.set(row.id, row); msgMap.set(row.id, []);
      return { ...row };
    },
    async getConversation(id: string) { const row = convMap.get(id); return row ? { ...row } : null; },
    async listConversations(userId: string, limit = 50) { return sorted(userId).slice(0, limit).map(row => ({ ...row })); },
    async listConversationPage(userId: string, options: ConversationPageOptions = {}) {
      const { limit, search, cursor } = validateConversationPage(options);
      const timestamp = cursor ? Date.parse(cursor.updatedAt) : null;
      const rows = sorted(userId).filter(row => (!search || row.title?.toLowerCase().includes(search.toLowerCase()))
        && (!cursor || row.updated_at.getTime() < timestamp! || (row.updated_at.getTime() === timestamp && row.id < cursor.id)));
      const conversations = rows.slice(0, limit).map(row => ({ ...row }));
      const last = conversations.at(-1);
      return { conversations, nextCursor: rows.length > limit && last
        ? encodeConversationCursor({ updatedAt: last.updated_at.toISOString(), id: last.id }) : null };
    },
    async renameConversation(id: string, userId: string, title: string) {
      const validated = validateConversationTitle(title);
      const row = convMap.get(id);
      if (!row || row.user_id !== userId) return null;
      row.title = validated; row.updated_at = new Date();
      return { ...row };
    },
    async updateStatus(id: string, status: string) { const row = convMap.get(id); if (row) { row.status = status; row.updated_at = new Date(); } },
  };
  const msgRepo = {
    async createMessage(convId: string, role: string, content: string, metadata?: unknown): Promise<MessageRow> {
      const conversation = convMap.get(convId);
      if (!conversation) throw new Error('Conversation not found');
      const row = { id: randomUUID(), conv_id: convId, role, content, metadata: metadata ?? null, created_at: new Date() };
      msgMap.get(convId)!.push(row);
      if (role === 'user' && conversation.title === null) conversation.title = Array.from(content).slice(0, 60).join('');
      conversation.updated_at = new Date();
      return { ...row };
    },
    async listMessages(convId: string, limit = 100) { return (msgMap.get(convId) ?? []).slice(-limit).map(row => ({ ...row })); },
  };
  return { convRepo, msgRepo, convMap };
}
