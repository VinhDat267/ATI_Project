import type pg from 'pg';
import { isUuid } from '../uuid.js';
import { WorkspaceRepoError } from './errors.js';
import { withTransaction } from './transaction.js';
import { WorkspaceAuditRepo } from './workspace-audit-repo.js';
import { assertValidExpectedVersion, authorizeWorkspaceAdmin } from './shared-auth.js';
import type { WorkspaceMemberItem, WorkspaceMembershipStatus } from '@wap/tool-schemas';
import type {
  MemberDecisionRequest,
  MemberDecisionResponse,
  MembershipStatus,
  WorkspaceRole,
} from './types.js';

interface MembershipLockRow {
  role: WorkspaceRole;
  status: MembershipStatus;
  version: number;
}

export class WorkspaceMembershipRepo {
  constructor(
    private readonly pool: pg.Pool,
    private readonly auditRepo: WorkspaceAuditRepo = new WorkspaceAuditRepo(pool)
  ) {}

  async decideMember(
    workspaceId: string,
    actorUserId: string,
    targetUserId: string,
    input: MemberDecisionRequest
  ): Promise<MemberDecisionResponse> {
    assertValidExpectedVersion(input.expectedVersion);

    if (!isUuid(targetUserId)) {
      throw new WorkspaceRepoError(400, 'INVALID_TARGET_USER', 'Invalid target user ID');
    }

    if (input.decision !== 'approve' && input.decision !== 'reject' && input.decision !== 'remove') {
      throw new WorkspaceRepoError(400, 'INVALID_DECISION', 'Invalid decision');
    }

    // Guard: self-approve forbidden
    if (actorUserId === targetUserId && input.decision === 'approve') {
      throw new WorkspaceRepoError(
        409,
        'SELF_APPROVE_FORBIDDEN',
        'Cannot approve own membership'
      );
    }

    return withTransaction(this.pool, async (client) => {
      // 1. Authorize actor as active workspace admin under workspace barrier lock
      const { actorMembership } = await authorizeWorkspaceAdmin(
        client,
        workspaceId,
        actorUserId,
        true
      );

      // 2. Lock target membership row
      let targetMem: MembershipLockRow;
      if (actorUserId === targetUserId) {
        targetMem = actorMembership;
      } else {
        const targetRes = await client.query(
          `SELECT role, status, version
           FROM ati_workspace_memberships
           WHERE workspace_id = $1 AND user_id = $2
           FOR UPDATE`,
          [workspaceId, targetUserId]
        );
        if (targetRes.rowCount === 0) {
          throw new WorkspaceRepoError(404, 'MEMBER_NOT_FOUND', 'Target member not found');
        }
        targetMem = targetRes.rows[0];
      }

      // 3. Stale version check must run BEFORE transition predicates
      // so losing concurrent decisions with old versions return STALE_VERSION
      if (targetMem.version !== input.expectedVersion) {
        throw new WorkspaceRepoError(
          409,
          'STALE_VERSION',
          'Target membership version conflict'
        );
      }

      // 4. Enforce strict membership state transitions:
      // approve and reject allowed ONLY on pending; remove allowed ONLY on active
      if (input.decision === 'approve' || input.decision === 'reject') {
        if (targetMem.status !== 'pending') {
          throw new WorkspaceRepoError(
            409,
            'INVALID_STATE_TRANSITION',
            `Decision '${input.decision}' is only allowed for pending members`
          );
        }
      } else if (input.decision === 'remove') {
        if (targetMem.status !== 'active') {
          throw new WorkspaceRepoError(
            409,
            'INVALID_STATE_TRANSITION',
            `Decision 'remove' is only allowed for active members`
          );
        }
      }

      // 5. Guard: Last Active Admin Protection (for active admins being removed)
      if (targetMem.role === 'admin' && input.decision === 'remove') {
        const otherAdminRes = await client.query(
          `SELECT count(*)::int AS count 
           FROM ati_workspace_memberships 
           WHERE workspace_id = $1 AND role = 'admin' AND status = 'active' AND user_id != $2`,
          [workspaceId, targetUserId]
        );
        if (otherAdminRes.rows[0].count < 1) {
          throw new WorkspaceRepoError(
            409,
            'LAST_ACTIVE_ADMIN',
            'Cannot remove the last active administrator'
          );
        }
      }

      const newStatus: MembershipStatus =
        input.decision === 'approve'
          ? 'active'
          : input.decision === 'reject'
            ? 'rejected'
            : 'removed';

      // 6. Atomic SQL CAS: predicates match BOTH expected version AND status
      const updateRes = await client.query(
        `UPDATE ati_workspace_memberships
         SET status = $1, version = version + 1, decided_at = clock_timestamp(), decided_by = $2, updated_at = clock_timestamp()
         WHERE workspace_id = $3 AND user_id = $4 AND version = $5 AND status = $6
         RETURNING status, version`,
        [newStatus, actorUserId, workspaceId, targetUserId, input.expectedVersion, targetMem.status]
      );

      if (updateRes.rowCount === 0) {
        throw new WorkspaceRepoError(
          409,
          'STALE_VERSION',
          'Target membership version conflict'
        );
      }

      const updatedMem = updateRes.rows[0];

      // 7. Log audit entry
      await this.auditRepo.log(client, {
        actorId: actorUserId,
        workspaceId,
        action: 'decide_member',
        decision: input.decision,
        version: updatedMem.version,
        details: {
          targetUserId,
          decision: input.decision,
          previousVersion: input.expectedVersion,
        },
      });

      return {
        status: updatedMem.status as 'active' | 'rejected' | 'removed',
        version: updatedMem.version,
      };
    });
  }

  async listMembers(
    workspaceId: string,
    actorUserId: string
  ): Promise<WorkspaceMemberItem[]> {
    return withTransaction(this.pool, async (client) => {
      // 1. Authorize actor as active workspace admin under consistent transaction snapshot
      await authorizeWorkspaceAdmin(client, workspaceId, actorUserId, false);

      // 2. Query all membership rows for this workspace
      const res = await client.query(
        `SELECT user_id, role, status, version, decided_at, created_at
         FROM ati_workspace_memberships
         WHERE workspace_id = $1
         ORDER BY requested_at ASC`,
        [workspaceId]
      );

      return res.rows.map((row) => {
        const item: WorkspaceMemberItem = {
          userId: row.user_id,
          role: row.role as WorkspaceRole,
          status: row.status as WorkspaceMembershipStatus,
          version: row.version,
        };
        const dateVal = row.decided_at ?? (row.status === 'active' ? row.created_at : undefined);
        if (dateVal) {
          item.joinedAt = dateVal instanceof Date ? dateVal.toISOString() : String(dateVal);
        }
        return item;
      });
    });
  }
}
