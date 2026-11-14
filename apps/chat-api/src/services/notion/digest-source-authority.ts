import type pg from 'pg';
import { decryptCredentials, NotionAdapter, StepError } from '@wap/tool-adapters';
import { NOTION_ID_PATTERN, normalizeNotionId, type NotionDigestSourceBinding } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';
import type { NotionConnectionRepo, NotionConnectionRow } from '../../db/repositories/notion-connection-repo.js';
import { NotionOAuthError, type NotionOAuthClient } from './oauth-client.js';
import type { NotionTokenManager } from './token-manager.js';

export const NOTION_DIGEST_REAPPROVAL =
  'Nguồn Notion của lịch chưa được duyệt hoặc đã thay đổi. Hãy xem trước và xác nhận lại lịch.';

export class NotionDigestSourceDenied extends Error {
  constructor() { super(NOTION_DIGEST_REAPPROVAL); }
}

export function isNotionSourceDenied(error: unknown): boolean {
  return error instanceof NotionDigestSourceDenied || (error instanceof NotionOAuthError &&
    (error.authenticationLost || error.reason === 'resource_denied' || error.reason === 'resource_unavailable'));
}

export function isNotionDigestSourceBinding(value: unknown): value is NotionDigestSourceBinding {
  if (!value || typeof value !== 'object') return false;
  const b = value as Partial<NotionDigestSourceBinding>;
  return b.version === 1 &&
    [b.ownerId, b.credentialId].every((id) => typeof id === 'string' && isUuid(id)) &&
    [b.appId, b.workspaceId, b.actorId, b.botId].every((id) => typeof id === 'string' && id.length > 0) &&
    typeof b.workspaceName === 'string' &&
    typeof b.identityVersion === 'number' && Number.isSafeInteger(b.identityVersion) && b.identityVersion > 0 &&
    Array.isArray(b.databases) && b.databases.length >= 1 && b.databases.length <= 5 &&
    b.databases.every((d) => d && typeof d.title === 'string' &&
      [d.databaseId, d.dataSourceId].every((id) => typeof id === 'string' && NOTION_ID_PATTERN.test(id) && normalizeNotionId(id) === id)) &&
    new Set(b.databases.map((d) => d.databaseId)).size === b.databases.length;
}

export function canonicalNotionDigestBinding(binding: NotionDigestSourceBinding): NotionDigestSourceBinding {
  return {
    version: binding.version, ownerId: binding.ownerId, credentialId: binding.credentialId,
    appId: binding.appId, workspaceId: binding.workspaceId, workspaceName: binding.workspaceName,
    actorId: binding.actorId, botId: binding.botId, identityVersion: binding.identityVersion,
    databases: binding.databases.map(({ databaseId, dataSourceId, title }) => ({ databaseId, dataSourceId, title }))
      .sort((a, b) => a.databaseId.localeCompare(b.databaseId)),
  };
}

function matchesSource(row: NotionConnectionRow | null, ownerId: string, binding: NotionDigestSourceBinding): row is NotionConnectionRow {
  return Boolean(row && row.status === 'active' && row.config && !row.refresh_in_flight &&
    row.user_id === ownerId && binding.ownerId === ownerId &&
    row.id === binding.credentialId && row.app_id === binding.appId &&
    row.workspace_id === binding.workspaceId && row.actor_id === binding.actorId &&
    row.bot_id === binding.botId && row.identity_version === binding.identityVersion &&
    binding.databases.every(({ databaseId }) => row.allowed_databases.includes(databaseId)));
}

export async function lockApprovedNotionSource(client: pg.PoolClient, ownerId: string, binding: unknown): Promise<boolean> {
  if (!isNotionDigestSourceBinding(binding) || binding.ownerId !== ownerId) return false;
  try {
    const result = await client.query<NotionConnectionRow>(
      'SELECT * FROM notion_connections WHERE user_id=$1 AND id=$2 FOR SHARE NOWAIT',
      [ownerId, binding.credentialId],
    );
    return matchesSource(result.rows[0] ?? null, ownerId, binding);
  } catch (error) {
    if ((error as { code?: string }).code === '55P03') return false;
    throw error;
  }
}

export class NotionDigestSourceAuthority {
  constructor(
    private readonly repo: NotionConnectionRepo,
    private readonly tokens: NotionTokenManager,
    private readonly oauth: NotionOAuthClient,
    private readonly encryptionKey: string,
  ) {}

