import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import {
  decryptCredentials,
  TrelloAdapter,
  SlackAdapter,
  type TrelloCredentials,
  type SlackCredentials,
} from '@wap/tool-adapters';
import type { AllowedScope } from '@wap/tool-schemas';

export interface AdapterFactoryOptions {
  credentialRepo: CredentialRepo;
  encryptionKey: string;
}

export class AdapterFactory {
  private credentialRepo: CredentialRepo;
  private encryptionKey: string;
  private adapterCache = new Map<string, any>();

  constructor(options: AdapterFactoryOptions) {
    this.credentialRepo = options.credentialRepo;
    this.encryptionKey = options.encryptionKey;
  }

  clearCache(serviceName: string): void {
    this.adapterCache.delete(serviceName);
  }

  async getAdapterForService(serviceName: string): Promise<any> {
    const cached = this.adapterCache.get(serviceName);
    if (cached) return cached;

    const record = await this.credentialRepo.getCredentials(serviceName);
    if (!record) {
      throw new Error(`No credentials configured for service '${serviceName}'`);
    }

    const decrypted = decryptCredentials(record.config, this.encryptionKey);
    const allowedScope: AllowedScope = (decrypted.allowedScope || {}) as AllowedScope;
    const entries = serviceName === 'trello' ? allowedScope.boards : allowedScope.channels;
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(`Allowed scope is required for service '${serviceName}'`);
    }

    let adapter: any;
    if (serviceName === 'trello') {
      adapter = new TrelloAdapter({
        credentials: decrypted as unknown as TrelloCredentials,
        allowedScope,
      });
    } else if (serviceName === 'slack') {
      adapter = new SlackAdapter({
        credentials: decrypted as unknown as SlackCredentials,
        allowedScope,
      });
    } else {
      throw new Error(`Unsupported service '${serviceName}'`);
    }

    this.adapterCache.set(serviceName, adapter);
    return adapter;
  }
}
