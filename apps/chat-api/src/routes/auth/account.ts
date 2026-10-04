import { Router, type Request } from 'express';
import { createAuthMiddleware, type AuthUser } from '../../auth/jwt.js';
import { LoginFailures } from '../../auth/login-failures.js';
import { describeUserAgent } from '../../auth/user-agent.js';
import { toAuthUser, verifyPassword } from '../../db/repositories/user-repo.js';
import type { AuthRoutesOptions } from './index.js';
import { validPassword } from './public-helpers.js';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const caller = (req: Request) => (req as any).user as AuthUser & { sid: string };

// Every route acts only on the caller's own account and sessions: the identity comes
// from the access token and the session middleware re-checks it in PostgreSQL.
export function createAccountRoutes(options: AuthRoutesOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const sessions = options.sessionRepo ?? options.userRepo?.sessions;
  const failures = options.loginFailures ?? new LoginFailures(clock);
  const users = options.userRepo!;
  router.use((_req, res, next) => {
    if (!options.userRepo || !sessions) { res.status(503).json({ error: 'Quản lý tài khoản cần PostgreSQL.' }); return; }
    next();
  }, createAuthMiddleware(options.jwtSecret, { sessionRepo: sessions, clock }));

  router.get('/', async (req, res) => {
    const account = await users.accountProfile(caller(req).id);
    if (!account) { res.status(401).json({ error: 'Phiên đăng nhập không còn hợp lệ.' }); return; }
    res.json({ account });
  });

  router.patch('/profile', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || Array.from(name).length > 100) { res.status(400).json({ error: 'Tên phải có từ 1 đến 100 ký tự.', code: 'NAME_INVALID' }); return; }
    const user = await users.updateName(caller(req).id, name, clock());
    if (!user) { res.status(401).json({ error: 'Phiên đăng nhập không còn hợp lệ.' }); return; }
    res.json({ user: toAuthUser(user) });
  });

  router.post('/change-password', async (req, res) => {
    const currentPassword = req.body?.currentPassword, newPassword = req.body?.newPassword;
    // Malformed input is rejected before the current password is checked, so it never spends the login budget.
    if (!validPassword(newPassword)) { res.status(400).json({ error: 'Mật khẩu mới phải có từ 12 đến 128 ký tự.', code: 'NEW_PASSWORD_INVALID' }); return; }
    if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 128) {
      res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại.', code: 'CURRENT_PASSWORD_REQUIRED' }); return;
    }
    const user = caller(req);
    const account = await users.findById(user.id);
    if (!account) { res.status(401).json({ error: 'Phiên đăng nhập không còn hợp lệ.' }); return; }
    if (!account.password) {
      res.status(409).json({ error: 'Tài khoản chưa có mật khẩu. Dùng "Quên mật khẩu" để đặt mật khẩu qua email.', code: 'PASSWORD_NOT_SET' }); return;
    }
    const key = LoginFailures.key(req.ip, account.email);
    await failures.serialize(key, async () => {
      const retryAfter = failures.retryAfter(key);
      if (retryAfter !== null) {
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({ error: 'Bạn đã nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau.' }); return;
      }
      // 400, not 401: the session is still valid and the client must not log out.
      if (!verifyPassword(currentPassword, account.password)) {
        failures.record(key);
        res.status(400).json({ error: 'Mật khẩu hiện tại không đúng.', code: 'INVALID_CURRENT_PASSWORD' }); return;
      }
      failures.clear(key);
      if (!await users.changePassword(user.id, user.sid, account.password!, newPassword, clock())) {
        res.status(409).json({ error: 'Mật khẩu vừa được thay đổi ở nơi khác. Hãy tải lại trang và thử lại.', code: 'PASSWORD_CHANGED_ELSEWHERE' }); return;
      }
      res.json({ message: 'Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.' });
    });
  });

  router.get('/sessions', async (req, res) => {
    const user = caller(req);
    const rows = await sessions!.listActive(user.id, clock());
    res.json({ sessions: rows.map(row => ({ id: row.id, device: describeUserAgent(row.user_agent),
      createdAt: row.created_at.toISOString(), lastUsedAt: row.last_used_at.toISOString(), current: row.id === user.sid })) });
  });

  router.post('/sessions/revoke-others', async (req, res) => {
    const user = caller(req);
    res.json({ revoked: await sessions!.revokeOthers(user.id, user.sid, clock()) });
  });

  router.post('/sessions/:id/revoke', async (req, res) => {
    const user = caller(req), id = req.params.id;
    if (id === user.sid) { res.status(400).json({ error: 'Dùng "Đăng xuất" để thoát phiên đang dùng.', code: 'CURRENT_SESSION' }); return; }
    // Another user's session and an unknown ID look the same.
    if (!SESSION_ID.test(id) || !await sessions!.revokeOwn(id, user.id, clock())) {
      res.status(404).json({ error: 'Không tìm thấy phiên đăng nhập.' }); return;
    }
    res.json({ success: true });
  });
  return router;
}
