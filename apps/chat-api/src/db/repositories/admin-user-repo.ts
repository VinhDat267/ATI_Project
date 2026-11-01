import type pg from 'pg';

export type AdminAction = 'approve' | 'disable' | 'enable' | 'role';
export type AccountStatus = 'pending' | 'active' | 'disabled';
export type AccountRole = 'member' | 'admin';
export interface AdminUser {
  id: string; email: string; name: string; status: AccountStatus; role: AccountRole;
  emailVerified: boolean; hasPassword: boolean; hasGoogle: boolean; createdAt: Date; openSessions: number;
}
export interface AdminUserPage { users: AdminUser[]; total: number; pendingCount: number; page: number; limit: number }
export interface AdminUserFilter { status?: AccountStatus; search?: string; page: number; limit: number }
export class AdminUserError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
interface AccountRow {
  id: string; email: string; name: string; status: AccountStatus; role: AccountRole;
  email_verified: boolean; has_password: boolean; has_google: boolean; created_at: Date; open_sessions: number;
}
const fields = `u.id,u.email,u.name,u.status,u.role,u.email_verified,
  (u.password IS NOT NULL) AS has_password,(u.google_sub IS NOT NULL) AS has_google,u.created_at`;
function safeUser(row: AccountRow): AdminUser {
  return { id: row.id, email: row.email, name: row.name, status: row.status, role: row.role,
    emailVerified: row.email_verified, hasPassword: row.has_password, hasGoogle: row.has_google,
    createdAt: row.created_at, openSessions: Number(row.open_sessions ?? 0) };
}
const forbidden = () => new AdminUserError(403, 'ADMIN_REQUIRED', 'Bạn không có quyền quản trị người dùng.');

export class AdminUserRepo {
  constructor(private readonly pool: pg.Pool) {}

