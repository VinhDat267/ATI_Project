import { StepError } from '@wap/tool-adapters';
import type { CredentialRepo, PersonalSecretSession } from '../../db/repositories/credential-repo.js';
import { TrelloOAuthError, type TrelloOAuthClient } from './oauth-client.js';

const REFRESH_SKEW_MS = 60_000;
/** Extra time a waiter gives the lock holder beyond its own refresh timeout. */
const LOCK_WAIT_SLACK_MS = 5_000;

export interface TrelloTokenManagerOptions {
  client: Pick<TrelloOAuthClient, 'refresh'>;
  /**
   * `withPersonalSecretLock` (real CredentialRepo) turns on the cross-process
   * refresh lock; test doubles without it keep the in-process behaviour.
   */
  credentials: Pick<CredentialRepo, 'rotatePersonalSecret' | 'markReconnectRequired'> &
    Partial<Pick<CredentialRepo, 'withPersonalSecretLock'>>;
  clock?: () => number;
  refreshTimeoutMs?: number;
  onReconnectRequired?: (userId: string) => void;
}

interface Cached {
  accessToken: string;
  expiresAt: number;
}

type RefreshResult =
  | { kind: 'token'; entry: Cached; refreshToken: string }
  | { kind: 'lost_grant'; marked: boolean };

/** Where a refresh reads and writes the stored secret. */
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

/**
 * Manages personal Trello OAuth access/refresh tokens.
 *
 * - In one process, concurrent callers for the same `(userId, credentialId)` share
 *   one in-flight refresh (`inflight`).
 * - Across processes, refreshes of one credential are serialized by a PostgreSQL
 *   advisory lock (`CredentialRepo.withPersonalSecretLock`). Under the lock the
 *   manager re-reads the row: if another instance already rotated, it adopts the
 *   stored refresh token and, when still valid, the stored access token, so the
 *   single-use refresh token is never sent twice. Rotation is still a
 *   compare-and-swap, and a disconnect/reconnect (row gone or new id) makes the
 *   in-flight refresh fail closed rather than resurrect the old grant.
 * - Lock or database failures are transient (NETWORK), never "reconnect".
 */
export class TrelloTokenManager {
  private cache = new Map<string, Cached>();
  private inflight = new Map<string, Promise<Cached>>();
  private generation = new Map<string, number>();
  private refreshTokens = new Map<string, string>();
  private revokedConnections = new Set<string>();
  private clock: () => number;
  private refreshTimeoutMs: number;

  constructor(private options: TrelloTokenManagerOptions) {
    this.clock = options.clock ?? Date.now;
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? 10_000;
  }

  private failure(category: 'AUTH_ERROR' | 'NETWORK' | 'SERVER_ERROR' | 'RATE_LIMIT', statusCode?: number) {
    return new StepError({
      category,
      statusCode,
      retryable: false,
      details: { requestSent: false },
      message:
        category === 'AUTH_ERROR'
          ? 'Trello cần được kết nối lại.'
          : `Không làm mới được quyền truy cập Trello (${category}).`,
    });
  }

  forConnection(
    userId: string,
    credentialId: string,
    initialRefreshToken: string
  ): { getAccessToken(options?: { signal?: AbortSignal; forceRefresh?: boolean }): Promise<string> } {
    const key = `${userId}:${credentialId}`;
    if (!this.refreshTokens.has(key)) {
      this.refreshTokens.set(key, initialRefreshToken);
    }
    return {
      getAccessToken: (options) => {
        // clear() prunes refresh tokens; a handle created earlier re-seeds its own
        // (the locked refresh re-reads the stored token anyway).
        if (!this.refreshTokens.has(key)) this.refreshTokens.set(key, initialRefreshToken);
        return this.getAccessToken(userId, credentialId, options);
      },
    };
  }

  clear(userId: string): void {
    this.generation.set(userId, (this.generation.get(userId) ?? 0) + 1);
    const prefix = `${userId}:`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
    for (const key of [...this.refreshTokens.keys()]) {
      if (key.startsWith(prefix)) this.refreshTokens.delete(key);
    }
    for (const key of [...this.revokedConnections]) {
      if (key.startsWith(prefix)) this.revokedConnections.delete(key);
    }
  }

