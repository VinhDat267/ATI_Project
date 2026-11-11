import type pg from 'pg';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import type {
  NotionAuthFailureCode,
  NotionConnectionRepo,
} from '../../db/repositories/notion-connection-repo.js';
import { NotionOAuthClient, NotionOAuthError } from './oauth-client.js';

export interface NotionTokenManagerOptions {
  expectedAppId?: string;
  refreshTimeoutMs?: number;
}

export class NotionTokenManager {
  constructor(
    private readonly repo: NotionConnectionRepo,
    private readonly oauth: NotionOAuthClient,
    private readonly key: string,
    private readonly onReconnectRequired?: (userId: string) => void,
    private readonly options?: NotionTokenManagerOptions,
  ) {}

  private expectedAppId(): string {
    return (this.options?.expectedAppId ?? this.oauth.appId ?? '').trim();
  }

  private isAccess401Rejection(err: unknown): err is NotionOAuthError {
    return (
      err instanceof NotionOAuthError &&
      err.authenticationLost === true &&
      err.reason === 'access_rejected' &&
      err.statusCode === 401 &&
      (err.endpointKind === 'resource' || err.endpointKind === 'identity')
    );
  }

  private classifyRefreshFailure(err: unknown): {
    code: NotionAuthFailureCode;
    clearConfig: boolean;
  } {
    if (err instanceof NotionOAuthError) {
      if (
        err.requestState === 'not_sent' &&
        err.reason !== 'grant_rejected' &&
        err.reason !== 'client_misconfigured' &&
        err.reason !== 'identity_mismatch'
      ) {
        return { code: 'refresh_retryable', clearConfig: false };
      }
      if (
        err.endpointKind === 'token' &&
        err.reason === 'grant_rejected' &&
        (err.requestState === 'not_sent' ||
          (err.requestState === 'response_received' &&
            err.statusCode === 400 &&
            err.providerCode === 'invalid_grant'))
      ) {
        return { code: 'grant_rejected', clearConfig: true };
      }
      if (err.reason === 'client_misconfigured') {
        return { code: 'client_misconfigured', clearConfig: false };
      }
      if (err.reason === 'identity_mismatch') {
        return { code: 'identity_mismatch', clearConfig: false };
      }
    }
    return { code: 'rotation_unknown', clearConfig: false };
  }

  private async quarantineInterruptedCheckpoint(
    c: pg.PoolClient,
    userId: string,
    id: string,
    version: number,
  ): Promise<void> {
    try {
      const res = await c.query(
        `UPDATE notion_connections
            SET status = 'reconnect_required',
                refresh_in_flight = false,
                auth_failure_code = 'rotation_unknown'
          WHERE id = $1
            AND user_id = $2
            AND identity_version = $3
            AND status IN ('active', 'reconnect_required')
            AND refresh_in_flight = true`,
        [id, userId, version],
      );
      if (res.rowCount === 1) {
        this.onReconnectRequired?.(userId);
      }
    } catch {
      this.onReconnectRequired?.(userId);
    }
  }

  private async quarantineActiveRow(
    c: pg.PoolClient,
    userId: string,
    id: string,
    version: number,
    code: NotionAuthFailureCode,
    clearConfig = false,
  ): Promise<void> {
    try {
      const res = clearConfig
        ? await c.query(
            `UPDATE notion_connections
                SET status = 'reconnect_required',
                    config = NULL,
                    refresh_in_flight = false,
                    auth_failure_code = $4
              WHERE id = $1 AND user_id = $2 AND identity_version = $3 AND status = 'active'`,
            [id, userId, version, code],
          )
        : await c.query(
            `UPDATE notion_connections
                SET status = 'reconnect_required',
                    refresh_in_flight = false,
                    auth_failure_code = $4
              WHERE id = $1 AND user_id = $2 AND identity_version = $3 AND status = 'active'`,
            [id, userId, version, code],
          );
      if (res.rowCount === 1) {
        this.onReconnectRequired?.(userId);
      }
    } catch {
      this.onReconnectRequired?.(userId);
    }
  }

