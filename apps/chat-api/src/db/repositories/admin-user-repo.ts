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
}
