import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import type { SlackConnectionRepo } from '../../db/repositories/slack-connection-repo.js';
import type { SlackOAuthClient } from './oauth-client.js';
/** No in-memory cache can outlive disconnect/reconnect. PostgreSQL serializes every credential access. */
export class SlackTokenManager {
  constructor(private repo: SlackConnectionRepo, private oauth: Pick<SlackOAuthClient, 'refresh'>, private encryptionKey: string,
    private clock = Date.now, private timeoutMs = 10000) {}
  async getAccessToken(userId: string, id: string, identityVersion: number): Promise<string> {
    return this.repo.withOwner(userId, async c => {
      const row = await this.repo.get(c, userId, id);
      const reconnect = async (): Promise<never> => {
        if (row && row.status !== 'disconnected') await c.query("UPDATE slack_connections SET status='reconnect_required',config=NULL,refresh_in_flight=false WHERE id=$1 AND user_id=$2", [id, userId]);
        throw new Error('SLACK_RECONNECT_REQUIRED');
      };
      if (!row || row.status !== 'active' || row.identity_version !== identityVersion) throw new Error('SLACK_RECONNECT_REQUIRED');
      if (row.refresh_in_flight || !row.config) return reconnect();
      let config: any;
      try { config = decryptCredentials(row.config, this.encryptionKey); } catch { return reconnect(); }
      if (typeof config.accessToken !== 'string' || !config.accessToken) return reconnect();
      if (config.expiresAt === undefined) return config.accessToken;
      if (typeof config.expiresAt !== 'number' || !Number.isFinite(config.expiresAt)) return reconnect();
      if (config.expiresAt > this.clock() + 60000) return config.accessToken;
      if (typeof config.refreshToken !== 'string' || !config.refreshToken) return reconnect();
      // Autocommitted BEFORE the single-use exchange. A crash is detected by the next process.
      await c.query('UPDATE slack_connections SET refresh_in_flight=true WHERE id=$1 AND user_id=$2', [id, userId]);
      try {
        const tokens = await this.oauth.refresh(config.refreshToken, AbortSignal.timeout(this.timeoutMs));
        const sealed = encryptCredentials({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: this.clock() + tokens.expiresIn * 1000 }, this.encryptionKey);
        await c.query('UPDATE slack_connections SET config=$2,refresh_in_flight=false WHERE id=$1', [id, sealed]);
        return tokens.accessToken;
      } catch { return reconnect(); }
    });
  }
}
