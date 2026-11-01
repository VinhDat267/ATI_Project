import type pg from 'pg';
import { isUuid } from '../uuid.js';
import { WorkspaceRepoError } from './errors.js';
import { withTransaction } from './transaction.js';
import { WorkspaceAuditRepo } from './workspace-audit-repo.js';
import { assertValidExpectedVersion } from './shared-auth.js';
import type {
  ArchiveWorkspaceResponse,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  RecoverWorkspaceAdminRequest,
  RecoverWorkspaceAdminResponse,
  WorkspaceSummary,
} from './types.js';

export class WorkspaceCoreRepo {
  constructor(
    private readonly pool: pg.Pool,
    private readonly auditRepo: WorkspaceAuditRepo = new WorkspaceAuditRepo(pool)
  ) {}

  async createWorkspaceWithBootstrapAdmin(
    actorUserId: string,
    input: CreateWorkspaceRequest
  ): Promise<CreateWorkspaceResponse> {
    if (!isUuid(actorUserId)) {
      throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'Invalid actor ID');
    }
    if (!input.slug || typeof input.slug !== 'string' || !input.slug.trim()) {
      throw new WorkspaceRepoError(400, 'INVALID_SLUG', 'Slug is required');
    }
    if (!input.name || typeof input.name !== 'string' || !input.name.trim()) {
      throw new WorkspaceRepoError(400, 'INVALID_NAME', 'Name is required');
    }
    if (!input.bootstrapAdminUserId || !isUuid(input.bootstrapAdminUserId)) {
      throw new WorkspaceRepoError(
        400,
        'INVALID_BOOTSTRAP_ADMIN',
        'Valid bootstrap admin user ID is required'
      );
    }

