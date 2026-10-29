import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import type { NotionConnectionRepo } from '../../db/repositories/notion-connection-repo.js';
import { NotionOAuthError, type NotionOAuthClient } from './oauth-client.js';
/** Metadata operations only. Rotation and uncertain exchanges are serialized across processes. */
export class NotionTokenManager {
  constructor(private repo: NotionConnectionRepo, private oauth: NotionOAuthClient, private key: string, private timeoutMs = 10000) {}
  async execute<T>(owner: string, id: string, version: number, operation: (accessToken: string, botId: string) => Promise<T>): Promise<T> {
    return this.repo.withOwner(owner, async c => {
      const row = await this.repo.get(c, owner, id);
      const reconnect = async (): Promise<never> => {
        if (row?.status !== 'disconnected') await c.query("UPDATE notion_connections SET status='reconnect_required',config=NULL,refresh_in_flight=false WHERE id=$1 AND user_id=$2", [id, owner]);
        throw new NotionOAuthError(true);
      };
      if (!row || row.status !== 'active' || row.identity_version !== version) throw new NotionOAuthError(true);
      if (!row.config || row.refresh_in_flight) return reconnect();
      let config: any; try { config = decryptCredentials(row.config, this.key); } catch { return reconnect(); }
      if (typeof config.accessToken !== 'string' || typeof config.botId !== 'string') return reconnect();
      try { return await operation(config.accessToken, config.botId); }
      catch (e) { if (!(e instanceof NotionOAuthError && e.authenticationLost)) throw e; }
      if (!config.refreshToken) return reconnect();
      await c.query('UPDATE notion_connections SET refresh_in_flight=true WHERE id=$1', [id]);
      let grant;
      try {
        grant = await this.oauth.refresh(config.refreshToken, AbortSignal.timeout(this.timeoutMs));
        if (!grant.refreshToken || grant.workspaceId !== row.workspace_id || grant.actorId !== row.actor_id || grant.botId !== config.botId) return reconnect();
        const sealed = encryptCredentials({ accessToken: grant.accessToken, refreshToken: grant.refreshToken, botId: grant.botId }, this.key);
        await c.query('UPDATE notion_connections SET config=$2,refresh_in_flight=false WHERE id=$1', [id, sealed]);
      } catch { return reconnect(); }
      try { return await operation(grant.accessToken, grant.botId); }
      catch (e) { if (e instanceof NotionOAuthError && e.authenticationLost) return reconnect(); throw e; }
    });
  }
}
