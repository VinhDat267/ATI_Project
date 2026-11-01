import type pg from 'pg';
import crypto from 'node:crypto';

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRandomInviteCode(): string {
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += INVITE_ALPHABET[crypto.randomInt(0, INVITE_ALPHABET.length)];
    part2 += INVITE_ALPHABET[crypto.randomInt(0, INVITE_ALPHABET.length)];
  }
  return `ATI-${part1}-${part2}`;
}

export function normalizeInviteCode(code: string): string {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

export class WorkspaceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: 'admin' | 'member';
  status: 'pending' | 'active' | 'disabled';
  inviteCode?: string;
  requireApproval?: boolean;
  pendingCount?: number;
  createdAt: Date;
}

export class WorkspaceRepo {
  constructor(private readonly pool: pg.Pool) {}

  async create(userId: string, name: string, requireApproval = true, now = Date.now()): Promise<WorkspaceSummary> {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (trimmedName.length < 1 || trimmedName.length > 100) {
      throw new WorkspaceError(400, 'INVALID_NAME', 'Tên tổ chức phải từ 1 đến 100 ký tự.');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let inviteCode = '';
      let wsRow: { id: string; name: string; invite_code: string; require_approval: boolean; created_at: Date } | undefined;

      for (let attempt = 0; attempt < 5; attempt++) {
        inviteCode = generateRandomInviteCode();
        try {
          const res = await client.query<{ id: string; name: string; invite_code: string; require_approval: boolean; created_at: Date }>(
            `INSERT INTO workspaces (name, invite_code, require_approval, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
            [trimmedName, inviteCode, requireApproval, userId, new Date(now)]
          );
          wsRow = res.rows[0];
          break;
        } catch (err: any) {
          if (err?.code === '23505' && err?.constraint === 'workspaces_invite_code_key') {
            continue;
          }
          throw err;
        }
      }

      if (!wsRow) {
        throw new WorkspaceError(500, 'INVITE_CODE_GENERATION_FAILED', 'Không thể tạo mã mời.');
      }

      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
         VALUES ($1, $2, 'admin', 'active', $3, $3)`,
        [wsRow.id, userId, new Date(now)]
      );

      await client.query('COMMIT');
      return {
        id: wsRow.id,
        name: wsRow.name,
        role: 'admin',
        status: 'active',
        inviteCode: wsRow.invite_code,
        requireApproval: wsRow.require_approval,
        pendingCount: 0,
        createdAt: wsRow.created_at,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listForUser(userId: string): Promise<WorkspaceSummary[]> {
    const res = await this.pool.query<{
      id: string;
      name: string;
      role: 'admin' | 'member';
      status: 'pending' | 'active' | 'disabled';
      invite_code: string;
      require_approval: boolean;
      created_at: Date;
      pending_count: number;
    }>(
      `SELECT w.id, w.name, wm.role, wm.status, w.invite_code, w.require_approval, wm.created_at,
         (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id AND m.status = 'pending') AS pending_count
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = $1
       ORDER BY wm.created_at ASC, w.name ASC`,
      [userId]
    );

    return res.rows.map(row => {
      const isAdmin = row.role === 'admin' && row.status === 'active';
      return {
        id: row.id,
        name: row.name,
        role: row.role,
        status: row.status,
        ...(isAdmin
          ? {
              inviteCode: row.invite_code,
              requireApproval: row.require_approval,
              pendingCount: row.pending_count,
            }
          : {}),
        createdAt: row.created_at,
      };
    });
  }

  async findMember(
    workspaceId: string,
    userId: string
  ): Promise<{
    workspaceId: string;
    workspaceName: string;
    userId: string;
    role: 'admin' | 'member';
    status: 'pending' | 'active' | 'disabled';
    inviteCode: string;
    requireApproval: boolean;
  } | null> {
    const res = await this.pool.query<{
      workspace_id: string;
      workspace_name: string;
      user_id: string;
      role: 'admin' | 'member';
      status: 'pending' | 'active' | 'disabled';
      invite_code: string;
      require_approval: boolean;
    }>(
      `SELECT wm.workspace_id, w.name AS workspace_name, wm.user_id, wm.role, wm.status, w.invite_code, w.require_approval
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
      [workspaceId, userId]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      userId: row.user_id,
      role: row.role,
      status: row.status,
      inviteCode: row.invite_code,
      requireApproval: row.require_approval,
    };
  }

  async joinByInviteCode(
    userId: string,
    inviteCode: string,
    now = Date.now()
  ): Promise<{
    workspace: WorkspaceSummary;
    created: boolean;
    admins: Array<{ id: string; email: string; name: string }>;
  }> {
    const normalized = normalizeInviteCode(inviteCode);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const wsRes = await client.query<{
        id: string;
        name: string;
        invite_code: string;
        require_approval: boolean;
        created_at: Date;
      }>('SELECT * FROM workspaces WHERE invite_code = $1 FOR UPDATE', [normalized]);
      const ws = wsRes.rows[0];
      if (!ws) {
        throw new WorkspaceError(404, 'INVALID_INVITE_CODE', 'Mã mời không hợp lệ hoặc không tồn tại.');
      }

      const memberRes = await client.query<{
        role: 'admin' | 'member';
        status: 'pending' | 'active' | 'disabled';
        created_at: Date;
      }>('SELECT role, status, created_at FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE', [
        ws.id,
        userId,
      ]);
      const existing = memberRes.rows[0];

      if (existing) {
        if (existing.status === 'disabled') {
          throw new WorkspaceError(403, 'WORKSPACE_MEMBER_DISABLED', 'Bạn đã bị khóa quyền thành viên trong tổ chức này.');
        }
        await client.query('COMMIT');
        return {
          workspace: {
            id: ws.id,
            name: ws.name,
            role: existing.role,
            status: existing.status,
            createdAt: existing.created_at,
          },
          created: false,
          admins: [],
        };
      }

      const newStatus = ws.require_approval ? 'pending' : 'active';
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
         VALUES ($1, $2, 'member', $3, $4, $4)`,
        [ws.id, userId, newStatus, new Date(now)]
      );

      let admins: Array<{ id: string; email: string; name: string }> = [];
      if (ws.require_approval) {
        const adminsRes = await client.query<{ id: string; email: string; name: string }>(
          `SELECT u.id, u.email, u.name
           FROM workspace_members wm
           JOIN users u ON u.id = wm.user_id
           WHERE wm.workspace_id = $1 AND wm.role = 'admin' AND wm.status = 'active'`,
          [ws.id]
        );
        admins = adminsRes.rows;
      }

      await client.query('COMMIT');
      return {
        workspace: {
          id: ws.id,
          name: ws.name,
          role: 'member',
          status: newStatus,
          createdAt: new Date(now),
        },
        created: true,
        admins,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async regenerateInviteCode(actorId: string, workspaceId: string, now = Date.now()): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const member = await client.query<{ role: string; status: string }>(
        'SELECT role, status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE',
        [workspaceId, actorId]
      );
      if (!member.rows[0] || member.rows[0].role !== 'admin' || member.rows[0].status !== 'active') {
        throw new WorkspaceError(403, 'ADMIN_REQUIRED', 'Chỉ quản trị viên tổ chức mới có quyền đổi mã mời.');
      }

      let newCode = '';
      let updated = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        newCode = generateRandomInviteCode();
        try {
          await client.query(
            'UPDATE workspaces SET invite_code = $2, updated_at = $3 WHERE id = $1',
            [workspaceId, newCode, new Date(now)]
          );
          updated = true;
          break;
        } catch (err: any) {
          if (err?.code === '23505' && err?.constraint === 'workspaces_invite_code_key') {
            continue;
          }
          throw err;
        }
      }

      if (!updated) {
        throw new WorkspaceError(500, 'INVITE_CODE_GENERATION_FAILED', 'Không thể tạo mã mời mới.');
      }

      await client.query('COMMIT');
      return newCode;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateSettings(
    actorId: string,
    workspaceId: string,
    settings: { requireApproval: boolean },
    now = Date.now()
  ): Promise<{ requireApproval: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const member = await client.query<{ role: string; status: string }>(
        'SELECT role, status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE',
        [workspaceId, actorId]
      );
      if (!member.rows[0] || member.rows[0].role !== 'admin' || member.rows[0].status !== 'active') {
        throw new WorkspaceError(403, 'ADMIN_REQUIRED', 'Chỉ quản trị viên tổ chức mới có quyền thay đổi cài đặt.');
      }

      const res = await client.query<{ require_approval: boolean }>(
        'UPDATE workspaces SET require_approval = $2, updated_at = $3 WHERE id = $1 RETURNING require_approval',
        [workspaceId, settings.requireApproval, new Date(now)]
      );

      await client.query('COMMIT');
      return { requireApproval: res.rows[0].require_approval };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
