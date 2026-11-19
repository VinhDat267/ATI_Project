import { StepError } from '@wap/tool-adapters';
import type { CredentialRepo, PersonalSecretSession } from '../../db/repositories/credential-repo.js';
import { GitHubOAuthError, type GitHubOAuthClient } from './oauth-client.js';

const REFRESH_SKEW_MS = 60_000;
const LOCK_WAIT_SLACK_MS = 5_000;

export interface GitHubTokenManagerOptions {
  client: Pick<GitHubOAuthClient, 'refresh'>;
  credentials: Pick<CredentialRepo, 'rotatePersonalSecret' | 'markReconnectRequired'> &
    Partial<Pick<CredentialRepo, 'withPersonalSecretLock'>>;
  clock?: () => number;
  refreshTimeoutMs?: number;
  onReconnectRequired?: (userId: string) => void;
}

export interface GitHubConnectionSecrets {
  accessToken?: string;
  refreshToken?: string;
}

interface Cached {
  accessToken: string;
  expiresAt?: number;
}

type RefreshResult =
  | { kind: 'token'; entry: Cached; refreshToken: string }
  | { kind: 'lost_grant'; marked: boolean };

interface SecretStore {
  read?: PersonalSecretSession['read'];
  rotate(next: {
    previousRefreshToken: string;
    nextRefreshToken: string;
    nextAccessToken?: string;
    nextAccessTokenExpiresAt?: number;
  }): Promise<'rotated' | 'mismatch' | 'missing'>;
  markReconnectRequired(): Promise<boolean>;
}

function isNonExpiringGitHubToken(token?: string): boolean {
  const trimmed = token?.trim();
  return Boolean(
    trimmed &&
      (trimmed.startsWith('gho_') ||
        trimmed.startsWith('ghp_') ||
        trimmed.startsWith('github_pat_'))
  );
}

export class GitHubTokenManager {
  private cache = new Map<string, Cached>();
  private inflight = new Map<string, { promise: Promise<Cached>; forced: boolean }>();
  private generation = new Map<string, number>();
  private refreshTokens = new Map<string, string>();
  private revokedConnections = new Set<string>();
  private clock: () => number;
  private refreshTimeoutMs: number;

  constructor(private options: GitHubTokenManagerOptions) {
    this.clock = options.clock ?? Date.now;
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? 10_000;
  }

  private failure(
    category: 'AUTH_ERROR' | 'NETWORK' | 'SERVER_ERROR' | 'RATE_LIMIT',
    statusCode?: number
  ) {
    return new StepError({
      category,
      statusCode,
      retryable: false,
      details: { requestSent: false },
      message:
        category === 'AUTH_ERROR'
          ? 'GitHub cần được kết nối lại.'
          : `Không làm mới được quyền truy cập GitHub (${category}).`,
    });
  }

  forConnection(
    userId: string,
    credentialId: string,
    secrets: GitHubConnectionSecrets | string
  ): { getAccessToken(options?: { signal?: AbortSignal; forceRefresh?: boolean }): Promise<string> } {
    const raw: GitHubConnectionSecrets =
      typeof secrets === 'string' ? { accessToken: secrets } : secrets;
    const normalized: GitHubConnectionSecrets = isNonExpiringGitHubToken(raw.accessToken)
      ? { accessToken: raw.accessToken }
      : raw;
    const key = `${userId}:${credentialId}`;
    if (normalized.refreshToken?.trim() && !this.refreshTokens.has(key)) {
      this.refreshTokens.set(key, normalized.refreshToken.trim());
    }
    if (normalized.accessToken?.trim() && !this.cache.has(key) && !normalized.refreshToken?.trim()) {
      this.cache.set(key, { accessToken: normalized.accessToken.trim() });
    }
    return {
      getAccessToken: (options) => {
        if (normalized.refreshToken?.trim() && !this.refreshTokens.has(key)) {
          this.refreshTokens.set(key, normalized.refreshToken.trim());
        }
        return this.getAccessToken(userId, credentialId, normalized, options);
      },
    };
  }

