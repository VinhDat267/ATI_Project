import { authStorage } from './auth-storage';
import { sharesAuthSession } from './api-client';

const versions = new Map<string, number>();
/** Invalidate every reader of this conversation, including route and SSE reconciliation reads. */
export function invalidateConversationReads(id: string): void {
  versions.set(id, (versions.get(id) ?? 0) + 1);
}
export function captureConversationRead(id: string): () => boolean {
  const version = versions.get(id) ?? 0, initial = authStorage.getStoredTokens();
  return () => {
    const latest = authStorage.getStoredTokens();
    return (versions.get(id) ?? 0) === version && latest.user?.id === initial.user?.id &&
      ((latest.accessToken === initial.accessToken && latest.refreshToken === initial.refreshToken) ||
        sharesAuthSession(initial.accessToken, latest.accessToken));
  };
}
