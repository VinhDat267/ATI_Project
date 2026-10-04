import type pg from 'pg';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type { EnvConfig } from '../../config/env.js';

export interface EmailMessage { to: string; subject: string; text: string; html: string }
export interface EmailSender { send(message: EmailMessage): Promise<void> }
type TransportFactory = (options: SMTPTransport.Options) => { sendMail(message: EmailMessage & { from: string }): Promise<unknown> };

export class SmtpEmailSender implements EmailSender {
  private transport: ReturnType<TransportFactory>;
  constructor(private config: EnvConfig, factory: TransportFactory = options => nodemailer.createTransport(options)) {
    this.transport = factory({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_PORT === 465,
      requireTLS: config.SMTP_PORT !== 465, auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
      tls: { rejectUnauthorized: true }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000 });
  }
  async send(message: EmailMessage): Promise<void> { await this.transport.sendMail({ from: this.config.MAIL_FROM, ...message }); }
}

export class OutboxEmailSender implements EmailSender {
  constructor(private pool: pg.Pool) {}
  async send(message: EmailMessage): Promise<void> {
    await this.pool.query('INSERT INTO email_outbox(to_address,subject,body_text,body_html) VALUES($1,$2,$3,$4)', [message.to, message.subject, message.text, message.html]);
  }
}

export function createEmailSender(config: EnvConfig, pool: pg.Pool, env: Record<string, string | undefined> = process.env): EmailSender {
  return config.RUNTIME_MODE === 'sandbox' || env.CI === 'true' || env.GITHUB_ACTIONS === 'true' || env.NODE_ENV === 'test'
    ? new OutboxEmailSender(pool) : new SmtpEmailSender(config);
}

export async function sendEmailSafely(sender: EmailSender | undefined, message: EmailMessage, logger: Pick<Console, 'warn'> = console): Promise<void> {
  try { if (sender) await sender.send(message); }
  catch { logger.warn('[auth-email] Không gửi được email.'); }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
function email(to: string, subject: string, text: string): EmailMessage {
  return { to, subject, text, html: `<div lang="vi">${text.split('\n').map(line => `<p>${/^https?:\/\//.test(line) ? `<a href="${escapeHtml(line)}">${escapeHtml(line)}</a>` : escapeHtml(line)}</p>`).join('')}</div>` };
}
function tokenLink(baseUrl: string, view: string, token: string): string {
  const url = new URL('/', baseUrl); url.searchParams.set('view', view); url.searchParams.set('token', token); return url.href;
}
export function verificationEmail(to: string, name: string, baseUrl: string, token: string): EmailMessage {
  return email(to, 'Xác minh email tài khoản ATI', `Chào ${name},\nBấm link để xác minh email. Link có hiệu lực 24 giờ và chỉ dùng được một lần.\n${tokenLink(baseUrl, 'verify-email', token)}\nSau khi xác minh, tài khoản cần quản trị viên duyệt. Nếu bạn không yêu cầu, hãy bỏ qua thư này.`);
}
export function resetPasswordEmail(to: string, name: string, baseUrl: string, token: string): EmailMessage {
  return email(to, 'Đặt lại mật khẩu ATI', `Chào ${name},\nBấm link để đặt lại mật khẩu. Link có hiệu lực 30 phút và chỉ dùng được một lần.\n${tokenLink(baseUrl, 'reset-password', token)}\nNếu bạn không yêu cầu, hãy bỏ qua thư này.`);
}
export function duplicateSignupEmail(to: string): EmailMessage {
  return email(to, 'Có người thử đăng ký bằng email của bạn', 'Có người vừa thử đăng ký tài khoản ATI bằng email của bạn. Tài khoản và mật khẩu hiện tại không thay đổi. Nếu đó là bạn, hãy đăng nhập hoặc dùng chức năng quên mật khẩu.');
}
export function pendingApprovalEmail(to: string, name: string, userEmail: string): EmailMessage {
  return email(to, 'Có tài khoản mới chờ duyệt', `Tài khoản ${name} (${userEmail}) đã xác minh email và đang chờ duyệt. Hãy mở trang quản trị tài khoản để xem xét.`);
}
export function approvalEmail(to: string, name: string): EmailMessage {
  return email(to, 'Tài khoản ATI đã được duyệt', `Chào ${name},\nTài khoản của bạn đã được quản trị viên duyệt. Bạn có thể đăng nhập và sử dụng ATI.`);
}
