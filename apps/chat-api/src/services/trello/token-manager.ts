import { randomUUID } from 'node:crypto';
import { StepError } from '@wap/tool-adapters';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import { TrelloOAuthError, type TrelloOAuthClient } from './oauth-client.js';

const REFRESH_SKEW_MS = 60_000;
const REFRESH_POLL_INTERVAL_MS = 50;

export interface TrelloTokenManagerOptions {
  client: Pick<TrelloOAuthClient, 'refresh'>;
  credentials: Pick<CredentialRepo, 'rotatePersonalSecret' | 'markReconnectRequired'> &
    Partial<
      Pick<CredentialRepo, 'pollPersonalRefresh' | 'claimPersonalRefresh' | 'commitPersonalRefresh' | 'failPersonalRefresh'>
    >;
  clock?: () => number;
  refreshTimeoutMs?: number;
  onReconnectRequired?: (userId: string) => void;
}

interface Cached {
  accessToken: string;
  expiresAt: number;
}

/**
 * Manages personal Trello OAuth access/refresh tokens with in-process single-flight
 * refresh deduplication (`inflight` map) and PostgreSQL-coordinated single-use
 * refresh rotation when backed by `CredentialRepo`.
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

  private failure(category: 'AUTH_ERROR' | 'NETWORK' | 'SERVER_ERROR', statusCode?: number) {
    return new StepError({
      category,
      statusCode,
      retryable: false,
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
      getAccessToken: (options) => this.getAccessToken(userId, credentialId, options),
    };
  }

  clear(userId: string): void {
    this.generation.set(userId, (this.generation.get(userId) ?? 0) + 1);
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${userId}:`)) this.cache.delete(key);
    }
    for (const key of [...this.revokedConnections]) {
      if (key.startsWith(`${userId}:`)) this.revokedConnections.delete(key);
    }
  }

  private isDbCoordinated(): boolean {
    const creds = this.options.credentials;
    return Boolean(
      creds.pollPersonalRefresh &&
        creds.claimPersonalRefresh &&
        creds.commitPersonalRefresh &&
        creds.failPersonalRefresh
    );
  }

  private resolveExpiresInMs(tokens: { expiresInSeconds?: number }): number {
    const raw = Number(tokens.expiresInSeconds ?? (tokens as any).expiresIn ?? 3600);
    const seconds = Number.isFinite(raw) && raw >= 0 ? raw : 3600;
    return seconds * 1000;
  }

  private async getAccessToken(
    userId: string,
    credentialId: string,
    options: { signal?: AbortSignal; forceRefresh?: boolean } = {}
  ): Promise<string> {
    if (options.signal?.aborted) throw this.failure('NETWORK');
    const key = `${userId}:${credentialId}`;

    if (this.isDbCoordinated()) {
      return await this.getAccessTokenCoordinated(userId, credentialId, key, options);
    }

    if (this.revokedConnections.has(key)) {
      throw this.failure('AUTH_ERROR', 400);
    }

    const cached = this.cache.get(key);
    if (!options.forceRefresh && cached && cached.expiresAt - this.clock() > REFRESH_SKEW_MS) {
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

  private async getAccessTokenCoordinated(
    userId: string,
    credentialId: string,
    key: string,
    options: { signal?: AbortSignal; forceRefresh?: boolean }
  ): Promise<string> {
    const existing = this.inflight.get(key);
    if (existing && !options.forceRefresh) {
      return (await this.wait(existing, options.signal)).accessToken;
    }

    const snapshot = await this.options.credentials.pollPersonalRefresh!({
      service: 'trello',
      userId,
      credentialId,
    });
    if (options.signal?.aborted) throw this.failure('NETWORK');

    if (snapshot.kind === 'missing') {
      this.cache.delete(key);
      throw this.failure('AUTH_ERROR', 400);
    }
    if (snapshot.kind === 'reconnect_required') {
      this.cache.delete(key);
      this.revokedConnections.add(key);
      this.options.onReconnectRequired?.(userId);
      throw this.failure('AUTH_ERROR', 400);
    }

    if (
      !options.forceRefresh &&
      snapshot.refreshState === 'idle' &&
      snapshot.accessToken &&
      typeof snapshot.expiresAtMs === 'number' &&
      snapshot.expiresAtMs - this.clock() > REFRESH_SKEW_MS
    ) {
      const entry: Cached = { accessToken: snapshot.accessToken, expiresAt: snapshot.expiresAtMs };
      this.cache.set(key, entry);
      return entry.accessToken;
    }

    let shared = !options.forceRefresh ? this.inflight.get(key) : undefined;
    if (!shared) {
      shared = this.coordinateDbRefresh(
        userId,
        credentialId,
        key,
        snapshot.tokenVersion,
        Boolean(options.forceRefresh)
      );
      this.inflight.set(key, shared);
      const settle = () => {
        if (this.inflight.get(key) === shared) this.inflight.delete(key);
      };
      shared.then(settle, settle);
    }

    return (await this.wait(shared, options.signal)).accessToken;
  }

  private async coordinateDbRefresh(
    userId: string,
    credentialId: string,
    key: string,
    initialVersion: number,
    forceRefresh: boolean
  ): Promise<Cached> {
    const deadline = Date.now() + this.refreshTimeoutMs + 1000;
    for (;;) {
      const claim = await this.options.credentials.claimPersonalRefresh!({
        service: 'trello',
        userId,
        credentialId,
        minTokenVersion: initialVersion,
        forceRefresh,
        refreshTimeoutMs: this.refreshTimeoutMs,
        attemptId: randomUUID(),
        nowMs: this.clock(),
      });

      if (claim.kind === 'missing') {
        this.cache.delete(key);
        throw this.failure('AUTH_ERROR', 400);
      }
      if (claim.kind === 'reconnect_required') {
        this.cache.delete(key);
        this.revokedConnections.add(key);
        this.options.onReconnectRequired?.(userId);
        throw this.failure('AUTH_ERROR', 400);
      }
      if (claim.kind === 'failed_closed') {
        this.cache.delete(key);
        this.revokedConnections.add(key);
        this.options.onReconnectRequired?.(userId);
        throw this.failure('AUTH_ERROR', 400);
      }
      if (claim.kind === 'already_refreshed') {
        const entry: Cached = { accessToken: claim.accessToken, expiresAt: claim.expiresAtMs };
        this.cache.set(key, entry);
        return entry;
      }
      if (claim.kind === 'busy') {
        const polled = await this.pollOtherWorkerRefresh(
          userId,
          credentialId,
          key,
          initialVersion,
          forceRefresh,
          deadline
        );
        if (polled) return polled;
        continue;
      }

      return await this.executeClaimedRefresh(userId, credentialId, key, claim.attemptId, claim.refreshToken);
    }
  }

  private async pollOtherWorkerRefresh(
    userId: string,
    credentialId: string,
    key: string,
    initialVersion: number,
    forceRefresh: boolean,
    deadline: number
  ): Promise<Cached | null> {
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, REFRESH_POLL_INTERVAL_MS));
      const snap = await this.options.credentials.pollPersonalRefresh!({
        service: 'trello',
        userId,
        credentialId,
      });
      if (snap.kind === 'missing') {
        this.cache.delete(key);
        throw this.failure('AUTH_ERROR', 400);
      }
      if (snap.kind === 'reconnect_required') {
        this.cache.delete(key);
        this.revokedConnections.add(key);
        this.options.onReconnectRequired?.(userId);
        throw this.failure('AUTH_ERROR', 400);
      }
      if (snap.refreshState !== 'refreshing') {
        if (snap.tokenVersion > initialVersion && snap.accessToken && typeof snap.expiresAtMs === 'number') {
          const entry: Cached = { accessToken: snap.accessToken, expiresAt: snap.expiresAtMs };
          this.cache.set(key, entry);
          return entry;
        }
        return null;
      }
      if ((snap.refreshElapsedMs ?? 0) >= this.refreshTimeoutMs) {
        return null;
      }
    }
    return null;
  }

  private async executeClaimedRefresh(
    userId: string,
    credentialId: string,
    key: string,
    attemptId: string,
    refreshToken: string
  ): Promise<Cached> {
    const generation = this.generation.get(userId) ?? 0;
    const timeoutController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(new Error(`Refresh request timed out after ${this.refreshTimeoutMs}ms`));
    }, this.refreshTimeoutMs);

    let tokens: { accessToken: string; refreshToken?: string; expiresInSeconds: number };
    try {
      tokens = await this.options.client.refresh(refreshToken, timeoutController.signal);
    } catch (error) {
      const reason =
        error instanceof TrelloOAuthError && error.kind === 'invalid_grant'
          ? 'INVALID_GRANT'
          : timedOut || timeoutController.signal.aborted
            ? 'REFRESH_TIMEOUT'
            : 'CRASH_UNKNOWN_ROTATION';
      await this.failClaimedRefresh(userId, credentialId, key, attemptId, reason);
      throw this.failure('AUTH_ERROR', 400);
    } finally {
      clearTimeout(timer);
    }

    if (typeof tokens.refreshToken !== 'string' || !tokens.refreshToken.trim()) {
      await this.failClaimedRefresh(userId, credentialId, key, attemptId, 'MISSING_ROTATING_TOKEN');
      throw this.failure('AUTH_ERROR', 400);
    }

    const expiresAtMs = this.clock() + this.resolveExpiresInMs(tokens);
    let commitOutcome: 'committed' | 'disconnected';
    try {
      commitOutcome = await this.options.credentials.commitPersonalRefresh!({
        service: 'trello',
        userId,
        credentialId,
        attemptId,
        nextRefreshToken: tokens.refreshToken,
        nextAccessToken: tokens.accessToken,
        accessExpiresAt: new Date(expiresAtMs),
      });
    } catch {
      await this.failClaimedRefresh(userId, credentialId, key, attemptId, 'PERSIST_FAILED_AFTER_ROTATION');
      throw this.failure('AUTH_ERROR', 400);
    }

    if (commitOutcome !== 'committed') {
      // Disconnect Wins: discard refreshed tokens and avoid reconnect callbacks.
      this.cache.delete(key);
      throw this.failure('AUTH_ERROR', 400);
    }

    const entry: Cached = { accessToken: tokens.accessToken, expiresAt: expiresAtMs };
    if ((this.generation.get(userId) ?? 0) === generation) {
      this.cache.set(key, entry);
    }
    return entry;
  }

  private async failClaimedRefresh(
    userId: string,
    credentialId: string,
    key: string,
    attemptId: string,
    statusReason: string
  ): Promise<void> {
    this.cache.delete(key);
    const fenced = await this.options.credentials
      .failPersonalRefresh!({
        service: 'trello',
        userId,
        credentialId,
        attemptId,
        statusReason,
      })
      .catch(() => 'disconnected' as const);
    if (fenced === 'fenced') {
      this.revokedConnections.add(key);
      this.options.onReconnectRequired?.(userId);
    }
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

    let tokens: { accessToken: string; refreshToken?: string; expiresInSeconds: number };
    try {
      tokens = await this.options.client.refresh(
        currentRefreshToken,
        AbortSignal.timeout(this.refreshTimeoutMs)
      );
    } catch (error) {
      if (error instanceof TrelloOAuthError && error.kind === 'invalid_grant') {
        await this.handleLostGrant(userId, credentialId, key);
        throw this.failure('AUTH_ERROR', 400);
      }
      if (error instanceof TrelloOAuthError && error.kind !== 'network') {
        throw this.failure('SERVER_ERROR', error.status);
      }
      throw this.failure('NETWORK');
    }

    if (typeof tokens.refreshToken !== 'string' || !tokens.refreshToken.trim()) {
      await this.handleLostGrant(userId, credentialId, key);
      throw this.failure('AUTH_ERROR', 400);
    }

    const nextRefreshToken = tokens.refreshToken;

    let rotateResult: 'rotated' | 'mismatch' | 'missing';
    try {
      rotateResult = await this.options.credentials.rotatePersonalSecret({
        service: 'trello',
        userId,
        credentialId,
        previousRefreshToken: currentRefreshToken,
        nextRefreshToken,
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
      expiresAt: this.clock() + tokens.expiresInSeconds * 1000,
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
      await this.options.credentials.markReconnectRequired('trello', userId, credentialId);
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
