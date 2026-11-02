import { decryptCredentials } from '@wap/tool-adapters';
import type { PlanConnections } from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { GitHubTeamRepo, GitHubTeamRepoItem } from '../../db/repositories/github-team-repo.js';
import type { GitHubTokenManager } from './token-manager.js';
import { GitHubOAuthError, type GitHubOAuthClient } from './oauth-client.js';

export type GitHubLookupStatus =
  | 'not_connected'
  | 'reconnect_required'
  | 'needs_scope'
  | 'needs_membership'
  | 'connected';

export interface GitHubConnectionLookupResult {
  status: GitHubLookupStatus;
  connection?: NonNullable<PlanConnections['github']>;
  teamRepos: GitHubTeamRepoItem[];
  memberRepos: GitHubTeamRepoItem[];
}

export function createGitHubConnectionLookup(deps: {
  credentialRepo: CredentialRepo;
  teamRepo: GitHubTeamRepo;
  encryptionKey: string;
  tokens: GitHubTokenManager;
  client: GitHubOAuthClient;
}) {
  return async (userId: string): Promise<GitHubConnectionLookupResult> => {
    const scope = await deps.teamRepo.get();
    const teamRepos = scope?.repos ?? [];

    const record = await deps.credentialRepo.getPersonalConnectionStatus('github', userId);
    if (!record) {
      return { status: 'not_connected', teamRepos, memberRepos: [] };
    }
    if (record.status !== 'active') {
      return { status: 'reconnect_required', teamRepos, memberRepos: [] };
    }

    let accessToken: string | undefined;
    let refreshToken: string | undefined;
    let githubUserId: string | undefined;
    let login: string | undefined;
    try {
      const config = decryptCredentials(record.config, deps.encryptionKey);
      accessToken = config.accessToken;
      refreshToken = typeof config.refreshToken === 'string' ? config.refreshToken : undefined;
      githubUserId = config.githubUserId;
      login = config.login;
    } catch {
      return { status: 'reconnect_required', teamRepos, memberRepos: [] };
    }

    if (!accessToken || !githubUserId || !login) {
      return { status: 'reconnect_required', teamRepos, memberRepos: [] };
    }

    if (!scope || scope.repos.length === 0) {
      return { status: 'needs_scope', teamRepos: [], memberRepos: [] };
    }

    try {
      const provider = deps.tokens.forConnection(userId, record.id, { accessToken, refreshToken });
      const liveAccessToken = await provider.getAccessToken({ signal: AbortSignal.timeout(10_000) });
      const fetchRepos = (deps.client as any).repos ?? (deps.client as any).repositories;
      const callerRepos: any[] = await fetchRepos.call(
        deps.client,
        liveAccessToken,
        AbortSignal.timeout(10_000),
      );
      const memberFullNames = new Set(
        callerRepos
          .filter((r: any) => r.member !== false)
          .map((r: any) => String(r.fullName).toLowerCase()),
      );
      const memberIds = new Set(
        callerRepos
          .filter((r: any) => r.member !== false)
          .map((r: any) => String(r.id)),
      );
      const memberRepos = scope.repos.filter(
        (r) => memberFullNames.has(r.fullName.toLowerCase()) || memberIds.has(String(r.repoId)),
      );

      if (memberRepos.length === 0) {
        return { status: 'needs_membership', teamRepos, memberRepos: [] };
      }

      return {
        status: 'connected',
        connection: {
          credentialId: record.id,
          githubUserId,
          login,
          repos: memberRepos.map((r) => r.fullName),
        },
        teamRepos,
        memberRepos,
      };
    } catch (err) {
      if (err instanceof GitHubOAuthError && err.kind === 'invalid_grant') {
        await deps.credentialRepo.markReconnectRequired('github', userId, record.id).catch(() => {});
      }
      return { status: 'reconnect_required', teamRepos, memberRepos: [] };
    }
  };
}