  private async getAccessToken(
    userId: string,
    credentialId: string,
    options: { signal?: AbortSignal; forceRefresh?: boolean } = {}
  ): Promise<string> {
    if (options.signal?.aborted) throw this.failure('NETWORK');
    const key = `${userId}:${credentialId}`;

    if (this.revokedConnections.has(key)) {
      throw this.failure('AUTH_ERROR', 400);
    }

    const cached = this.cache.get(key);
    if (!options.forceRefresh && cached && cached.expiresAt - this.clock() > REFRESH_SKEW_MS) {
      return cached.accessToken;
    }

    let shared = this.inflight.get(key);
    if (!shared) {
      shared = this.refresh(userId, credentialId, key, Boolean(options.forceRefresh));
      this.inflight.set(key, shared);
      const settle = () => {
        if (this.inflight.get(key) === shared) this.inflight.delete(key);
      };
      shared.then(settle, settle);
    }

    return (await this.wait(shared, options.signal)).accessToken;
  }

  private async refresh(userId: string, credentialId: string, key: string, forceRefresh: boolean): Promise<Cached> {
    if (this.revokedConnections.has(key)) {
      throw this.failure('AUTH_ERROR', 400);
    }

    const credentials = this.options.credentials;
    const generation = this.generation.get(userId) ?? 0;
    const initialRefreshToken = this.refreshTokens.get(key);
    let result: RefreshResult;
    try {
      const run = (store: SecretStore) => this.refreshWith(initialRefreshToken, forceRefresh, store);
      if (credentials.withPersonalSecretLock) {
        result = await credentials.withPersonalSecretLock(
          { service: 'trello', userId, credentialId, lockTimeoutMs: this.refreshTimeoutMs + LOCK_WAIT_SLACK_MS },
          run
        );
      } else {
        result = await run({
          rotate: (next) =>
            credentials.rotatePersonalSecret({
              service: 'trello',
              userId,
              credentialId,
              previousRefreshToken: next.previousRefreshToken,
              nextRefreshToken: next.nextRefreshToken,
            }),
          markReconnectRequired: () => credentials.markReconnectRequired('trello', userId, credentialId),
        });
      }
    } catch (error) {
      if (error instanceof StepError) throw error;
      // A lock, SQL or commit failure does not establish that the grant is invalid.
      throw this.failure('NETWORK');
    }

    if ((this.generation.get(userId) ?? 0) === generation) {
      if (result.kind === 'token') {
        this.refreshTokens.set(key, result.refreshToken);
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
      if (!stored || stored.status !== 'active' || !stored.refreshToken) {
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

    if (!currentRefreshToken) throw this.failure('AUTH_ERROR', 400);

    let tokens: { accessToken: string; refreshToken?: string; expiresInSeconds: number };
    try {
      tokens = await this.options.client.refresh(
        currentRefreshToken,
        AbortSignal.timeout(this.refreshTimeoutMs)
      );
    } catch (error) {
      if (error instanceof TrelloOAuthError && error.kind === 'invalid_grant') {
        return { kind: 'lost_grant', marked: await store.markReconnectRequired() };
      }
      if (error instanceof TrelloOAuthError && error.status === 429) {
        throw this.failure('RATE_LIMIT', 429);
      }
      if (error instanceof TrelloOAuthError && error.kind !== 'network') {
        throw this.failure('SERVER_ERROR', error.status);
      }
      throw this.failure('NETWORK');
    }

    if (typeof tokens.refreshToken !== 'string' || !tokens.refreshToken.trim()) {
      return { kind: 'lost_grant', marked: await store.markReconnectRequired() };
    }

    const nextRefreshToken = tokens.refreshToken;
    const expiresAt = this.clock() + tokens.expiresInSeconds * 1000;
    const rotateResult = await store.rotate({
      previousRefreshToken: currentRefreshToken,
      nextRefreshToken,
      nextAccessToken: tokens.accessToken,
      nextAccessTokenExpiresAt: expiresAt,
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