  private async updateQuarantinedRow(
    c: pg.PoolClient,
    userId: string,
    id: string,
    version: number,
    code: NotionAuthFailureCode,
    clearConfig = false,
  ): Promise<void> {
    try {
      const res = clearConfig
        ? await c.query(
            `UPDATE notion_connections
                SET config = NULL,
                    refresh_in_flight = false,
                    auth_failure_code = $4
              WHERE id = $1 AND user_id = $2 AND identity_version = $3 AND status = 'reconnect_required'`,
            [id, userId, version, code],
          )
        : await c.query(
            `UPDATE notion_connections
                SET refresh_in_flight = false,
                    auth_failure_code = $4
              WHERE id = $1 AND user_id = $2 AND identity_version = $3 AND status = 'reconnect_required'`,
            [id, userId, version, code],
          );
      if (res.rowCount === 1) {
        this.onReconnectRequired?.(userId);
      }
    } catch {
      this.onReconnectRequired?.(userId);
    }
  }

  async execute<T>(
    userId: string,
    id: string,
    version: number,
    operation: (accessToken: string, botId: string, client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.repo.withOwner(userId, async (c) => {
      const row = await this.repo.get(c, userId, id);
      if (!row || row.identity_version !== version || !row.config || row.status === 'disconnected') {
        throw new NotionOAuthError(true);
      }

      if (row.refresh_in_flight) {
        await this.quarantineInterruptedCheckpoint(c, userId, id, version);
        throw new NotionOAuthError(
          'Phiên làm mới Notion trước đó bị gián đoạn. Vui lòng kết nối lại.',
          true,
          {
            endpointKind: 'token',
            reason: 'rotation_unknown',
            requestState: 'possibly_sent',
          },
        );
      }

      if (row.status !== 'active') {
        throw new NotionOAuthError(true);
      }

      const expectedApp = this.expectedAppId();
      if (!expectedApp || row.app_id !== expectedApp) {
        await this.quarantineActiveRow(c, userId, id, version, 'client_misconfigured', false);
        throw new NotionOAuthError(
          'Cấu hình ứng dụng OAuth Notion trên máy chủ không khớp với kết nối đã lưu.',
          true,
          {
            endpointKind: 'token',
            reason: 'client_misconfigured',
            requestState: 'not_sent',
          },
        );
      }

      const cfg = decryptCredentials(row.config, this.key);
      try {
        return await operation(cfg.accessToken, row.bot_id, c);
      } catch (e) {
        if (e instanceof NotionOAuthError && e.reason === 'identity_mismatch') {
          await this.quarantineActiveRow(c, userId, id, version, 'identity_mismatch', false);
          throw e;
        }
        if (!this.isAccess401Rejection(e)) {
          throw e;
        }
      }

      const refreshToken = typeof cfg.refreshToken === 'string' ? cfg.refreshToken.trim() : '';
      if (!refreshToken) {
        await this.quarantineActiveRow(c, userId, id, version, 'grant_rejected', true);
        throw new NotionOAuthError(
          'Phiên truy cập Notion đã hết hạn và không có refresh token. Vui lòng kết nối lại.',
          true,
          {
            endpointKind: 'token',
            reason: 'grant_rejected',
            requestState: 'not_sent',
          },
        );
      }

      const checkpointRes = await c.query(
        `UPDATE notion_connections
            SET refresh_in_flight = true,
                auth_failure_code = 'access_rejected'
          WHERE id = $1 AND user_id = $2 AND identity_version = $3 AND status = 'active'`,
        [id, userId, version],
      );
      if (checkpointRes.rowCount !== 1) {
        throw new NotionOAuthError(true);
      }

      let next: Awaited<ReturnType<NotionOAuthClient['refresh']>>;
      try {
        next = await this.oauth.refresh(
          refreshToken,
          AbortSignal.timeout(this.options?.refreshTimeoutMs ?? 10_000),
        );
      } catch (refreshErr) {
        const { code, clearConfig } = this.classifyRefreshFailure(refreshErr);
        await this.quarantineActiveRow(c, userId, id, version, code, clearConfig);
        throw new NotionOAuthError(
          refreshErr instanceof NotionOAuthError
            ? refreshErr.message
            : 'Không thể làm mới phiên xác thực Notion.',
          true,
          {
            endpointKind: 'token',
            statusCode: refreshErr instanceof NotionOAuthError ? refreshErr.statusCode : undefined,
            providerCode:
              refreshErr instanceof NotionOAuthError ? refreshErr.providerCode : undefined,
            reason: code === 'refresh_retryable' ? 'transient' : code,
            requestState:
              refreshErr instanceof NotionOAuthError ? refreshErr.requestState : 'possibly_sent',
          },
        );
      }

      if (next.appId && next.appId !== expectedApp) {
        await this.quarantineActiveRow(c, userId, id, version, 'client_misconfigured', false);
        throw new NotionOAuthError(
          'Ứng dụng OAuth trả về khi làm mới không khớp với cấu hình máy chủ.',
          true,
          {
            endpointKind: 'token',
            reason: 'client_misconfigured',
            requestState: 'response_received',
          },
        );
      }

      if (
        next.workspaceId !== row.workspace_id ||
        next.actorId !== row.actor_id ||
        next.botId !== row.bot_id
      ) {
        await this.quarantineActiveRow(c, userId, id, version, 'identity_mismatch', false);
        throw new NotionOAuthError(
          'Danh tính workspace hoặc người ủy quyền Notion sau khi làm mới không khớp.',
          true,
          {
            endpointKind: 'token',
            reason: 'identity_mismatch',
            requestState: 'response_received',
          },
        );
      }

      const encryptedNext = encryptCredentials(
        {
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
          botId: next.botId,
        },
        this.key,
      );

      let saveRowCount = 0;
      try {
        const saveRes = await c.query(
          `UPDATE notion_connections
              SET config = $4,
                  workspace_name = $5,
                  refresh_in_flight = false,
                  auth_failure_code = NULL
            WHERE id = $1 AND user_id = $2 AND identity_version = $3 AND status = 'active'`,
          [id, userId, version, encryptedNext, next.workspaceName],
        );
        saveRowCount = saveRes.rowCount ?? 0;
      } catch {
        this.onReconnectRequired?.(userId);
        throw new NotionOAuthError(
          'Không xác nhận được lưu trữ token Notion mới. Vui lòng kết nối lại.',
          true,
          {
            endpointKind: 'token',
            reason: 'rotation_unknown',
            requestState: 'possibly_sent',
          },
        );
      }

      if (saveRowCount !== 1) {
        await this.quarantineActiveRow(c, userId, id, version, 'rotation_unknown', false);
        throw new NotionOAuthError(
          'Phiên kết nối Notion đã thay đổi trong lúc lưu token mới.',
          true,
          {
            endpointKind: 'token',
            reason: 'rotation_unknown',
            requestState: 'possibly_sent',
          },
        );
      }

      try {
        return await operation(next.accessToken, row.bot_id, c);
      } catch (postRefreshErr) {
        if (
          postRefreshErr instanceof NotionOAuthError &&
          postRefreshErr.authenticationLost &&
          (postRefreshErr.reason === 'identity_mismatch' || this.isAccess401Rejection(postRefreshErr))
        ) {
          const postCode =
            postRefreshErr.reason === 'identity_mismatch' ? 'identity_mismatch' : 'access_rejected';
          await this.quarantineActiveRow(c, userId, id, version, postCode, false);
          throw new NotionOAuthError(postRefreshErr.message, true, {
            endpointKind: postRefreshErr.endpointKind,
            statusCode: postRefreshErr.statusCode,
            providerCode: postRefreshErr.providerCode,
            reason: postRefreshErr.reason,
            requestState: postRefreshErr.requestState,
          });
        }
        throw postRefreshErr;
      }
    });
  }

  async checkConnection(
    userId: string,
    id: string,
    version: number,
    verifyFn: (accessToken: string, botId: string) => Promise<void>,
  ): Promise<{ recovered: boolean }> {
    let shouldDelegateActive = false;

    const recoveredResult = await this.repo.withOwner(userId, async (c) => {
      const row = await this.repo.get(c, userId, id);
      if (!row || row.identity_version !== version || !row.config || row.status === 'disconnected') {
        throw new NotionOAuthError(true);
      }

      if (row.refresh_in_flight) {
        await this.quarantineInterruptedCheckpoint(c, userId, id, version);
        throw new NotionOAuthError(
          'Phiên làm mới Notion trước đó bị gián đoạn. Vui lòng kết nối lại.',
          true,
          {
            endpointKind: 'token',
            reason: 'rotation_unknown',
            requestState: 'possibly_sent',
          },
        );
      }

      if (row.status === 'active') {
        shouldDelegateActive = true;
        return false;
      }

      if (row.status !== 'reconnect_required' || row.auth_failure_code !== 'refresh_retryable') {
        throw new NotionOAuthError(true);
      }

      const expectedApp = this.expectedAppId();
      if (!expectedApp || row.app_id !== expectedApp) {
        await this.updateQuarantinedRow(c, userId, id, version, 'client_misconfigured', false);
        throw new NotionOAuthError(
          'Cấu hình ứng dụng OAuth Notion trên máy chủ không khớp với kết nối đã lưu.',
          true,
          {
            endpointKind: 'token',
            reason: 'client_misconfigured',
            requestState: 'not_sent',
          },
        );
      }

      const cfg = decryptCredentials(row.config, this.key);
      const refreshToken = typeof cfg.refreshToken === 'string' ? cfg.refreshToken.trim() : '';
      if (!refreshToken) {
        await this.updateQuarantinedRow(c, userId, id, version, 'grant_rejected', true);
        throw new NotionOAuthError(true);
      }

      const cpRes = await c.query(
        `UPDATE notion_connections
            SET refresh_in_flight = true
          WHERE id = $1 AND user_id = $2 AND identity_version = $3
            AND status = 'reconnect_required'
            AND auth_failure_code = 'refresh_retryable'
            AND refresh_in_flight = false`,
        [id, userId, version],
      );
      if (cpRes.rowCount !== 1) {
        throw new NotionOAuthError(true);
      }

      let next: Awaited<ReturnType<NotionOAuthClient['refresh']>>;
      try {
        next = await this.oauth.refresh(
          refreshToken,
          AbortSignal.timeout(this.options?.refreshTimeoutMs ?? 10_000),
        );
      } catch (refreshErr) {
        const { code, clearConfig } = this.classifyRefreshFailure(refreshErr);
        await this.updateQuarantinedRow(c, userId, id, version, code, clearConfig);
        throw new NotionOAuthError(true);
      }

      if (next.appId && next.appId !== expectedApp) {
        await this.updateQuarantinedRow(c, userId, id, version, 'client_misconfigured', false);
        throw new NotionOAuthError(true);
      }

      if (
        next.workspaceId !== row.workspace_id ||
        next.actorId !== row.actor_id ||
        next.botId !== row.bot_id
      ) {
        await this.updateQuarantinedRow(c, userId, id, version, 'identity_mismatch', false);
        throw new NotionOAuthError(true);
      }

      const encryptedNext = encryptCredentials(
        {
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
          botId: next.botId,
        },
        this.key,
      );

      let saveRowCount = 0;
      try {
        const saveRes = await c.query(
          `UPDATE notion_connections
              SET status = 'active',
                  config = $4,
                  workspace_name = $5,
                  refresh_in_flight = false,
                  auth_failure_code = NULL
            WHERE id = $1 AND user_id = $2 AND identity_version = $3
              AND status = 'reconnect_required'`,
          [id, userId, version, encryptedNext, next.workspaceName],
        );
        saveRowCount = saveRes.rowCount ?? 0;
      } catch {
        this.onReconnectRequired?.(userId);
        throw new NotionOAuthError(
          'Không xác nhận được lưu trữ token Notion mới. Vui lòng kết nối lại.',
          true,
          {
            endpointKind: 'token',
            reason: 'rotation_unknown',
            requestState: 'possibly_sent',
          },
        );
      }

      if (saveRowCount !== 1) {
        await this.updateQuarantinedRow(c, userId, id, version, 'rotation_unknown', false);
        throw new NotionOAuthError(
          'Phiên kết nối Notion đã thay đổi trong lúc lưu token mới.',
          true,
          {
            endpointKind: 'token',
            reason: 'rotation_unknown',
            requestState: 'possibly_sent',
          },
        );
      }

      try {
        await verifyFn(next.accessToken, row.bot_id);
      } catch (verifyErr) {
        if (
          verifyErr instanceof NotionOAuthError &&
          verifyErr.authenticationLost &&
          (verifyErr.reason === 'identity_mismatch' || this.isAccess401Rejection(verifyErr))
        ) {
          await this.quarantineActiveRow(
            c,
            userId,
            id,
            version,
            verifyErr.reason === 'identity_mismatch' ? 'identity_mismatch' : 'access_rejected',
            false,
          );
          throw verifyErr;
        }
        throw verifyErr;
      }

      this.onReconnectRequired?.(userId);
      return true;
    });

    if (shouldDelegateActive) {
      await this.execute(userId, id, version, verifyFn);
      return { recovered: false };
    }

    return { recovered: recoveredResult };
  }
}