    return withTransaction(this.pool, async (client) => {
      // 1. Lock actor and bootstrap user rows in deterministic order FOR SHARE to avoid TOCTOU through commit
      const userRes = await client.query(
        `SELECT id, role, status
         FROM users
         WHERE id IN ($1, $2)
         ORDER BY id
         FOR SHARE`,
        [actorUserId, input.bootstrapAdminUserId]
      );

      const actorRow = userRes.rows.find((r) => r.id === actorUserId);
      if (!actorRow || actorRow.role !== 'admin' || actorRow.status !== 'active') {
        throw new WorkspaceRepoError(
          403,
          'ADMIN_REQUIRED',
          'Only active system administrators can create workspaces'
        );
      }

      const bootRow = userRes.rows.find((r) => r.id === input.bootstrapAdminUserId);
      if (!bootRow || bootRow.status !== 'active') {
        throw new WorkspaceRepoError(
          400,
          'INVALID_BOOTSTRAP_ADMIN',
          'Bootstrap admin user must exist and be active'
        );
      }

      // 2. Insert workspace
      const wsRes = await client.query(
        `INSERT INTO ati_workspaces (slug, name, created_by, status, version)
         VALUES ($1, $2, $3, 'active', 1)
         RETURNING id, name, slug, version`,
        [input.slug.trim(), input.name.trim(), actorUserId]
      );
      const ws = wsRes.rows[0];

      // 3. Insert bootstrap admin membership
      await client.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'admin', 'active', 1)`,
        [ws.id, input.bootstrapAdminUserId]
      );

      // 4. Log audit
      await this.auditRepo.log(client, {
        actorId: actorUserId,
        workspaceId: ws.id,
        action: 'create_workspace',
        decision: 'allow',
        version: 1,
        details: {
          slug: ws.slug,
          name: ws.name,
          bootstrapAdminUserId: input.bootstrapAdminUserId,
        },
      });

      // 5. Curate response to canonical public DTO
      return {
        workspace: {
          id: ws.id,
          name: ws.name,
          slug: ws.slug,
          version: ws.version,
        },
      };
    });
  }

  async listWorkspacesForUser(actorUserId: string): Promise<WorkspaceSummary[]> {
    if (!actorUserId || !isUuid(actorUserId)) {
      return [];
    }

    const res = await this.pool.query(
      `SELECT 
         w.id,
         w.slug,
         w.name,
         m.role,
         m.status AS "membershipStatus",
         w.version AS "workspaceVersion",
         m.version AS "membershipVersion"
       FROM ati_workspace_memberships m
       JOIN ati_workspaces w ON m.workspace_id = w.id
       WHERE m.user_id = $1 AND w.status = 'active'
       ORDER BY w.name ASC`,
      [actorUserId]
    );

    return res.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      role: r.role,
      membershipStatus: r.membershipStatus,
      workspaceVersion: r.workspaceVersion,
      membershipVersion: r.membershipVersion,
    }));
  }

  async archiveWorkspace(
    actorUserId: string,
    workspaceId: string,
    expectedVersion: number
  ): Promise<ArchiveWorkspaceResponse> {
    assertValidExpectedVersion(expectedVersion);

    if (!isUuid(actorUserId)) {
      throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'Invalid actor ID');
    }
    if (!isUuid(workspaceId)) {
      throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
    }

    return withTransaction(this.pool, async (client) => {
      // 1. Lock workspace row common barrier FIRST
      const wsRes = await client.query(
        `SELECT id, status, version FROM ati_workspaces WHERE id = $1 FOR UPDATE`,
        [workspaceId]
      );
      if (wsRes.rowCount === 0) {
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      }
      if (wsRes.rows[0].version !== expectedVersion) {
        throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Workspace version conflict');
      }

      // 2. Recheck caller in users AFTER acquiring workspace lock, and hold row FOR SHARE
      const actorRes = await client.query(
        `SELECT role, status FROM users WHERE id = $1 FOR SHARE`,
        [actorUserId]
      );
      if (
        actorRes.rowCount === 0 ||
        actorRes.rows[0].role !== 'admin' ||
        actorRes.rows[0].status !== 'active'
      ) {
        throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'System admin required');
      }

      // 3. Update workspace to archived
      const updateRes = await client.query(
        `UPDATE ati_workspaces
         SET status = 'archived', version = version + 1, archived_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE id = $1 AND version = $2
         RETURNING version`,
        [workspaceId, expectedVersion]
      );
      if (updateRes.rowCount === 0) {
        throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Workspace version conflict');
      }
      const newVersion = updateRes.rows[0].version;

      // 4. Log audit
      await this.auditRepo.log(client, {
        actorId: actorUserId,
        workspaceId,
        action: 'archive_workspace',
        decision: 'allow',
        version: newVersion,
        details: { workspaceId },
      });

      return { workspaceVersion: newVersion, status: 'archived' };
    });
  }

  async recoverWorkspaceAdmin(
    actorUserId: string,
    workspaceId: string,
    input: RecoverWorkspaceAdminRequest
  ): Promise<RecoverWorkspaceAdminResponse> {
    assertValidExpectedVersion(input.expectedVersion);

    if (!isUuid(actorUserId)) {
      throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'Invalid actor ID');
    }
    if (!isUuid(workspaceId)) {
      throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
    }
    if (!isUuid(input.userId)) {
      throw new WorkspaceRepoError(400, 'INVALID_USER', 'Valid target user ID required');
    }

    return withTransaction(this.pool, async (client) => {
      // 1. Lock workspace row common barrier FIRST
      const wsRes = await client.query(
        `SELECT id, status, version FROM ati_workspaces WHERE id = $1 FOR UPDATE`,
        [workspaceId]
      );
      if (wsRes.rowCount === 0) {
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      }
      if (wsRes.rows[0].version !== input.expectedVersion) {
        throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Workspace version conflict');
      }

      // 2. Recheck caller in users AFTER acquiring workspace lock, and hold row FOR SHARE
      const actorRes = await client.query(
        `SELECT role, status FROM users WHERE id = $1 FOR SHARE`,
        [actorUserId]
      );
      if (
        actorRes.rowCount === 0 ||
        actorRes.rows[0].role !== 'admin' ||
        actorRes.rows[0].status !== 'active'
      ) {
        throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'System admin required');
      }

      // 3. Recheck target user in users AFTER acquiring workspace lock, and hold row FOR SHARE
      const userRes = await client.query(
        `SELECT id, status FROM users WHERE id = $1 FOR SHARE`,
        [input.userId]
      );
      if (userRes.rowCount === 0 || userRes.rows[0].status !== 'active') {
        throw new WorkspaceRepoError(400, 'INVALID_USER', 'Target user must exist and be active');
      }

      // 4. Update workspace version
      const updateWsRes = await client.query(
        `UPDATE ati_workspaces
         SET version = version + 1, updated_at = clock_timestamp()
         WHERE id = $1 AND version = $2
         RETURNING version`,
        [workspaceId, input.expectedVersion]
      );
      if (updateWsRes.rowCount === 0) {
        throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Workspace version conflict');
      }
      const newWsVersion = updateWsRes.rows[0].version;

      // 5. Upsert membership as active admin
      await client.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, decided_at, decided_by)
         VALUES ($1, $2, 'admin', 'active', 1, clock_timestamp(), $3)
         ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET role = 'admin', status = 'active', version = ati_workspace_memberships.version + 1,
             decided_at = clock_timestamp(), decided_by = $3, updated_at = clock_timestamp()`,
        [workspaceId, input.userId, actorUserId]
      );

      // 6. Log audit
      await this.auditRepo.log(client, {
        actorId: actorUserId,
        workspaceId,
        action: 'recover_workspace_admin',
        decision: 'allow',
        version: newWsVersion,
        details: { targetUserId: input.userId },
      });

      return { workspaceVersion: newWsVersion };
    });
  }
}
