import type pg from 'pg';
import crypto from 'node:crypto';
import { isUuid } from '../uuid.js';
import { WorkspaceRepoError } from './errors.js';
import { withTransaction } from './transaction.js';
import { WorkspaceAuditRepo } from './workspace-audit-repo.js';
import { authorizeWorkspaceAdmin } from './shared-auth.js';
import type {
  CreateInviteRequest,
  CreateInviteResponse,
  JoinWorkspaceInternalResponse,
  RevokeInviteResponse,
  WorkspaceInviteItem,
} from './types.js';

export class WorkspaceInviteRepo {
  constructor(
    private readonly pool: pg.Pool,
    private readonly auditRepo: WorkspaceAuditRepo = new WorkspaceAuditRepo(pool)
  ) {}

  async createInvite(
    workspaceId: string,
    actorUserId: string,
    request?: CreateInviteRequest
  ): Promise<CreateInviteResponse> {
    let expiresInDays = 7;
    if (request?.expiresInDays !== undefined) {
      if (
        typeof request.expiresInDays !== 'number' ||
        !Number.isSafeInteger(request.expiresInDays) ||
        request.expiresInDays < 1 ||
        request.expiresInDays > 30
      ) {
        throw new WorkspaceRepoError(
          400,
          'INVALID_EXPIRY',
          'expiresInDays must be a positive integer between 1 and 30'
        );
      }
      expiresInDays = request.expiresInDays;
    }

    return withTransaction(this.pool, async (client) => {
      // 1. Authorize actor as active workspace admin under workspace barrier lock
      await authorizeWorkspaceAdmin(client, workspaceId, actorUserId, true);

      // 2. Generate 32 bytes crypto random token and SHA-256 hash
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      // 3. Insert invite storing hash ONLY and calculating expiry via PostgreSQL DB clock
      const insertRes = await client.query(
        `INSERT INTO ati_workspace_invites (workspace_id, token_hash, inviter_user_id, expires_at)
         VALUES ($1, $2, $3, clock_timestamp() + ($4 || ' days')::interval)
         RETURNING id, expires_at`,
        [workspaceId, tokenHash, actorUserId, String(expiresInDays)]
      );
      const inv = insertRes.rows[0];

      // 4. Audit log entry without exposing raw token or hash
      await this.auditRepo.log(client, {
        actorId: actorUserId,
        workspaceId,
        action: 'create_invite',
        decision: 'allow',
        version: 1,
        details: {
          inviteId: inv.id,
          workspaceId,
        },
      });

      return {
        inviteId: inv.id,
        inviteToken: rawToken,
        expiresAt:
          inv.expires_at instanceof Date ? inv.expires_at.toISOString() : String(inv.expires_at),
      };
    });
  }

