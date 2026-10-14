import { decryptCredentials } from '@wap/tool-adapters';
import type { PlanConnections } from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';

export type GmailConnectionReference = NonNullable<PlanConnections['gmail']>;

/** The caller's active Gmail connection as a plan stores it, or null when none is usable. */
export function createGmailConnectionLookup(credentials: Pick<CredentialRepo, 'getPersonalCredentials'>, encryptionKey: string) {
  return async (userId: string): Promise<GmailConnectionReference | null> => {
    const record = await credentials.getPersonalCredentials('gmail', userId);
    if (!record) return null;
    try {
      const email = decryptCredentials(record.config, encryptionKey).email;
      return typeof email === 'string' && email ? { credentialId: record.id, email } : null;
    } catch {
      return null;
    }
  };
}
