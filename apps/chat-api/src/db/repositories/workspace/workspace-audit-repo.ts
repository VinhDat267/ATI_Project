import type pg from 'pg';

export interface AuditLogEntry {
  actorId: string;
  workspaceId: string;
  siteId?: string | null;
  action: string;
  decision: string;
  version: number;
  details?: Record<string, unknown>;
}

const ALLOWED_DETAIL_KEYS = new Set([
  'slug',
  'name',
  'bootstrapAdminUserId',
  'targetUserId',
  'decision',
  'previousVersion',
  'inviteId',
  'workspaceId',
  'reason',
]);

export function sanitizeAuditDetails(details?: Record<string, unknown>): Record<string, unknown> {
  if (!details || typeof details !== 'object') return {};
  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(details)) {
    if (ALLOWED_DETAIL_KEYS.has(key)) {
      if (
        typeof val === 'string' ||
        typeof val === 'number' ||
        typeof val === 'boolean' ||
        val === null
      ) {
        sanitized[key] = val;
      }
    }
  }
  return sanitized;
}

export class WorkspaceAuditRepo {
  constructor(private readonly pool?: pg.Pool) {}

  async log(
    clientOrPool: pg.PoolClient | pg.Pool,
    entry: AuditLogEntry
  ): Promise<void> {
    const sanitized = sanitizeAuditDetails(entry.details);
    await clientOrPool.query(
      `INSERT INTO jira_authorization_audit (actor_id, workspace_id, site_id, action, decision, version, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.actorId,
        entry.workspaceId,
        entry.siteId ?? null,
        entry.action,
        entry.decision,
        entry.version,
        JSON.stringify(sanitized),
      ]
    );
  }
}
