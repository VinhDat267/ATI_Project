import { decryptCredentials } from '@wap/tool-adapters';

export function hasGoogleCredentialOrigin(config: string, encryptionKey: string, clientId: string): boolean {
  try { return decryptCredentials(config, encryptionKey).oauthClientId === clientId; }
  catch { return false; }
}
