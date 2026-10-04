import { describe, expect, it, vi } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

const live = { RUNTIME_MODE: 'live', DATABASE_URL: 'postgresql://fixture@localhost/fixture',
  JWT_SECRET: 'auth02_live_validation_fixture_32_chars', ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef', GEMINI_API_KEY: 'fixture',
  SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'mail@example.test', SMTP_PASSWORD: 'local-fixture',
  MAIL_FROM: 'ATI <mail@example.test>', APP_BASE_URL: 'https://workflow.example.test' };

describe('AUTH-02 email startup configuration', () => {
  it('fails closed in live for every missing SMTP setting and web origin', () => {
    for (const field of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM', 'APP_BASE_URL']) {
      expect(() => validateEnv({ ...live, [field]: '' })).toThrow(new RegExp(field));
    }
  });
  it('rejects unsafe or non-origin web URLs, mail header injection and invalid flags/SMTP ports', () => {
    for (const url of ['javascript:alert(1)', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test?token=x', 'http://remote.example.test']) {
      expect(() => validateEnv({ ...live, APP_BASE_URL: url })).toThrow(/APP_BASE_URL/);
    }
    expect(() => validateEnv({ ...live, MAIL_FROM: 'mail@example.test\r\nBcc:attacker@example.test' })).toThrow(/MAIL_FROM/);
    expect(() => validateEnv({ ...live, SMTP_PORT: 'no' })).toThrow(/SMTP_PORT/);
    expect(() => validateEnv({ AUTH_SIGNUP_ENABLED: 'invalid' })).toThrow(/AUTH_SIGNUP_ENABLED/);
  });
  it('keeps signup default closed, supports explicit flags and permits sandbox without SMTP', () => {
    expect(validateEnv({}) as any).toMatchObject({ AUTH_SIGNUP_ENABLED: false, APP_BASE_URL: 'http://127.0.0.1:5174' });
    expect((validateEnv({ AUTH_SIGNUP_ENABLED: 'true' }) as any).AUTH_SIGNUP_ENABLED).toBe(true);
    expect((validateEnv({ AUTH_SIGNUP_ENABLED: 'false' }) as any).AUTH_SIGNUP_ENABLED).toBe(false);
    expect(validateEnv(live)).toMatchObject({ SMTP_PORT: 465, APP_BASE_URL: 'https://workflow.example.test' });
  });
});

describe('AUTH-02 email delivery boundary', () => {
  it('builds Gmail TLS transport and sends the from address without real network', async () => {
    const path = '../../src/services/email/index.js';
    const module: any = await import(path).catch(() => ({}));
    expect(module.SmtpEmailSender).toBeTypeOf('function');
    const deliveries: unknown[] = [];
    const transport = vi.fn((options: unknown) => ({ sendMail: async (message: unknown) => { deliveries.push({ options, message }); } }));
    const sender = new module.SmtpEmailSender(validateEnv(live), transport);
    await sender.send({ to: 'recipient@example.test', subject: 'Test', text: 'text', html: '<p>text</p>' });
    expect(deliveries).toEqual([{ options: expect.objectContaining({ host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: 'mail@example.test', pass: 'local-fixture' }, tls: { rejectUnauthorized: true } }),
      message: { from: 'ATI <mail@example.test>', to: 'recipient@example.test', subject: 'Test', text: 'text', html: '<p>text</p>' } }]);
  });

  it('uses outbox in sandbox and CI even when SMTP configuration is present', async () => {
    const path = '../../src/services/email/index.js';
    const module: any = await import(path).catch(() => ({}));
    expect(module.createEmailSender).toBeTypeOf('function');
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    expect(module.createEmailSender(validateEnv({ ...live, RUNTIME_MODE: 'sandbox' }), pool, {})).toBeInstanceOf(module.OutboxEmailSender);
    expect(module.createEmailSender(validateEnv(live), pool, { CI: 'true' })).toBeInstanceOf(module.OutboxEmailSender);
    expect(module.createEmailSender(validateEnv(live), pool, { GITHUB_ACTIONS: 'true' })).toBeInstanceOf(module.OutboxEmailSender);
  });

  it('escapes untrusted user names and builds verification/reset links only in the configured origin', async () => {
    const path = '../../src/services/email/index.js';
    const module: any = await import(path).catch(() => ({}));
    expect(module.verificationEmail).toBeTypeOf('function');
    const message = module.verificationEmail('mail@example.test', '<img src=x onerror=alert(1)>', 'https://workflow.example.test', 'a+b/&?');
    const link = new URL(message.text.match(/https[^\s]+/)[0]);
    expect(link.origin).toBe('https://workflow.example.test'); expect(link.searchParams.get('token')).toBe('a+b/&?');
    expect(message.html).not.toContain('<img'); expect(message.html).toContain('&lt;img');
    expect(message.html).toContain('<a href="https://workflow.example.test/');
    expect(module.resetPasswordEmail('mail@example.test', 'Test', 'https://workflow.example.test', 'token').text).toContain('view=reset-password');
    const approved = module.approvalEmail('mail@example.test', '<script>');
    expect(approved.text).toContain('duyệt'); expect(approved.html).not.toContain('<script>');
  });
});
