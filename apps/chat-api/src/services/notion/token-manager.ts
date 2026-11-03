import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import type { NotionConnectionRepo } from '../../db/repositories/notion-connection-repo.js';
import { NotionOAuthClient, NotionOAuthError } from './oauth-client.js';

export class NotionTokenManager {
  constructor(
    private readonly repo: NotionConnectionRepo,
    private readonly oauth: NotionOAuthClient,
    private readonly key: string,
    private readonly onReconnectRequired?: (userId: string) => void,
  ) {}

  async execute<T>(
    userId: string,
    id: string,
    version: number,
    operation: (accessToken: string, botId: string) => Promise<T>,
  ): Promise<T> {
    return this.repo.withOwner(userId, async (c) => {
      const row = await this.repo.get(c, userId, id);
      if (!row || row.status !== 'active' || row.identity_version !== version || !row.config) {
        throw new NotionOAuthError(true);
      }
      if (row.refresh_in_flight) {
        await c.query(
          `UPDATE notion_connections
              SET status = 'reconnect_required', config = NULL, refresh_in_flight = false
            WHERE id = $1 AND user_id = $2`,
          [id, userId],
        );
        this.onReconnectRequired?.(userId);
        throw new NotionOAuthError(true);
      }
      const cfg = decryptCredentials(row.config, this.key);
      try {
        return await operation(cfg.accessToken, row.bot_id);
      } catch (e) {
        if (!(e instanceof NotionOAuthError) || !e.authenticationLost) throw e;
      }

      await c.query(
        'UPDATE notion_connections SET refresh_in_flight = true WHERE id = $1 AND user_id = $2',
        [id, userId],
      );
      let refreshedAccessToken: string;
      try {
        const next = await this.oauth.refresh(cfg.refreshToken, AbortSignal.timeout(10_000));
        if (
          next.workspaceId !== row.workspace_id ||
          next.actorId !== row.actor_id ||
          next.botId !== row.bot_id
        ) {
          throw new NotionOAuthError(true);
        }
        await c.query(
          `UPDATE notion_connections
              SET config = $4, workspace_name = $5, refresh_in_flight = false
            WHERE id = $1 AND user_id = $2 AND identity_version = $3 AND status = 'active'`,
          [
            id,
            userId,
            version,
            encryptCredentials(
              {
                accessToken: next.accessToken,
                refreshToken: next.refreshToken,
                botId: next.botId,
              },
              this.key,
            ),
            next.workspaceName,
          ],
        );
        refreshedAccessToken = next.accessToken;
      } catch {
        await c.query(
          `UPDATE notion_connections
              SET status = 'reconnect_required', config = NULL, refresh_in_flight = false
            WHERE id = $1 AND user_id = $2`,
          [id, userId],
        );
        this.onReconnectRequired?.(userId);
        throw new NotionOAuthError(true);
      }

      try {
        return await operation(refreshedAccessToken, row.bot_id);
      } catch (postRefreshErr) {
        if (postRefreshErr instanceof NotionOAuthError && postRefreshErr.authenticationLost) {
          await c.query(
            `UPDATE notion_connections
                SET status = 'reconnect_required', config = NULL, refresh_in_flight = false
              WHERE id = $1 AND user_id = $2`,
            [id, userId],
          );
          this.onReconnectRequired?.(userId);
          throw new NotionOAuthError(true);
        }
        throw postRefreshErr;
      }
    });
  }
}
