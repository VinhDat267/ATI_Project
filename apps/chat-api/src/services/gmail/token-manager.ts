import { StepError, type GmailAccessTokenProvider } from '@wap/tool-adapters';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import { GmailOAuthError, type GmailOAuthClient } from './oauth-client.js';

const REFRESH_SKEW_MS = 60_000;

export interface GmailTokenManagerOptions {
  client: Pick<GmailOAuthClient, 'refresh'>;
  credentials: Pick<CredentialRepo, 'markReconnectRequired'>;
  service?: 'gmail' | 'mycalendar';
  serviceLabel?: string;
  clock?: () => number;
  /** Deadline of the shared refresh, independent of any caller's signal. */
  refreshTimeoutMs?: number;
  /** Called after the grant is found gone, so cached adapters of this person can be dropped. */
  onReconnectRequired?: (userId: string) => void;
}

interface Cached { accessToken: string; expiresAt: number }

/**
 * Access tokens live only in this process, keyed by person and credential id.
 * One refresh per credential at a time; a caller that cancels stops waiting
 * without cancelling the refresh other callers share.
 */
export class GmailTokenManager {
  readonly service: 'gmail' | 'mycalendar';
  readonly serviceLabel: string;
  private cache = new Map<string, Cached>();
  private inflight = new Map<string, Promise<Cached>>();
  private generation = new Map<string, number>();
  private clock: () => number;
  private refreshTimeoutMs: number;

  constructor(private options: GmailTokenManagerOptions) {
    this.service = options.service ?? 'gmail';
    this.serviceLabel = options.serviceLabel ?? (this.service === 'mycalendar' ? 'Google Calendar' : 'Gmail');
    this.clock = options.clock ?? Date.now;
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? 10_000;
  }

  private failure(category: 'AUTH_ERROR' | 'NETWORK' | 'SERVER_ERROR', statusCode?: number) {
    return new StepError({
      category, statusCode, retryable: false,
      message: category === 'AUTH_ERROR' ? `${this.serviceLabel} cần được kết nối lại.` : `Không làm mới được quyền truy cập ${this.serviceLabel} (${category}).`,
    });
  }

  forConnection(userId: string, credentialId: string, refreshToken: string): GmailAccessTokenProvider {
    return { getAccessToken: (options) => this.getAccessToken(userId, credentialId, refreshToken, options) };
  }

  /** Forget every token of this person (reconnect, disconnect, reconnect_required). */
  clear(userId: string): void {
    this.generation.set(userId, (this.generation.get(userId) ?? 0) + 1);
    for (const key of [...this.cache.keys()]) if (key.startsWith(`${userId}:`)) this.cache.delete(key);
    for (const key of [...this.inflight.keys()]) if (key.startsWith(`${userId}:`)) this.inflight.delete(key);
  }

  private async getAccessToken(userId: string, credentialId: string, refreshToken: string,
    options: { signal?: AbortSignal; forceRefresh?: boolean } = {}): Promise<string> {
    if (options.signal?.aborted) throw this.failure('NETWORK');
    const key = `${userId}:${credentialId}`;
    const cached = this.cache.get(key);
    if (!options.forceRefresh && cached && cached.expiresAt - this.clock() > REFRESH_SKEW_MS) return cached.accessToken;
    let shared = this.inflight.get(key);
    if (!shared) {
      shared = this.refresh(userId, credentialId, refreshToken, key);
      this.inflight.set(key, shared);
      const settle = () => { if (this.inflight.get(key) === shared) this.inflight.delete(key); };
      shared.then(settle, settle);
    }
    return (await this.wait(shared, options.signal)).accessToken;
  }

  private async refresh(userId: string, credentialId: string, refreshToken: string, key: string): Promise<Cached> {
    const generation = this.generation.get(userId) ?? 0;
    try {
      const tokens = await this.options.client.refresh(refreshToken, AbortSignal.timeout(this.refreshTimeoutMs));
      const entry = { accessToken: tokens.accessToken, expiresAt: this.clock() + tokens.expiresInSeconds * 1000 };
      // A clear() during the refresh (reconnect or disconnect) wins over this late result.
      if ((this.generation.get(userId) ?? 0) === generation) this.cache.set(key, entry);
      return entry;
    } catch (error) {
      if (error instanceof GmailOAuthError && error.kind === 'invalid_grant') {
        this.cache.delete(key);
        try { await this.options.credentials.markReconnectRequired(this.service, userId, credentialId); } catch { /* still a lost grant */ }
        this.options.onReconnectRequired?.(userId);
        throw this.failure('AUTH_ERROR', 400);
      }
      if (error instanceof GmailOAuthError && error.kind !== 'network') throw this.failure('SERVER_ERROR', error.status);
      throw this.failure('NETWORK');
    }
  }

  private wait<T>(shared: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return shared;
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(this.failure('NETWORK'));
      signal.addEventListener('abort', abort, { once: true });
      shared.then(
        (value) => { signal.removeEventListener('abort', abort); resolve(value); },
        (error) => { signal.removeEventListener('abort', abort); reject(error); },
      );
    });
  }
}