  clear(userId: string): void {
    this.generation.set(userId, (this.generation.get(userId) ?? 0) + 1);
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${userId}:`)) this.cache.delete(key);
    }
    for (const key of [...this.refreshTokens.keys()]) {
      if (key.startsWith(`${userId}:`)) this.refreshTokens.delete(key);
    }
    for (const key of [...this.revokedConnections]) {
      if (key.startsWith(`${userId}:`)) this.revokedConnections.delete(key);
    }
  }

  private async getAccessToken(
    userId: string,
    credentialId: string,
    secrets: GitHubConnectionSecrets,
    options: { signal?: AbortSignal; forceRefresh?: boolean } = {}
  ): Promise<string> {
    if (options.signal?.aborted) throw this.failure('NETWORK');
    const key = `${userId}:${credentialId}`;

    if (this.revokedConnections.has(key)) {
      throw this.failure('AUTH_ERROR', 400);
    }

    const hasRefreshToken = Boolean(this.refreshTokens.get(key) || secrets.refreshToken?.trim());
    const cached = this.cache.get(key);

    if (!hasRefreshToken) {
      if (options.forceRefresh) {
        await this.handleLostGrant(userId, credentialId, key);
        throw this.failure('AUTH_ERROR', 401);
      }
      const token = cached?.accessToken ?? secrets.accessToken?.trim();
      if (!token) {
        await this.handleLostGrant(userId, credentialId, key);
        throw this.failure('AUTH_ERROR', 401);
      }
      return token;
    }

    if (
      !options.forceRefresh &&
      cached &&
      (cached.expiresAt === undefined || cached.expiresAt - this.clock() > REFRESH_SKEW_MS)
    ) {
      return cached.accessToken;
    }

    let existing = this.inflight.get(key);
    while (existing && options.forceRefresh && !existing.forced) {
      try {
        await this.wait(existing.promise, options.signal);
      } catch (err) {
        if (options.signal?.aborted) throw err;
        // Re-check connection state below after non-forced attempt settles.
      }
      if (this.revokedConnections.has(key)) {
        throw this.failure('AUTH_ERROR', 400);
      }
      existing = this.inflight.get(key);
    }
    if (!existing) {
      const forced = Boolean(options.forceRefresh);
      const promise = this.refresh(userId, credentialId, key, forced);
      const entry = { promise, forced };
      this.inflight.set(key, entry);
      const settle = () => {
        if (this.inflight.get(key) === entry) this.inflight.delete(key);
      };
      promise.then(settle, settle);
      existing = entry;
    }

    return (await this.wait(existing.promise, options.signal)).accessToken;
  }

  private async refresh(
    userId: string,
    credentialId: string,
    key: string,
    forceRefresh: boolean
  ): Promise<Cached> {
    if (this.revokedConnections.has(key)) {
      throw this.failure('AUTH_ERROR', 400);
    }

    const credentials = this.options.credentials;
    const generation = this.generation.get(userId) ?? 0;
    const initialRefreshToken = this.refreshTokens.get(key);
    let result: RefreshResult;
    try {
      const run = (store: SecretStore) =>
        this.refreshWith(initialRefreshToken, forceRefresh, store);
      if (credentials.withPersonalSecretLock) {
        result = await credentials.withPersonalSecretLock(
          {
            service: 'github',
            userId,
            credentialId,
            lockTimeoutMs: this.refreshTimeoutMs + LOCK_WAIT_SLACK_MS,
          },
          run
        );
      } else {
        result = await run({
          rotate: (next) =>
            credentials.rotatePersonalSecret({
              service: 'github',
              userId,
              credentialId,
              previousRefreshToken: next.previousRefreshToken,
              nextRefreshToken: next.nextRefreshToken,
              nextAccessToken: next.nextAccessToken,
            }),
          markReconnectRequired: () =>
            credentials.markReconnectRequired('github', userId, credentialId),
        });
      }
    } catch (error) {
      if (error instanceof StepError) throw error;
      // A lock, SQL or commit failure does not establish that the grant is invalid.
      throw this.failure('NETWORK');
    }

    if ((this.generation.get(userId) ?? 0) === generation) {
      if (result.kind === 'token') {
        if (result.refreshToken) {
          this.refreshTokens.set(key, result.refreshToken);
        } else {
          this.refreshTokens.delete(key);
        }
        this.cache.set(key, result.entry);
      } else {
        this.cache.delete(key);
        this.refreshTokens.delete(key);
        this.revokedConnections.add(key);
        if (result.marked) this.options.onReconnectRequired?.(userId);
      }
    }
    if (result.kind === 'lost_grant') throw this.failure('AUTH_ERROR', 400);
    return result.entry;
  }

  private async refreshWith(
    initialRefreshToken: string | undefined,
    forceRefresh: boolean,
    store: SecretStore
  ): Promise<RefreshResult> {
    let currentRefreshToken = initialRefreshToken;
    if (store.read) {
      const stored = await store.read();
      if (!stored || stored.status !== 'active') {
        return { kind: 'lost_grant', marked: await store.markReconnectRequired() };
      }
      if (!stored.refreshToken) {
        if (isNonExpiringGitHubToken(stored.accessToken) && !forceRefresh) {
          return {
            kind: 'token',
            refreshToken: '',
            entry: { accessToken: stored.accessToken! },
          };
        }
        return { kind: 'lost_grant', marked: await store.markReconnectRequired() };
      }
      currentRefreshToken = stored.refreshToken;
      if (
        !forceRefresh &&
        stored.accessToken &&
        stored.accessTokenExpiresAt !== undefined &&
        stored.accessTokenExpiresAt - this.clock() > REFRESH_SKEW_MS
      ) {
        return {
          kind: 'token',
          refreshToken: currentRefreshToken,
          entry: { accessToken: stored.accessToken, expiresAt: stored.accessTokenExpiresAt },
        };
      }
    }

    if (!currentRefreshToken) {
      throw this.failure('AUTH_ERROR', 400);
    }

    let tokens: { accessToken: string; refreshToken?: string; expiresInSeconds?: number };
    try {
      tokens = await this.options.client.refresh(
        currentRefreshToken,
        AbortSignal.timeout(this.refreshTimeoutMs)
      );
    } catch (error) {
      if (error instanceof GitHubOAuthError && error.kind === 'invalid_grant') {
        return { kind: 'lost_grant', marked: await store.markReconnectRequired() };
      }
      if (error instanceof GitHubOAuthError && error.status === 429) {
        throw this.failure('RATE_LIMIT', 429);
      }
      if (error instanceof GitHubOAuthError && error.kind !== 'network') {
        throw this.failure('SERVER_ERROR', error.status);
      }
      throw this.failure('NETWORK');
    }

    if (typeof tokens.refreshToken !== 'string' || !tokens.refreshToken.trim()) {
      return { kind: 'lost_grant', marked: await store.markReconnectRequired() };
    }

    const nextRefreshToken = tokens.refreshToken.trim();
    const expiresAt = tokens.expiresInSeconds
      ? this.clock() + tokens.expiresInSeconds * 1000
      : undefined;

    const rotateResult = await store.rotate({
      previousRefreshToken: currentRefreshToken,
      nextRefreshToken,
      nextAccessToken: tokens.accessToken,
      ...(expiresAt !== undefined ? { nextAccessTokenExpiresAt: expiresAt } : {}),
    });

    if (rotateResult !== 'rotated') {
      return { kind: 'lost_grant', marked: await store.markReconnectRequired() };
    }

    return {
      kind: 'token',
      refreshToken: nextRefreshToken,
      entry: { accessToken: tokens.accessToken, expiresAt },
    };
  }

  private async handleLostGrant(userId: string, credentialId: string, key: string): Promise<void> {
    this.cache.delete(key);
    this.refreshTokens.delete(key);
    this.revokedConnections.add(key);
    try {
      await this.options.credentials.markReconnectRequired('github', userId, credentialId);
    } catch {
      // still a lost grant
    }
    this.options.onReconnectRequired?.(userId);
  }

  private wait<T>(shared: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return shared;
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(this.failure('NETWORK'));
      signal.addEventListener('abort', abort, { once: true });
      shared.then(
        (value) => {
          signal.removeEventListener('abort', abort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        }
      );
    });
  }
}