  async listInvites(
    workspaceId: string,
    actorUserId: string
  ): Promise<WorkspaceInviteItem[]> {
    return withTransaction(this.pool, async (client) => {
      // 1. Authorize actor as active workspace admin under consistent transaction snapshot
      await authorizeWorkspaceAdmin(client, workspaceId, actorUserId, false);

      // 2. Query active unrevoked invites using PostgreSQL DB clock without exposing hash or token
      const res = await client.query(
        `SELECT id, workspace_id, inviter_user_id, expires_at, revoked_at
         FROM ati_workspace_invites
         WHERE workspace_id = $1 AND revoked_at IS NULL AND expires_at > clock_timestamp()
         ORDER BY created_at DESC`,
        [workspaceId]
      );

      return res.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        inviterUserId: row.inviter_user_id,
        expiresAt:
          row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
        revokedAt: row.revoked_at
          ? row.revoked_at instanceof Date
            ? row.revoked_at.toISOString()
            : String(row.revoked_at)
          : undefined,
      }));
    });
  }

  async revokeInvite(
    workspaceId: string,
    actorUserId: string,
    inviteId: string
  ): Promise<RevokeInviteResponse> {
    if (!isUuid(inviteId)) {
      throw new WorkspaceRepoError(404, 'INVITE_NOT_FOUND', 'Invite not found');
    }

    return withTransaction(this.pool, async (client) => {
      // 1. Authorize actor as active workspace admin under workspace barrier lock
      await authorizeWorkspaceAdmin(client, workspaceId, actorUserId, true);

      // 2. Lock and verify invite
      const invRes = await client.query(
        `SELECT id, revoked_at FROM ati_workspace_invites WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [inviteId, workspaceId]
      );
      if (invRes.rowCount === 0) {
        throw new WorkspaceRepoError(404, 'INVITE_NOT_FOUND', 'Invite not found');
      }

      // 3. Revoke invite using DB clock
      const updateRes = await client.query(
        `UPDATE ati_workspace_invites SET revoked_at = clock_timestamp() WHERE id = $1 RETURNING revoked_at`,
        [inviteId]
      );

      // 4. Audit log
      await this.auditRepo.log(client, {
        actorId: actorUserId,
        workspaceId,
        action: 'revoke_invite',
        decision: 'allow',
        version: 1,
        details: {
          inviteId,
          workspaceId,
        },
      });

      const revokedAt = updateRes.rows[0].revoked_at;
      return {
        revoked: true,
        revokedAt:
          revokedAt instanceof Date ? revokedAt.toISOString() : String(revokedAt),
      };
    });
  }

  async joinWorkspaceWithInvite(
    actorUserId: string,
    inviteToken: string
  ): Promise<JoinWorkspaceInternalResponse> {
    if (!isUuid(actorUserId)) {
      throw new WorkspaceRepoError(403, 'INVALID_USER', 'Invalid user ID');
    }
    if (!inviteToken || typeof inviteToken !== 'string' || inviteToken.length < 32) {
      throw new WorkspaceRepoError(404, 'INVITE_NOT_FOUND', 'Invalid invite token');
    }

    return withTransaction(this.pool, async (client) => {
      // 1. Hash token and lookup invite workspace
      const tokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex');
      const invRes = await client.query(
        `SELECT id, workspace_id
         FROM ati_workspace_invites
         WHERE token_hash = $1`,
        [tokenHash]
      );
      if (invRes.rowCount === 0) {
        throw new WorkspaceRepoError(404, 'INVITE_NOT_FOUND', 'Invite not found');
      }

      const initialInvite = invRes.rows[0];
      const workspaceId = initialInvite.workspace_id;

      // 2. Lock workspace row common barrier
      const wsRes = await client.query(
        `SELECT id, status FROM ati_workspaces WHERE id = $1 FOR UPDATE`,
        [workspaceId]
      );
      if (wsRes.rowCount === 0 || wsRes.rows[0].status !== 'active') {
        throw new WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found or inactive');
      }

      // 3. Initial check and lock of invite row
      const initialInvCheck = await client.query(
        `SELECT id, workspace_id, created_at, expires_at, revoked_at
         FROM ati_workspace_invites
         WHERE id = $1 AND revoked_at IS NULL AND expires_at > clock_timestamp()
         FOR UPDATE`,
        [initialInvite.id]
      );
      if (initialInvCheck.rowCount === 0) {
        throw new WorkspaceRepoError(
          404,
          'INVITE_EXPIRED_OR_REVOKED',
          'Invite has expired or been revoked'
        );
      }

      // 4. Revalidate and lock owned connected Atlassian account FOR SHARE to linearize disconnects
      const accRes = await client.query(
        `SELECT id, status
         FROM jira_accounts
         WHERE user_id = $1 AND status = 'connected'
         FOR SHARE`,
        [actorUserId]
      );
      if (accRes.rowCount === 0) {
        throw new WorkspaceRepoError(
          403,
          'ACCOUNT_NOT_CONNECTED',
          'Atlassian account must be connected to join workspace'
        );
      }

      // 5. Check and lock current membership row
      const memRes = await client.query(
        `SELECT role, status, version, decided_at
         FROM ati_workspace_memberships
         WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
        [workspaceId, actorUserId]
      );

      // 6. Re-check locked invite revoked_at/expiry with fresh clock_timestamp() AFTER ALL lock waits (account and membership)
      const freshInvRes = await client.query(
        `SELECT id, workspace_id, created_at, expires_at, revoked_at
         FROM ati_workspace_invites
         WHERE id = $1 AND revoked_at IS NULL AND expires_at > clock_timestamp()
         FOR UPDATE`,
        [initialInvite.id]
      );
      if (freshInvRes.rowCount === 0) {
        throw new WorkspaceRepoError(
          404,
          'INVITE_EXPIRED_OR_REVOKED',
          'Invite has expired or been revoked'
        );
      }
      const freshInvite = freshInvRes.rows[0];

      // 7. Process membership outcome under verified locks
      const mem = memRes.rows[0];
      if (mem) {
        if (mem.status === 'active') {
          return { outcome: 'already_active', workspaceId };
        }
        if (mem.status === 'pending') {
          return {
            outcome: 'pending',
            workspaceId,
            requestId: `${workspaceId}:${actorUserId}`,
          };
        }
        if (mem.status === 'rejected' || mem.status === 'removed') {
          // If rejected/removed row has no decision timestamp, fail closed
          if (!mem.decided_at) {
            throw new WorkspaceRepoError(
              404,
              'INVITE_EXPIRED_OR_SUPERSEDED',
              'Membership decision timestamp missing'
            );
          }

          // Monotonic rejoin rule: compare original timestamptz columns directly in PostgreSQL
          const cmpRes = await client.query(
            `SELECT (inv.created_at > mem.decided_at) AS is_newer
             FROM ati_workspace_invites inv, ati_workspace_memberships mem
             WHERE inv.id = $1 AND mem.workspace_id = $2 AND mem.user_id = $3`,
            [freshInvite.id, workspaceId, actorUserId]
          );

          if (!cmpRes.rows[0]?.is_newer) {
            throw new WorkspaceRepoError(
              404,
              'INVITE_EXPIRED_OR_SUPERSEDED',
              'Invite was superseded by previous membership decision'
            );
          }

          // Valid rejoin: reset status to pending with version + 1, role stays 'member'
          const updateRes = await client.query(
            `UPDATE ati_workspace_memberships
             SET status = 'pending', role = 'member', version = version + 1, requested_at = clock_timestamp(), updated_at = clock_timestamp()
             WHERE workspace_id = $1 AND user_id = $2
             RETURNING version`,
            [workspaceId, actorUserId]
          );

          await this.auditRepo.log(client, {
            actorId: actorUserId,
            workspaceId,
            action: 'join_workspace',
            decision: 'pending',
            version: updateRes.rows[0].version,
            details: { inviteId: freshInvite.id },
          });

          return {
            outcome: 'pending',
            workspaceId,
            requestId: `${workspaceId}:${actorUserId}`,
          };
        }
      }

      // 6. New member join: insert pending membership
      const insertRes = await client.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
         VALUES ($1, $2, 'member', 'pending', 1)
         RETURNING version`,
        [workspaceId, actorUserId]
      );

      await this.auditRepo.log(client, {
        actorId: actorUserId,
        workspaceId,
        action: 'join_workspace',
        decision: 'pending',
        version: insertRes.rows[0].version,
        details: { inviteId: freshInvite.id },
      });

      return {
        outcome: 'pending',
        workspaceId,
        requestId: `${workspaceId}:${actorUserId}`,
      };
    });
  }
}