  async list(actorId: string, filter: AdminUserFilter): Promise<AdminUserPage> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const actor = await client.query("SELECT id FROM users WHERE id=$1 AND role='admin' AND status='active'", [actorId]);
      if (!actor.rows[0]) throw forbidden();
      // Wildcards are literal search text; user input never enters SQL syntax.
      const search = filter.search ? `%${filter.search.replace(/[\\%_]/g, '\\$&')}%` : null;
      const args = [filter.status ?? null, search];
      const where = "($1::text IS NULL OR u.status=$1) AND ($2::text IS NULL OR u.email ILIKE $2 ESCAPE '\\' OR u.name ILIKE $2 ESCAPE '\\')";
      const counts = await client.query(`SELECT count(*)::int AS total FROM users u WHERE ${where}`, args);
      const pending = await client.query("SELECT count(*)::int AS count FROM users WHERE status='pending'");
      const result = await client.query<AccountRow>(`SELECT ${fields},
        (SELECT count(*)::int FROM auth_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>now()) AS open_sessions
        FROM users u WHERE ${where} ORDER BY u.created_at DESC,u.id DESC LIMIT $3 OFFSET $4`,
      [...args, filter.limit, (filter.page - 1) * filter.limit]);
      await client.query('COMMIT');
      return { users: result.rows.map(safeUser), total: counts.rows[0].total, pendingCount: pending.rows[0].count, page: filter.page, limit: filter.limit };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async mutate(actorId: string, sessionId: string, targetId: string, action: AdminAction, role?: AccountRole): Promise<{ user: AdminUser; at: Date }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // All administrative mutations share a transaction-scoped lock. Its
      // schema key isolates tests, while every API process on the same DB uses
      // the same lock. Re-read the actor AFTER waiting, never trust middleware's
      // earlier role: mutual demotions must not leave zero administrators.
      await client.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()), 1096111176)');
      const rows = await client.query<AccountRow>(`SELECT ${fields} FROM users u WHERE u.id=ANY($1::uuid[]) ORDER BY u.id FOR UPDATE`, [[actorId, targetId]]);
      const actor = rows.rows.find(row => row.id === actorId);
      if (!actor || actor.role !== 'admin' || actor.status !== 'active') throw forbidden();
      const session = await client.query('SELECT id FROM auth_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE', [sessionId, actorId]);
      if (!session.rows[0]) throw new AdminUserError(401, 'SESSION_REVOKED', 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
      const target = rows.rows.find(row => row.id === targetId);
      if (!target) throw new AdminUserError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.');
      if (actorId === targetId && (action === 'disable' || (action === 'role' && role === 'member'))) {
        throw new AdminUserError(409, 'ADMIN_SELF_CHANGE', 'Bạn không thể tự khóa tài khoản hoặc bỏ quyền quản trị của mình.');
      }
      if (action === 'approve' && (target.status !== 'pending' || !target.email_verified)) {
        throw new AdminUserError(409, 'ACCOUNT_NOT_APPROVABLE', 'Chỉ duyệt được tài khoản chờ duyệt đã xác minh email.');
      }
      if (action === 'enable' && (target.status !== 'disabled' || !target.email_verified)) {
        throw new AdminUserError(409, 'ACCOUNT_NOT_ENABLEABLE', 'Chỉ mở khóa được tài khoản đã bị khóa và đã xác minh email.');
      }
      if (action === 'disable' && target.status === 'disabled') {
        throw new AdminUserError(409, 'ACCOUNT_ALREADY_DISABLED', 'Tài khoản đã bị khóa.');
      }
      if (action === 'disable' && target.status !== 'active') {
        throw new AdminUserError(409, 'ACCOUNT_NOT_DISABLEABLE', 'Chỉ khóa được tài khoản đang hoạt động. Tài khoản chờ duyệt phải được duyệt trước.');
      }
      if (action === 'role' && (!role || target.role === role)) {
        throw new AdminUserError(409, 'ROLE_UNCHANGED', 'Vai trò tài khoản chưa thay đổi.');
      }
      const status = action === 'approve' || action === 'enable' ? 'active' : action === 'disable' ? 'disabled' : target.status;
      const nextRole = action === 'role' ? role! : target.role;
      await client.query('UPDATE users SET status=$2,role=$3,updated_at=now() WHERE id=$1', [targetId, status, nextRole]);
      const admins = await client.query("SELECT count(*)::int AS count FROM users WHERE role='admin' AND status='active'");
      if (admins.rows[0].count < 1) throw new AdminUserError(409, 'LAST_ACTIVE_ADMIN', 'Phải giữ lại ít nhất một quản trị viên đang hoạt động.');
      if (action === 'disable') await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1', [targetId]);
      const result = await client.query<AccountRow & { at: Date }>(`SELECT ${fields},u.updated_at AS at,
        (SELECT count(*)::int FROM auth_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>now()) AS open_sessions FROM users u WHERE u.id=$1`, [targetId]);
      await client.query('COMMIT');
      return { user: safeUser(result.rows[0]!), at: result.rows[0]!.at };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async listForWorkspace(
    actorId: string,
    workspaceId: string,
    filter: AdminUserFilter
  ): Promise<AdminUserPage & { inviteCode: string; requireApproval: boolean; workspaceName: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const wsRes = await client.query<{ name: string; invite_code: string; require_approval: boolean }>(
        'SELECT name, invite_code, require_approval FROM workspaces WHERE id = $1',
        [workspaceId]
      );
      if (!wsRes.rows[0]) throw new AdminUserError(404, 'WORKSPACE_NOT_FOUND', 'Không tìm thấy tổ chức.');
      const ws = wsRes.rows[0];

      const actor = await client.query(
        "SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = 'admin' AND status = 'active'",
        [workspaceId, actorId]
      );
      if (!actor.rows[0]) throw forbidden();

      const search = filter.search ? `%${filter.search.replace(/[\\%_]/g, '\\$&')}%` : null;
      const args = [workspaceId, filter.status ?? null, search];
      const where = "wm.workspace_id = $1 AND ($2::text IS NULL OR wm.status = $2) AND ($3::text IS NULL OR u.email ILIKE $3 ESCAPE '\\' OR u.name ILIKE $3 ESCAPE '\\')";

      const counts = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE ${where}`,
        args
      );
      const pending = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM workspace_members WHERE workspace_id = $1 AND status = 'pending'",
        [workspaceId]
      );

      const result = await client.query<AccountRow>(
        `SELECT u.id, u.email, u.name, wm.status, wm.role, u.email_verified,
           (u.password IS NOT NULL) AS has_password, (u.google_sub IS NOT NULL) AS has_google, wm.created_at,
           (SELECT count(*)::int FROM auth_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS open_sessions
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
         WHERE ${where}
         ORDER BY wm.created_at DESC, u.id DESC
         LIMIT $4 OFFSET $5`,
        [...args, filter.limit, (filter.page - 1) * filter.limit]
      );
      await client.query('COMMIT');
      return {
        users: result.rows.map(safeUser),
        total: counts.rows[0]?.total ?? 0,
        pendingCount: pending.rows[0]?.count ?? 0,
        page: filter.page,
        limit: filter.limit,
        inviteCode: ws.invite_code,
        requireApproval: ws.require_approval,
        workspaceName: ws.name,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async mutateForWorkspace(
    actorId: string,
    sessionId: string,
    workspaceId: string,
    targetId: string,
    action: AdminAction | 'reject',
    role?: AccountRole,
    now = Date.now()
  ): Promise<{ user?: AdminUser; rejectedId?: string; at: Date }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext($1))', [workspaceId]);

      const session = await client.query(
        'SELECT id FROM auth_sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now() FOR UPDATE',
        [sessionId, actorId]
      );
      if (!session.rows[0]) {
        throw new AdminUserError(401, 'SESSION_REVOKED', 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
      }

      const members = await client.query<{
        workspace_id: string;
        user_id: string;
        role: AccountRole;
        status: AccountStatus;
        email: string;
        name: string;
        email_verified: boolean;
        has_password: boolean;
        has_google: boolean;
        created_at: Date;
      }>(
        `SELECT wm.workspace_id, wm.user_id, wm.role, wm.status, u.email, u.name, u.email_verified,
           (u.password IS NOT NULL) AS has_password, (u.google_sub IS NOT NULL) AS has_google, wm.created_at
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = $1 AND wm.user_id = ANY($2::uuid[])
         ORDER BY wm.user_id FOR UPDATE`,
        [workspaceId, [actorId, targetId]]
      );

      const actor = members.rows.find(m => m.user_id === actorId);
      if (!actor || actor.role !== 'admin' || actor.status !== 'active') throw forbidden();

      const target = members.rows.find(m => m.user_id === targetId);
      if (!target) throw new AdminUserError(404, 'USER_NOT_FOUND', 'Không tìm thấy thành viên trong tổ chức.');

      if (actorId === targetId && (action === 'disable' || (action === 'role' && role === 'member'))) {
        throw new AdminUserError(409, 'ADMIN_SELF_CHANGE', 'Bạn không thể tự khóa tài khoản hoặc bỏ quyền quản trị của mình trong tổ chức.');
      }

      if (action === 'reject') {
        if (target.status !== 'pending') {
          throw new AdminUserError(409, 'ACCOUNT_NOT_REJECTABLE', 'Chỉ từ chối được yêu cầu tham gia đang chờ duyệt.');
        }
        await client.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, targetId]);
        await client.query('COMMIT');
        return { rejectedId: targetId, at: new Date(now) };
      }

      if (action === 'approve') {
        if (target.status !== 'pending') {
          throw new AdminUserError(409, 'ACCOUNT_NOT_APPROVABLE', 'Chỉ duyệt được thành viên đang chờ duyệt.');
        }
      }
      if (action === 'enable') {
        if (target.status !== 'disabled') {
          throw new AdminUserError(409, 'ACCOUNT_NOT_ENABLEABLE', 'Chỉ mở khóa được thành viên đã bị khóa.');
        }
      }
      if (action === 'disable') {
        if (target.status === 'disabled') {
          throw new AdminUserError(409, 'ACCOUNT_ALREADY_DISABLED', 'Thành viên đã bị khóa.');
        }
        if (target.status !== 'active') {
          throw new AdminUserError(409, 'ACCOUNT_NOT_DISABLEABLE', 'Chỉ khóa được thành viên đang hoạt động.');
        }
      }
      if (action === 'role') {
        if (!role || target.role === role) {
          throw new AdminUserError(409, 'ROLE_UNCHANGED', 'Vai trò thành viên chưa thay đổi.');
        }
      }

      const nextStatus = action === 'approve' || action === 'enable' ? 'active' : action === 'disable' ? 'disabled' : target.status;
      const nextRole = action === 'role' ? role! : target.role;

      await client.query(
        'UPDATE workspace_members SET status = $3, role = $4, updated_at = $5 WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, targetId, nextStatus, nextRole, new Date(now)]
      );

      if (action === 'disable' || (action === 'role' && role === 'member')) {
        const admins = await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM workspace_members WHERE workspace_id = $1 AND role = 'admin' AND status = 'active'",
          [workspaceId]
        );
        if ((admins.rows[0]?.count ?? 0) < 1) {
          throw new AdminUserError(409, 'LAST_ACTIVE_ADMIN', 'Phải giữ lại ít nhất một quản trị viên đang hoạt động trong tổ chức.');
        }
      }

      const result = await client.query<AccountRow & { at: Date }>(
        `SELECT u.id, u.email, u.name, wm.status, wm.role, u.email_verified,
           (u.password IS NOT NULL) AS has_password, (u.google_sub IS NOT NULL) AS has_google,
           wm.created_at, wm.updated_at AS at,
           (SELECT count(*)::int FROM auth_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS open_sessions
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
        [workspaceId, targetId]
      );
      await client.query('COMMIT');
      return { user: safeUser(result.rows[0]!), at: result.rows[0]!.at };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async approveAllForWorkspace(
    actorId: string,
    sessionId: string,
    workspaceId: string,
    now = Date.now()
  ): Promise<{ approvedUsers: AdminUser[]; approvedCount: number; at: Date }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext($1))', [workspaceId]);

      if (sessionId) {
        const session = await client.query(
          'SELECT id FROM auth_sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now() FOR UPDATE',
          [sessionId, actorId]
        );
        if (!session.rows[0]) {
          throw new AdminUserError(401, 'SESSION_REVOKED', 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
        }
      }

      const actor = await client.query(
        "SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = 'admin' AND status = 'active' FOR UPDATE",
        [workspaceId, actorId]
      );
      if (!actor.rows[0]) throw forbidden();

      const updated = await client.query<{ user_id: string }>(
        "UPDATE workspace_members SET status = 'active', updated_at = $2 WHERE workspace_id = $1 AND status = 'pending' RETURNING user_id",
        [workspaceId, new Date(now)]
      );

      const userIds = updated.rows.map(r => r.user_id);
      let approvedUsers: AdminUser[] = [];
      if (userIds.length > 0) {
        const rows = await client.query<AccountRow>(
          `SELECT u.id, u.email, u.name, wm.status, wm.role, u.email_verified,
             (u.password IS NOT NULL) AS has_password, (u.google_sub IS NOT NULL) AS has_google,
             wm.created_at,
             (SELECT count(*)::int FROM auth_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS open_sessions
           FROM workspace_members wm
           JOIN users u ON u.id = wm.user_id
           WHERE wm.workspace_id = $1 AND wm.user_id = ANY($2::uuid[])`,
          [workspaceId, userIds]
        );
        approvedUsers = rows.rows.map(safeUser);
      }

      await client.query('COMMIT');
      return {
        approvedUsers,
        approvedCount: userIds.length,
        at: new Date(now),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
