import type { PlanConnections } from '@wap/tool-schemas';
import type {
  NotionAuthFailureCode,
  NotionConnectionRepo,
} from '../../db/repositories/notion-connection-repo.js';

export type NotionConnectionReference = NonNullable<PlanConnections['notion']>;

export interface NotionConnectionLookupOptions {
  repo: Pick<NotionConnectionRepo, 'getActive'>;
}

export interface NotionConnectionLookupResult {
  status: 'not_connected' | 'reconnect_required' | 'needs_scope' | 'connected';
  connection?: NotionConnectionReference;
  selectedDatabases: Array<{ id: string; title: string; url?: string }>;
  workspaceName?: string;
  workspaceId?: string;
  authFailureCode?: NotionAuthFailureCode | null;
}

export function createNotionConnectionLookup(options: NotionConnectionLookupOptions) {
  return async (userId: string): Promise<NotionConnectionLookupResult> => {
    const row = await options.repo.getActive(userId);
    if (!row) {
      return { status: 'not_connected', selectedDatabases: [] };
    }
    if (row.status !== 'active' || !row.config) {
      return {
        status: 'reconnect_required',
        workspaceName: row.workspace_name,
        workspaceId: row.workspace_id,
        authFailureCode: row.refresh_in_flight ? 'rotation_unknown' : (row.auth_failure_code ?? null),
        selectedDatabases: [],
      };
    }
    if (!Array.isArray(row.allowed_databases) || row.allowed_databases.length === 0) {
      return {
        status: 'needs_scope',
        workspaceName: row.workspace_name,
        workspaceId: row.workspace_id,
        selectedDatabases: [],
      };
    }

    const databaseIds = [...row.allowed_databases].sort();
    const rawSelected = Array.isArray(row.selected_databases) ? row.selected_databases : [];
    const selectedMap = new Map(
      rawSelected
        .filter((d) => d && typeof d.id === 'string')
        .map((d) => [d.id, { id: d.id, title: d.title || d.id, ...(d.url ? { url: d.url } : {}) }]),
    );
    const selectedDatabases = databaseIds.map(
      (id) => selectedMap.get(id) ?? { id, title: id },
    );

    return {
      status: 'connected',
      workspaceName: row.workspace_name,
      workspaceId: row.workspace_id,
      selectedDatabases,
      connection: {
        credentialId: row.id,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        botId: row.bot_id,
        identityVersion: row.identity_version,
        databaseIds,
        databases: selectedDatabases,
      },
    };
  };
}
