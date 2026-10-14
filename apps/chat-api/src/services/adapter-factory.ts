import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import {
  decryptCredentials,
  StepError,
  type GmailAccessTokenProvider,
} from '@wap/tool-adapters';
import type { AllowedScope, PlanConnections } from '@wap/tool-schemas';
import type { AdapterExecutor } from '@wap/executor';
import { getRegisteredService } from './registered-services.js';
import type { GmailTokenManager } from './gmail/token-manager.js';

/** Who an adapter is for. Shared services ignore it; Gmail requires it (GMAIL-common 4.4). */
export interface AdapterContext {
  userId?: string;
  phase: 'planning' | 'execution';
  /** Required when phase is 'execution' and the service is Gmail: the connection the plan was previewed with. */
  connections?: PlanConnections;
}

export interface AdapterFactoryOptions {
  credentialRepo: CredentialRepo;
  encryptionKey: string;
  /** Builds the Gmail adapter of one member; absent until GMAIL-02 wires the real and sandbox adapters. */
  createGmailAdapter?: (input: { userId: string; tokens: GmailAccessTokenProvider }) => AdapterExecutor;
  gmailTokens?: GmailTokenManager;
}

const gmailError = (category: 'AUTH_ERROR' | 'VALIDATION', message: string) => new StepError({ category, message, retryable: false });

export class AdapterFactory {
  private credentialRepo: CredentialRepo;
  private encryptionKey: string;
  private adapterCache = new Map<string, any>();
  private personalCache = new Map<string, { credentialId: string; adapter: AdapterExecutor }>();

  constructor(private options: AdapterFactoryOptions) {
    this.credentialRepo = options.credentialRepo;
    this.encryptionKey = options.encryptionKey;
  }

  clearCache(serviceName: string): void {
    this.adapterCache.delete(serviceName);
  }

  /** Forget the Gmail adapter and access tokens of one member (connect, disconnect, reconnect_required). */
  clearPersonal(userId: string): void {
    this.personalCache.delete(`gmail:${userId}`);
    this.options.gmailTokens?.clear(userId);
  }

  async getAdapterForService(serviceName: string, context?: AdapterContext): Promise<any> {
    if (serviceName === 'gmail') return this.gmailAdapter(context);
    const cached = this.adapterCache.get(serviceName);
    if (cached) return cached;

    const registration = getRegisteredService(serviceName);
    if (!registration) throw new Error(`Unsupported service '${serviceName}'`);

    const record = await this.credentialRepo.getCredentials(serviceName);
    if (!record) {
      throw new Error(`No credentials configured for service '${serviceName}'`);
    }

    const decrypted = decryptCredentials(record.config, this.encryptionKey);
    const allowedScope: AllowedScope = (decrypted.allowedScope || {}) as AllowedScope;
    const entries = allowedScope[registration.definition.scopeKey];
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(`Allowed scope is required for service '${serviceName}'`);
    }

    if (!registration.definition.credentialFields.every(({ key }) => typeof decrypted[key] === 'string' && String(decrypted[key]).trim())) {
      throw new Error(`Credentials are incomplete for service '${serviceName}'`);
    }
    const adapter = registration.transport.createAdapter(decrypted, allowedScope);

    this.adapterCache.set(serviceName, adapter);
    return adapter;
  }

  /** Only the member's own active connection; at execution, only the exact credential the plan was previewed with. */
  private async gmailAdapter(context?: AdapterContext): Promise<AdapterExecutor> {
    const userId = context?.userId;
    if (!userId) throw gmailError('AUTH_ERROR', 'Gmail chỉ dùng được với kết nối của chính người dùng.');
    const record = await this.credentialRepo.getPersonalCredentials('gmail', userId);
    if (context.phase === 'execution') {
      const previewed = context.connections?.gmail?.credentialId;
      if (!record || !previewed || record.id !== previewed) {
        throw gmailError('AUTH_ERROR', 'Kết nối Gmail đã thay đổi, hãy lập lại kế hoạch.');
      }
    }
    if (!record) throw gmailError('AUTH_ERROR', 'Gmail chưa được kết nối hoặc cần kết nối lại.');
    const key = `gmail:${userId}`;
    const cached = this.personalCache.get(key);
    if (cached?.credentialId === record.id) return cached.adapter;
    if (!this.options.createGmailAdapter || !this.options.gmailTokens) throw gmailError('VALIDATION', 'Gmail chưa sẵn sàng trên máy chủ này.');
    let refreshToken: unknown;
    try {
      refreshToken = decryptCredentials(record.config, this.encryptionKey).refreshToken;
    } catch { /* An unreadable connection is a lost connection, not a network failure. */ }
    if (typeof refreshToken !== 'string' || !refreshToken) throw gmailError('AUTH_ERROR', 'Gmail cần được kết nối lại.');
    const adapter = this.options.createGmailAdapter({ userId, tokens: this.options.gmailTokens.forConnection(userId, record.id, refreshToken) });
    this.personalCache.set(key, { credentialId: record.id, adapter });
    return adapter;
  }
}
