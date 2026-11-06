import { StepError, decryptCredentials, type GmailAccessTokenProvider } from '@wap/tool-adapters';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import { GmailOAuthError, type GmailOAuthClient } from './oauth-client.js';

const REFRESH_SKEW_MS = 60_000;

export function isGoogleConnectionChanged(error: unknown): boolean {
  return error instanceof StepError && error.details?.code === 'GOOGLE_CONNECTION_CHANGED';
}

export interface GmailTokenManagerOptions {
  client: Pick<GmailOAuthClient, 'refresh'>;
  credentials: Pick<CredentialRepo, 'markReconnectRequired'> & Partial<Pick<CredentialRepo, 'getPersonalConnectionStatus'>>;
  /** Required together in live composition. Origin is read from the active encrypted DB row. */
  clientId?: string;
  encryptionKey?: string;
  service?: 'gmail' | 'mycalendar' | 'mysheets';
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
  readonly service: 'gmail' | 'mycalendar' | 'mysheets';
  readonly serviceLabel: string;
  private cache = new Map<string, Cached>();
  private inflight = new Map<string, Promise<Cached>>();
  private generation = new Map<string, number>();
  private clock: () => number;
  private refreshTimeoutMs: number;

  constructor(private options: GmailTokenManagerOptions) {
    if (options.clientId && (!options.encryptionKey || !options.credentials.getPersonalConnectionStatus)) {
      throw new Error('Google token origin checks require an encryption key and credential repository');
    }
    this.service = options.service ?? 'gmail';
    this.serviceLabel = options.serviceLabel ?? (
      this.service === 'mysheets'
        ? 'Google Sheets'
        : this.service === 'mycalendar'
        ? 'Google Calendar'
        : 'Gmail'
    );
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
    const generation = this.generation.get(userId) ?? 0;
    return { getAccessToken: (options) => this.getAccessToken(userId, credentialId, refreshToken, generation, options) };
  }

  /** Forget every token of this person (reconnect, disconnect, reconnect_required). */
  clear(userId: string): void {
    this.generation.set(userId, (this.generation.get(userId) ?? 0) + 1);
    for (const key of [...this.cache.keys()]) if (key.startsWith(`${userId}:`)) this.cache.delete(key);
    for (const key of [...this.inflight.keys()]) if (key.startsWith(`${userId}:`)) this.inflight.delete(key);
  }

  private async assertActive(userId: string, credentialId: string, refreshToken: string, generation: number): Promise<void> {
    if ((this.generation.get(userId) ?? 0) !== generation) throw this.connectionChanged();
    if (this.options.clientId) {
      const row = await this.options.credentials.getPersonalConnectionStatus!(this.service, userId);
      if (!row || row.id !== credentialId) throw this.connectionChanged();
      if (row.status !== 'active') throw this.failure('AUTH_ERROR');
      let valid = false;
      try {
        const config = decryptCredentials(row.config, this.options.encryptionKey!);
        valid = config.oauthClientId === this.options.clientId && config.refreshToken === refreshToken;
      } catch { /* An unreadable origin also requires fresh consent. */ }
      if (!valid) {
        await this.markReconnectRequired(userId, credentialId);
        throw this.failure('AUTH_ERROR');
      }
    }
    if ((this.generation.get(userId) ?? 0) !== generation) throw this.connectionChanged();
  }

  private connectionChanged(): StepError {
    return new StepError({ category: 'AUTH_ERROR', retryable: false,
      message: `Kết nối ${this.serviceLabel} đã thay đổi. Hãy thử lại với kết nối hiện tại.`, details: { code: 'GOOGLE_CONNECTION_CHANGED' } });
  }

  private async markReconnectRequired(userId: string, credentialId: string): Promise<void> {
    try {
      if (await this.options.credentials.markReconnectRequired(this.service, userId, credentialId)) this.options.onReconnectRequired?.(userId);
    } catch { /* Still refuse this token; a failed status update cannot authorize use. */ }
  }

  private async getAccessToken(userId: string, credentialId: string, refreshToken: string, generation: number,
    options: { signal?: AbortSignal; forceRefresh?: boolean } = {}): Promise<string> {
    if (options.signal?.aborted) throw this.failure('NETWORK');
    await this.wait(this.assertActive(userId, credentialId, refreshToken, generation), options.signal);
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
    const entry = await this.wait(shared, options.signal);
    await this.wait(this.assertActive(userId, credentialId, refreshToken, generation), options.signal);
    if (options.signal?.aborted) throw this.failure('NETWORK');
    return entry.accessToken;
  }

  private async refresh(userId: string, credentialId: string, refreshToken: string, key: string): Promise<Cached> {
    const generation = this.generation.get(userId) ?? 0;
    try {
      const tokens = await this.options.client.refresh(refreshToken, AbortSignal.timeout(this.refreshTimeoutMs));
      const entry = { accessToken: tokens.accessToken, expiresAt: this.clock() + tokens.expiresInSeconds * 1000 };
      // A clear() during the refresh (reconnect or disconnect) wins over this late result.
      await this.assertActive(userId, credentialId, refreshToken, generation);
      this.cache.set(key, entry);
      return entry;
    } catch (error) {
      if (error instanceof StepError) throw error;
      if (error instanceof GmailOAuthError && error.kind === 'invalid_grant') {
        this.cache.delete(key);
        await this.markReconnectRequired(userId, credentialId);
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
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      shared.then(
        (value) => { signal.removeEventListener('abort', abort); resolve(value); },
        (error) => { signal.removeEventListener('abort', abort); reject(error); },
      );
    });
  }
}
