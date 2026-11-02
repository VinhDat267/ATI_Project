import type pg from 'pg';
import crypto from 'node:crypto';
import { isUuid } from '../uuid.js';
import { WorkspaceRepoError } from './errors.js';
import { withTransaction } from './transaction.js';
import { WorkspaceAuditRepo } from './workspace-audit-repo.js';
import { assertValidExpectedVersion } from './shared-auth.js';
import type {
  ArchiveWorkspaceResponse,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  EnableExistingWorkspaceRequest,
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
    const trimmedName = input.name?.trim() ?? '';
    if (trimmedName.length < 1 || trimmedName.length > 100) {
      throw new WorkspaceRepoError(
        400,
        'INVALID_NAME',
        'Organization name must be between 1 and 100 characters'
      );
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

      // 2. Generate compatible uppercase generic invite code
      const rawCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      const inviteCode = `ATI-${rawCode.slice(0, 4)}-${rawCode.slice(4, 8) || '0001'}`;

      // 3. Atomically create generic workspace in workspaces table
      const genericWsRes = await client.query<{ id: string; name: string }>(
        `INSERT INTO workspaces (name, invite_code, require_approval, created_by, created_at, updated_at)
         VALUES ($1, $2, true, $3, clock_timestamp(), clock_timestamp())
         RETURNING id, name`,
        [trimmedName, inviteCode, actorUserId]
      );
      const genericWs = genericWsRes.rows[0];
      if (!genericWs) {
        throw new WorkspaceRepoError(500, 'WORKSPACE_CREATE_FAILED', 'Failed to create workspace');
      }
      const unifiedId = genericWs.id;

      // 4. Atomically create generic workspace_members row for bootstrap admin
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
         VALUES ($1, $2, 'admin', 'active', clock_timestamp(), clock_timestamp())`,
        [unifiedId, input.bootstrapAdminUserId]
      );

      // 5. Atomically create Jira policy extension in ati_workspaces using SAME unified UUID
      const wsRes = await client.query<{ id: string; slug: string; version: number }>(
        `INSERT INTO ati_workspaces (id, slug, created_by, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', 1, clock_timestamp(), clock_timestamp())
         RETURNING id, slug, version`,
        [unifiedId, input.slug.trim(), actorUserId]
      );
      const ws = wsRes.rows[0];
      if (!ws) {
        throw new WorkspaceRepoError(500, 'WORKSPACE_CREATE_FAILED', 'Failed to create Jira workspace policy');
      }

      // 6. Atomically create Jira bootstrap admin membership
      await client.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, requested_at, decided_at, created_at, updated_at)
         VALUES ($1, $2, 'admin', 'active', 1, clock_timestamp(), clock_timestamp(), clock_timestamp(), clock_timestamp())`,
        [unifiedId, input.bootstrapAdminUserId]
      );

      // 7. Log audit
      await this.auditRepo.log(client, {
        actorId: actorUserId,
        workspaceId: unifiedId,
        action: 'create_workspace',
        decision: 'allow',
        version: 1,
        details: {
          slug: ws.slug,
          name: trimmedName,
          bootstrapAdminUserId: input.bootstrapAdminUserId,
        },
      });

      // 8. Curate response to canonical public DTO
      return {
        workspace: {
          id: unifiedId,
          name: trimmedName,
          slug: ws.slug,
          version: ws.version,
        },
      };
    });
  }

  async enableExistingWorkspace(
    actorUserId: string,
    workspaceId: string,
    input: EnableExistingWorkspaceRequest
  ): Promise<CreateWorkspaceResponse> {
    if (!isUuid(actorUserId)) {
      throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'Invalid actor ID');
    }
    if (!isUuid(workspaceId)) {
      throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
    }
    if (!input.slug || typeof input.slug !== 'string' || !input.slug.trim()) {
      throw new WorkspaceRepoError(400, 'INVALID_SLUG', 'Slug is required');
    }
    if (!input.bootstrapAdminUserId || !isUuid(input.bootstrapAdminUserId)) {
      throw new WorkspaceRepoError(
        400,
        'INVALID_BOOTSTRAP_ADMIN',
        'Valid bootstrap admin user ID is required'
      );
    }

    return withTransaction(this.pool, async (client) => {
      // 1. Lock and read existing generic organization
      const orgRes = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM workspaces WHERE id = $1 FOR UPDATE`,
        [workspaceId]
      );
      const orgRow = orgRes.rows[0];
      if (!orgRow) {
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      }
      const orgName = orgRow.name;

      // 2. Lock the policy; disclose conflicts only after current authority checks.
      const existingPolicyRes = await client.query(
        `SELECT id, status, version FROM ati_workspaces WHERE id = $1 FOR UPDATE`,
        [workspaceId]
      );
      // 3. Lock & verify actor system admin privileges
      const actorUserRes = await client.query<{ role: string; status: string }>(
        `SELECT role, status FROM users WHERE id = $1 FOR SHARE`,
        [actorUserId]
      );
      const actorUser = actorUserRes.rows[0];
      if (!actorUser || actorUser.role !== 'admin' || actorUser.status !== 'active') {
        throw new WorkspaceRepoError(
          403,
          'ADMIN_REQUIRED',
          'Only active system administrators can enable Jira workspaces'
        );
      }

      // 4. Lock & verify actor is an active admin of the target generic organization
      const actorOrgMemRes = await client.query<{ role: string; status: string }>(
        `SELECT role, status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR SHARE`,
        [workspaceId, actorUserId]
      );
      const actorOrgMem = actorOrgMemRes.rows[0];
      if (!actorOrgMem || actorOrgMem.status !== 'active') {
        // Active global admin not a member or in disabled/pending general state gets private 404
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      }
      if (actorOrgMem.role !== 'admin') {
        // Active general MEMBER not admin gets 403 ADMIN_REQUIRED
        throw new WorkspaceRepoError(
          403,
          'ADMIN_REQUIRED',
          'Caller must be an active admin of the target organization'
        );
      }

      if (existingPolicyRes.rowCount !== 0) {
        throw new WorkspaceRepoError(
          409,
          'JIRA_WORKSPACE_ALREADY_ENABLED',
          'Jira workspace policy is already enabled for this organization'
        );
      }

      // 5. Lock & verify bootstrap target user is active in users
      const bootUserRes = await client.query<{ status: string }>(
        `SELECT status FROM users WHERE id = $1 FOR SHARE`,
        [input.bootstrapAdminUserId]
      );
      const bootUser = bootUserRes.rows[0];
      if (!bootUser || bootUser.status !== 'active') {
        throw new WorkspaceRepoError(
          400,
          'INVALID_BOOTSTRAP_ADMIN',
          'Bootstrap admin user must exist and be active'
        );
      }

      // 6. Lock & verify bootstrap target user is an active admin of the target generic organization
      const bootOrgMemRes = await client.query<{ role: string; status: string }>(
        `SELECT role, status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR SHARE`,
        [workspaceId, input.bootstrapAdminUserId]
      );
      const bootOrgMem = bootOrgMemRes.rows[0];
      if (
        !bootOrgMem ||
        bootOrgMem.status !== 'active' ||
        bootOrgMem.role !== 'admin'
      ) {
        throw new WorkspaceRepoError(
          400,
          'INVALID_BOOTSTRAP_ADMIN',
          'Bootstrap admin user must be an active admin of the target organization'
        );
      }

      // 7. Insert Jira policy extension in ati_workspaces with SAME unified UUID
      const wsRes = await client.query<{ id: string; slug: string; version: number }>(
        `INSERT INTO ati_workspaces (id, slug, created_by, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, 'active', 1, clock_timestamp(), clock_timestamp())
         RETURNING id, slug, version`,
        [workspaceId, input.slug.trim(), actorUserId]
      );
      const ws = wsRes.rows[0];
      if (!ws) {
        throw new WorkspaceRepoError(500, 'WORKSPACE_ENABLE_FAILED', 'Failed to enable Jira workspace policy');
      }

      // 8. Insert Jira bootstrap admin membership
      await client.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, requested_at, decided_at, created_at, updated_at)
         VALUES ($1, $2, 'admin', 'active', 1, clock_timestamp(), clock_timestamp(), clock_timestamp(), clock_timestamp())`,
        [workspaceId, input.bootstrapAdminUserId]
      );

      // 9. Log audit
      await this.auditRepo.log(client, {
        actorId: actorUserId,
        workspaceId,
        action: 'enable_workspace',
        decision: 'allow',
        version: 1,
        details: {
          slug: ws.slug,
          name: orgName,
          bootstrapAdminUserId: input.bootstrapAdminUserId,
        },
      });

      // 10. Return canonical public DTO
      return {
        workspace: {
          id: workspaceId,
          name: orgName,
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

    interface WorkspaceSummaryRow {
      id: string;
      slug: string;
      name: string;
      role: 'admin' | 'member';
      membershipStatus: 'pending' | 'active' | 'rejected' | 'removed';
      workspaceVersion: number;
      membershipVersion: number;
    }

    const res = await this.pool.query<WorkspaceSummaryRow>(
      `SELECT
         aw.id,
         aw.slug,
         w.name,
         m.role,
         m.status AS "membershipStatus",
         aw.version AS "workspaceVersion",
         m.version AS "membershipVersion"
       FROM ati_workspace_memberships m
       JOIN ati_workspaces aw ON m.workspace_id = aw.id
       JOIN workspaces w ON w.id = aw.id
       JOIN users u ON u.id = m.user_id
       JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.user_id = m.user_id
       WHERE m.user_id = $1
         AND u.status = 'active'
         AND wm.status = 'active'
         AND aw.status = 'active'
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
      // 1. Lock workspace policy row common barrier FIRST
      const wsRes = await client.query<{ id: string; status: string; version: number }>(
        `SELECT id, status, version FROM ati_workspaces WHERE id = $1 FOR UPDATE`,
        [workspaceId]
      );
      const wsRow = wsRes.rows[0];
      if (!wsRow) {
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      }
      if (wsRow.version !== expectedVersion) {
        throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Workspace version conflict');
      }

      // 2. Recheck caller in users AFTER acquiring workspace lock, and hold row FOR SHARE
      const actorRes = await client.query<{ role: string; status: string }>(
        `SELECT role, status FROM users WHERE id = $1 FOR SHARE`,
        [actorUserId]
      );
      const actorRow = actorRes.rows[0];
      if (!actorRow || actorRow.role !== 'admin' || actorRow.status !== 'active') {
        throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'System admin required');
      }

      // 3. Update ONLY Jira workspace policy to archived
      const updateRes = await client.query<{ version: number }>(
        `UPDATE ati_workspaces
         SET status = 'archived', version = version + 1, archived_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE id = $1 AND version = $2
         RETURNING version`,
        [workspaceId, expectedVersion]
      );
      const updateRow = updateRes.rows[0];
      if (!updateRow) {
        throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Workspace version conflict');
      }
      const newVersion = updateRow.version;

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
      const wsRes = await client.query<{ id: string; status: string; version: number }>(
        `SELECT id, status, version FROM ati_workspaces WHERE id = $1 FOR UPDATE`,
        [workspaceId]
      );
      const wsRow = wsRes.rows[0];
      if (!wsRow) {
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
      }
      if (wsRow.version !== input.expectedVersion) {
        throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Workspace version conflict');
      }

      // 2. Recheck caller in users AFTER acquiring workspace lock, and hold row FOR SHARE
      const actorRes = await client.query<{ role: string; status: string }>(
        `SELECT role, status FROM users WHERE id = $1 FOR SHARE`,
        [actorUserId]
      );
      const actorRow = actorRes.rows[0];
      if (!actorRow || actorRow.role !== 'admin' || actorRow.status !== 'active') {
        throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'System admin required');
      }

      // 3. Recheck target user in users AFTER acquiring workspace lock, and hold row FOR SHARE
      const userRes = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM users WHERE id = $1 FOR SHARE`,
        [input.userId]
      );
      const targetUserRow = userRes.rows[0];
      if (!targetUserRow || targetUserRow.status !== 'active') {
        throw new WorkspaceRepoError(400, 'INVALID_USER', 'Target user must exist and be active');
      }

      // 4. Target user MUST be an active admin of the generic organization
      const orgMemRes = await client.query<{ role: string; status: string }>(
        `SELECT role, status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR SHARE`,
        [workspaceId, input.userId]
      );
      const orgMemRow = orgMemRes.rows[0];
      if (!orgMemRow || orgMemRow.status !== 'active' || orgMemRow.role !== 'admin') {
        throw new WorkspaceRepoError(
          400,
          'INVALID_USER',
          'Target user must be an active admin of the organization'
        );
      }

      // 5. Update workspace version
      const updateWsRes = await client.query<{ version: number }>(
        `UPDATE ati_workspaces
         SET version = version + 1, updated_at = clock_timestamp()
         WHERE id = $1 AND version = $2
         RETURNING version`,
        [workspaceId, input.expectedVersion]
      );
      const updateWsRow = updateWsRes.rows[0];
      if (!updateWsRow) {
        throw new WorkspaceRepoError(409, 'STALE_VERSION', 'Workspace version conflict');
      }
      const newWsVersion = updateWsRow.version;

      // 6. Upsert membership as active admin
      await client.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, decided_at, decided_by)
         VALUES ($1, $2, 'admin', 'active', 1, clock_timestamp(), $3)
         ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET role = 'admin', status = 'active', version = ati_workspace_memberships.version + 1,
             decided_at = clock_timestamp(), decided_by = $3, updated_at = clock_timestamp()`,
        [workspaceId, input.userId, actorUserId]
      );

      // 7. Log audit
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
