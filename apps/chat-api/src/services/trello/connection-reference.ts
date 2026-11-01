import { decryptCredentials } from '@wap/tool-adapters';
import type { PlanConnections } from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { TrelloTeamRepo } from '../../db/repositories/trello-team-repo.js';
import type { TrelloOAuthClient } from './oauth-client.js';
import type { TrelloTokenManager } from './token-manager.js';

export type TrelloConnectionReference = NonNullable<PlanConnections['trello']>;

export interface TrelloConnectionLookupOptions {
  credentialRepo: Pick<CredentialRepo, 'getPersonalConnectionStatus'> | Pick<CredentialRepo, 'getPersonalCredentials'>;
  teamRepo: Pick<TrelloTeamRepo, 'get'>;
  encryptionKey: string;
  tokens?: Pick<TrelloTokenManager, 'forConnection'>;
  client?: Pick<TrelloOAuthClient, 'boards'>;
  timeoutMs?: number;
}

export interface TrelloConnectionLookupResult {
  status: 'not_connected' | 'reconnect_required' | 'needs_scope' | 'needs_membership' | 'connected';
  connection?: TrelloConnectionReference;
  teamBoards: Array<{ boardId: string; boardName: string }>;
  memberBoards: Array<{ boardId: string; boardName: string }>;
  username?: string;
  memberId?: string;
}

export function createTrelloConnectionLookup(options: TrelloConnectionLookupOptions) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  return async (userId: string, scopeId = 'default'): Promise<TrelloConnectionLookupResult> => {
    const credRepo = options.credentialRepo as any;
    const record = credRepo.getPersonalConnectionStatus
      ? await credRepo.getPersonalConnectionStatus('trello', userId)
      : await credRepo.getPersonalCredentials('trello', userId);

    if (!record) {
      return { status: 'not_connected', teamBoards: [], memberBoards: [] };
    }

    if (record.status !== 'active') {
      return { status: 'reconnect_required', teamBoards: [], memberBoards: [] };
    }

    let username: string | undefined;
    let memberId: string | undefined;
    let refreshToken: string | undefined;
    try {
      const config = decryptCredentials(record.config, options.encryptionKey);
      username = config.username;
      memberId = config.memberId;
      refreshToken = config.refreshToken;
    } catch {
      return { status: 'reconnect_required', teamBoards: [], memberBoards: [] };
    }

    if (!refreshToken) {
      return { status: 'reconnect_required', teamBoards: [], memberBoards: [] };
    }

    const scope = options.teamRepo ? await options.teamRepo.get(scopeId) : null;
    if (!scope || !scope.boards || scope.boards.length === 0) {
      return {
        status: 'needs_scope',
        username,
        memberId,
        teamBoards: [],
        memberBoards: [],
      };
    }

    const teamBoards = scope.boards.map((b) => ({ boardId: b.boardId, boardName: b.boardName }));

    let callerBoards: Array<{ id: string; member: boolean }> = [];
    if (options.tokens && options.client) {
      try {
        const provider = options.tokens.forConnection(userId, record.id, refreshToken);
        const accessToken = await provider.getAccessToken();
        callerBoards = await options.client.boards(
          accessToken,
          scope.workspaceId,
          AbortSignal.timeout(timeoutMs)
        );
      } catch {
        return {
          status: 'reconnect_required',
          username,
          memberId,
          teamBoards,
          memberBoards: [],
        };
      }
    }

    const memberBoards = teamBoards.filter((tb) =>
      callerBoards.some((cb) => cb.id === tb.boardId && cb.member === true)
    );

    if (memberBoards.length === 0) {
      return {
        status: 'needs_membership',
        username,
        memberId,
        teamBoards,
        memberBoards: [],
      };
    }

    const boardIds = memberBoards.map((b) => b.boardId).sort();

    return {
      status: 'connected',
      username,
      memberId,
      teamBoards,
      memberBoards,
      connection: {
        credentialId: record.id,
        memberId: memberId || '',
        username: username || '',
        boardIds,
      },
    };
  };
}
