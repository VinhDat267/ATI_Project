import { StepError } from '@wap/tool-adapters';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import { GitHubOAuthError, type GitHubOAuthClient } from './oauth-client.js';

const REFRESH_SKEW_MS = 60_000;

export interface GitHubTokenManagerOptions {
  client: Pick<GitHubOAuthClient, 'refresh'>;
  credentials: Pick<CredentialRepo, 'rotatePersonalSecret' | 'markReconnectRequired'>;
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

export class GitHubTokenManager {
  private cache = new Map<string, Cached>();
  private inflight = new Map<string, Promise<Cached>>();
  private generation = new Map<string, number>();
  private refreshTokens = new Map<string, string>();
  private revokedConnections = new Set<string>();
  private clock: () => number;
  private refreshTimeoutMs: number;

  constructor(private options: GitHubTokenManagerOptions) {
    this.clock = options.clock ?? Date.now;
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? 10_000;
  }

  private failure(category: 'AUTH_ERROR' | 'NETWORK' | 'SERVER_ERROR', statusCode?: number) {
    return new StepError({
      category,
      statusCode,
      retryable: false,
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
    const normalized: GitHubConnectionSecrets =
      typeof secrets === 'string' ? { accessToken: secrets } : secrets;
    const key = `${userId}:${credentialId}`;
    if (normalized.refreshToken?.trim() && !this.refreshTokens.has(key)) {
      this.refreshTokens.set(key, normalized.refreshToken.trim());
    }
    if (normalized.accessToken?.trim() && !this.cache.has(key) && !normalized.refreshToken?.trim()) {
      this.cache.set(key, { accessToken: normalized.accessToken.trim() });
    }
    return {
      getAccessToken: (options) => this.getAccessToken(userId, credentialId, normalized, options),
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

    let shared = this.inflight.get(key);
    if (!shared) {
      shared = this.refresh(userId, credentialId, key);
      this.inflight.set(key, shared);
      const settle = () => {
        if (this.inflight.get(key) === shared) this.inflight.delete(key);
      };
      shared.then(settle, settle);
    }

    return (await this.wait(shared, options.signal)).accessToken;
  }

  private async refresh(userId: string, credentialId: string, key: string): Promise<Cached> {
    if (this.revokedConnections.has(key)) {
      throw this.failure('AUTH_ERROR', 400);
    }

    const currentRefreshToken = this.refreshTokens.get(key);
    if (!currentRefreshToken) {
      throw this.failure('AUTH_ERROR', 400);
    }

    const generation = this.generation.get(userId) ?? 0;

    let tokens: { accessToken: string; refreshToken?: string; expiresInSeconds?: number };
    try {
      tokens = await this.options.client.refresh(
        currentRefreshToken,
        AbortSignal.timeout(this.refreshTimeoutMs)
      );
    } catch (error) {
      if (error instanceof GitHubOAuthError && error.kind === 'invalid_grant') {
        await this.handleLostGrant(userId, credentialId, key);
        throw this.failure('AUTH_ERROR', 400);
      }
      if (error instanceof GitHubOAuthError && error.kind !== 'network') {
        throw this.failure('SERVER_ERROR', error.status);
      }
      throw this.failure('NETWORK');
    }

    if (typeof tokens.refreshToken !== 'string' || !tokens.refreshToken.trim()) {
      await this.handleLostGrant(userId, credentialId, key);
      throw this.failure('AUTH_ERROR', 400);
    }

    const nextRefreshToken = tokens.refreshToken.trim();

    let rotateResult: 'rotated' | 'mismatch' | 'missing';
    try {
      rotateResult = await this.options.credentials.rotatePersonalSecret({
        service: 'github',
        userId,
        credentialId,
        previousRefreshToken: currentRefreshToken,
        nextRefreshToken,
        nextAccessToken: tokens.accessToken,
      });
    } catch {
      await this.handleLostGrant(userId, credentialId, key);
      throw this.failure('AUTH_ERROR', 400);
    }

    if (rotateResult !== 'rotated') {
      await this.handleLostGrant(userId, credentialId, key);
      throw this.failure('AUTH_ERROR', 400);
    }

    this.refreshTokens.set(key, nextRefreshToken);

    const entry: Cached = {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresInSeconds
        ? this.clock() + tokens.expiresInSeconds * 1000
        : undefined,
    };

    if ((this.generation.get(userId) ?? 0) === generation) {
      this.cache.set(key, entry);
    }

    return entry;
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
