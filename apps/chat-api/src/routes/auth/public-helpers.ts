import type { Response } from 'express';
import type { AuthRoutesOptions } from './index.js';
import { pendingApprovalEmail, sendEmailSafely } from '../../services/email/index.js';
import type { UserRow } from '../../db/repositories/user-repo.js';

export const emailResponse = { message: 'Nếu email có trong hệ thống, bạn sẽ nhận được link.' };
export const signupResponse = { message: 'Kiểm tra email để xác minh tài khoản.' };
export function normalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
export const validPassword = (value: unknown): value is string => typeof value === 'string' && value.length >= 12 && value.length <= 128;
export const validToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export function requirePostgres(options: AuthRoutesOptions, res: Response): boolean {
  if (options.userRepo && options.emailSender) return true;
  res.status(503).json({ error: 'Tính năng này cần PostgreSQL và dịch vụ email.' }); return false;
}
export function rateLimit(limit: number, clock: () => number) {
  const buckets = new Map<string, { count: number; expiresAt: number }>();
  return (key: string, res: Response): boolean => {
    const now = clock();
    for (const [key, bucket] of buckets) if (bucket.expiresAt <= now) buckets.delete(key);
    const bucket = buckets.get(key) ?? { count: 0, expiresAt: now + 60 * 60 * 1000 };
    if (bucket.count >= limit) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.expiresAt - now) / 1000)));
      res.status(429).json({ error: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.' }); return false;
    }
    bucket.count++; buckets.set(key, bucket); return true;
  };
}
export async function notifyAdmins(options: AuthRoutesOptions, user: UserRow): Promise<void> {
  if (user.status !== 'pending') return;
  const admins = await options.userRepo!.listActiveAdmins();
  await Promise.all(admins.map(admin => sendEmailSafely(options.emailSender, pendingApprovalEmail(admin.email, user.name, user.email))));
}