  async prepare(ownerId: string, request: string, signal: AbortSignal): Promise<NotionDigestSourceBinding> {
    const preview = await this.repo.getActive(ownerId);
    if (!preview) throw new NotionDigestSourceDenied();
    return this.tokens.execute(ownerId, preview.id, preview.identity_version, async (token, _botId, client) => {
      const row = await this.repo.get(client, ownerId, preview.id);
      if (!row || !row.allowed_databases.length) throw new NotionDigestSourceDenied();
      const names = new Map(row.selected_databases.map(({ id, title }) => [id, title]));
      const folded = request.normalize('NFC').toLowerCase();
      let selected = row.allowed_databases.filter((id) => folded.includes(id) || folded.includes(id.replaceAll('-', '')));
      if (selected.length === 0) {
        const byTitle = new Map<string, string[]>();
        for (const id of row.allowed_databases) {
          const title = names.get(id)?.normalize('NFC').trim().toLowerCase();
          if (!title) continue;
          byTitle.set(title, [...(byTitle.get(title) ?? []), id]);
        }
        let unmatched = folded;
        for (const [title, ids] of [...byTitle].sort(([a], [b]) => b.length - a.length)) {
          if (!unmatched.includes(title)) continue;
          if (ids.length !== 1) throw new NotionDigestSourceDenied();
          selected.push(ids[0]!);
          unmatched = unmatched.replaceAll(title, ' ');
        }
      }
      if (!selected.length && row.allowed_databases.length === 1) selected = row.allowed_databases;
      if (!selected.length || selected.length > 5) throw new NotionDigestSourceDenied();
      const databases = (await this.oauth.validateDatabases(token, selected, signal, true))
        .map(({ id, dataSourceId, title }) => ({ databaseId: id, dataSourceId, title: title || names.get(id) || id }))
        .sort((a, b) => a.databaseId.localeCompare(b.databaseId));
      return {
        version: 1, ownerId, credentialId: row.id, appId: row.app_id,
        workspaceId: row.workspace_id, workspaceName: row.workspace_name, actorId: row.actor_id, botId: row.bot_id,
        identityVersion: row.identity_version, databases,
      };
    });
  }

  async read(
    ownerId: string,
    binding: NotionDigestSourceBinding,
    signal: AbortSignal,
  ): Promise<{
    pages: unknown[];
    pagesByDatabase: Map<string, unknown[]>;
    truncated?: boolean;
    truncatedByDatabase?: Map<string, boolean>;
    databases?: Array<{ databaseId: string; pages: unknown[]; truncated: boolean }>;
  }> {
    return this.tokens.execute(ownerId, binding.credentialId, binding.identityVersion, async (token, _botId, client) => {
      const row = await this.repo.get(client, ownerId, binding.credentialId);
      if (!matchesSource(row, ownerId, binding) || row.app_id !== this.oauth.appId) throw new NotionDigestSourceDenied();
      const expectedDataSources = new Map(binding.databases.map((d) => [d.databaseId, d.dataSourceId]));
      const adapter = new NotionAdapter({
        credentials: { token }, apiBaseUrl: this.oauth.apiBaseUrl,
        allowedScope: { databases: [...expectedDataSources.keys()] }, expectedDataSources,
      });
      const pages: unknown[] = [];
      const pagesByDatabase = new Map<string, unknown[]>();
      const truncatedByDatabase = new Map<string, boolean>();
      const databases: Array<{ databaseId: string; pages: unknown[]; truncated: boolean }> = [];
      let truncated = false;
      for (const { databaseId } of binding.databases) {
        try {
          const result = await adapter.execute('notion.query_database', { databaseId, limit: 20 }, { signal });
          const dbTruncated = Boolean(result?.truncated);
          if (dbTruncated) truncated = true;
          pagesByDatabase.set(databaseId, result.pages);
          truncatedByDatabase.set(databaseId, dbTruncated);
          databases.push({ databaseId, pages: result.pages, truncated: dbTruncated });
          pages.push(...result.pages);
        } catch (error) {
          if (error instanceof StepError && error.statusCode === 401) {
            throw new NotionOAuthError(error.message, true);
          }
          if (error instanceof StepError && (error.category === 'AUTH_ERROR' || error.category === 'VALIDATION' || error.category === 'NOT_FOUND')) {
            throw new NotionDigestSourceDenied();
          }
          throw error;
        }
      }
      return { pages, pagesByDatabase, truncated, truncatedByDatabase, databases };
    });
  }

  async withSource<T>(
    ownerId: string, binding: NotionDigestSourceBinding, signal: AbortSignal, dispatch: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.repo.withOwner(ownerId, async (client) => {
      signal.throwIfAborted();
      const row = await this.repo.get(client, ownerId, binding.credentialId);
      if (!matchesSource(row, ownerId, binding) || row.app_id !== this.oauth.appId) throw new NotionDigestSourceDenied();
      const token = decryptCredentials(row.config!, this.encryptionKey).accessToken;
      const current = await this.oauth.validateDatabases(token, binding.databases.map((d) => d.databaseId), signal, true);
      const sourceIds = new Map(current.map(({ id, dataSourceId }) => [id, dataSourceId]));
      if (binding.databases.some((d) => sourceIds.get(d.databaseId) !== d.dataSourceId)) throw new NotionDigestSourceDenied();
      signal.throwIfAborted();
      return dispatch(client);
    });
  }
}
