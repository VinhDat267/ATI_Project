import type { ChatMessage } from '../types';

/** Use the same visible messages and timestamps for initial loads and conflict reloads. */
export function normalizeConversationMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(message => message.metadata?.type !== 'working_memory' || message.content)
    .map(message => ({ ...message, role: message.role || 'user', content: message.content || '', timestamp: message.created_at || message.timestamp }));
}
