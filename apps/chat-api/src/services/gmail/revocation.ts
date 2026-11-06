import { decryptCredentials } from '@wap/tool-adapters';
import { googleOAuthNamespace } from '../../config/google-oauth-projects.js';
import type { ServiceCredentialRow } from '../../db/repositories/credential-repo.js';

/** A missing origin may belong to any old project. Prefer retaining a grant to breaking a peer. */
export function canRevokeGoogleGrant(clientId: string, peers: ServiceCredentialRow[], encryptionKey: string): boolean {
  return peers.every(peer => {
    try {
      const config = decryptCredentials(peer.config, encryptionKey);
      // Email is mutable metadata, so differing snapshots cannot prove separate accounts.
      const namespace = googleOAuthNamespace(clientId);
      const peerNamespace = googleOAuthNamespace(config.oauthClientId);
      return Boolean(namespace && peerNamespace && namespace !== peerNamespace);
    } catch { return false; }
  });
}
