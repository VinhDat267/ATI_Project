import { Router } from 'express';
import type { AuthRoutesOptions } from './index.js';
import { duplicateSignupEmail, sendEmailInBackground, sendEmailSafely, verificationEmail } from '../../services/email/index.js';
import { emailResponse, normalizedEmail, notifyAdmins, rateLimit, requirePostgres, signupResponse, validPassword, validToken } from './public-helpers.js';

export function createSignupRoutes(options: AuthRoutesOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const signupLimit = rateLimit(10, clock), resendLimit = rateLimit(3, clock);
  router.post('/signup', async (req, res) => {
    if (!requirePostgres(options, res)) return;
    if (!options.signupEnabled) { res.status(403).json({ error: 'Đăng ký tài khoản hiện đang đóng.' }); return; }
    const email = normalizedEmail(req.body?.email), password = req.body?.password;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!email || !validPassword(password) || !name || name.length > 100) {
      res.status(400).json({ error: 'Nhập tên (tối đa 100 ký tự), email hợp lệ và mật khẩu từ 12 đến 128 ký tự.' }); return;
    }
    if (!signupLimit(req.ip ?? 'unknown', res)) return;
    const user = await options.userRepo!.createPendingUser({ email, password, name });
    if (user) {
      const token = await options.userRepo!.authTokens.issue(user.id, 'verify_email', clock());
      await sendEmailSafely(options.emailSender, verificationEmail(email, name, options.appBaseUrl ?? 'http://127.0.0.1:5174', token));
    } else await sendEmailSafely(options.emailSender, duplicateSignupEmail(email));
    res.json(signupResponse);
  });
  router.post('/verify-email', async (req, res) => {
    if (!requirePostgres(options, res)) return;
    const token = req.body?.token;
    const user = validToken(token) ? await options.userRepo!.authTokens.verifyEmail(token, clock()) : null;
    if (!user) { res.status(400).json({ error: 'Link xác minh không hợp lệ, đã dùng hoặc đã hết hạn.' }); return; }
    await notifyAdmins(options, user);
    res.json({ message: 'Email đã xác minh, chờ quản trị viên duyệt.' });
  });
  router.post('/resend-verification', async (req, res) => {
    if (!requirePostgres(options, res)) return;
    const email = normalizedEmail(req.body?.email);
    if (!email) { res.status(400).json({ error: 'Vui lòng nhập email hợp lệ.' }); return; }
    if (!resendLimit(email, res)) return;
    const user = await options.userRepo!.findByEmail(email);
    if (user && !user.email_verified && user.status === 'pending') {
      const token = await options.userRepo!.authTokens.issue(user.id, 'verify_email', clock());
      sendEmailInBackground(options.emailSender, verificationEmail(email, user.name, options.appBaseUrl ?? 'http://127.0.0.1:5174', token));
    }
    res.json(emailResponse);
  });
  return router;
}
