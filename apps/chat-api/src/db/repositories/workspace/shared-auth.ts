import type pg from 'pg';
import { isUuid } from '../uuid.js';
import { WorkspaceRepoError } from './errors.js';
import type { MembershipStatus, WorkspaceRole } from './types.js';

export interface AuthorizedAdminContext {
  client: pg.PoolClient;
  workspace: { id: string; status: string; version: number };
  actorMembership: { role: WorkspaceRole; status: MembershipStatus; version: number };
}

export function assertValidExpectedVersion(expectedVersion: unknown): number {
  if (
    typeof expectedVersion !== 'number' ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion <= 0
  ) {
    throw new WorkspaceRepoError(
      400,
      'INVALID_VERSION',
      'expectedVersion must be a positive integer'
    );
  }
  return expectedVersion;
}

/**
 * Common workspace admin authorization helper.
 * - Out-of-bounds UUIDs, missing workspaces, archived workspaces, authenticated outsiders,
 *   and inactive/removed members return 404 (indistinguishable to avoid workspace existence oracles).
 * - Authenticated active non-admin members receive 403.
 * - Authenticated active admins are returned with verified lock rows.
 */
export async function authorizeWorkspaceAdmin(
  client: pg.PoolClient,
  workspaceId: string,
  actorUserId: string,
  lockWorkspace = true
): Promise<AuthorizedAdminContext> {
  if (!isUuid(workspaceId) || !isUuid(actorUserId)) {
    throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
  }

  // 1. Lock/read workspace row
  const wsQuery = lockWorkspace
    ? `SELECT id, status, version FROM ati_workspaces WHERE id = $1 FOR UPDATE`
    : `SELECT id, status, version FROM ati_workspaces WHERE id = $1 FOR SHARE`;
  const wsRes = await client.query(wsQuery, [workspaceId]);

  if (wsRes.rowCount === 0 || wsRes.rows[0].status !== 'active') {
    throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
  }

  // 2. Lock/read actor membership
  const memQuery = lockWorkspace
    ? `SELECT role, status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`
    : `SELECT role, status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR SHARE`;
  const memRes = await client.query(memQuery, [workspaceId, actorUserId]);

  if (memRes.rowCount === 0 || memRes.rows[0].status !== 'active') {
    // Authenticated outsider or removed/inactive member gets 404
    throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
  }

  if (memRes.rows[0].role !== 'admin') {
    // Authenticated active non-admin member gets 403
    throw new WorkspaceRepoError(403, 'ADMIN_REQUIRED', 'Admin role required');
  }

  // 3. Verify actor user status under lock
  const userRes = await client.query<{ status: string }>(
    `SELECT status FROM users WHERE id = $1 FOR SHARE`,
    [actorUserId]
  );

  if (userRes.rowCount === 0 || userRes.rows[0]?.status !== 'active') {
    throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found');
  }

  return {
    client,
    workspace: wsRes.rows[0],
    actorMembership: memRes.rows[0],
  };
}
