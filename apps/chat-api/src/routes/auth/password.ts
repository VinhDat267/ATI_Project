import { Router } from 'express';
import type { AuthRoutesOptions } from './index.js';
import { hashPassword } from '../../db/repositories/user-repo.js';
import { resetPasswordEmail, sendEmailInBackground } from '../../services/email/index.js';
import { emailResponse, normalizedEmail, rateLimit, requirePostgres, validPassword, validToken } from './public-helpers.js';

export function createPasswordRoutes(options: AuthRoutesOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const forgotLimit = rateLimit(3, clock);
  router.post('/forgot-password', async (req, res) => {
    if (!requirePostgres(options, res)) return;
    const email = normalizedEmail(req.body?.email);
    if (!email) { res.status(400).json({ error: 'Vui lòng nhập email hợp lệ.' }); return; }
    if (!forgotLimit(email, res)) return;
    const user = await options.userRepo!.findByEmail(email);
    if (user) {
      const token = await options.userRepo!.authTokens.issue(user.id, 'reset_password', clock());
      sendEmailInBackground(options.emailSender, resetPasswordEmail(email, user.name, options.appBaseUrl ?? 'http://127.0.0.1:5174', token));
    }
    res.json(emailResponse);
  });
  router.post('/reset-password', async (req, res) => {
    if (!requirePostgres(options, res)) return;
    const token = req.body?.token, password = req.body?.password;
    if (!validPassword(password)) { res.status(400).json({ error: 'Mật khẩu phải có từ 12 đến 128 ký tự.' }); return; }
    const user = validToken(token) ? await options.userRepo!.authTokens.resetPassword(token, hashPassword(password), clock()) : null;
    if (!user) { res.status(400).json({ error: 'Link đặt lại mật khẩu không hợp lệ, đã dùng hoặc đã hết hạn.' }); return; }
    res.json({ message: 'Đã đặt lại mật khẩu. Vui lòng đăng nhập lại.' });
  });
  return router;
}
