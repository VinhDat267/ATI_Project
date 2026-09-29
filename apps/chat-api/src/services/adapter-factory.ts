import type { CredentialRepo } from '../db/repositories/credential-repo.js';
import {
  decryptCredentials,
} from '@wap/tool-adapters';
import type { AllowedScope } from '@wap/tool-schemas';
import { getRegisteredService } from './registered-services.js';

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
}
