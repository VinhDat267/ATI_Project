import express from 'express';
import type pg from 'pg';
import { createApp } from './app.js';
import { ConversationRepo, MessageRepo, PlanRepo, UserRepo, CredentialRepo } from './db/repositories/index.js';
import { SSEManager } from './sse/sse-manager.js';
import type { CloudWorkspaceConfig } from './config/cloud-workspace.js';

/** Reuses the production account/session and owner-scoped workspace APIs, without fake AI. */
export function createCloudWorkspaceApp(pool: pg.Pool, config: CloudWorkspaceConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({
    status: 'ok', version: 'v3', deployment: 'accounts-workspace',
    capabilities: { accounts: true, conversations: true, planning: false, execution: false, signup: false },
  }));
  app.get('/api/ready', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }
    catch { res.status(503).json({ status: 'unavailable', database: 'unavailable' }); }
  });
  // No SMTP is configured in this release. Block every email flow before token issuance.
  for (const path of ['signup', 'resend-verification', 'verify-email']) {
    app.post(`/api/auth/${path}`, (_req, res) => res.status(503).json({
      code: 'ACCOUNT_EMAIL_NOT_CONFIGURED',
      error: 'Đăng ký và xác minh email chưa được mở. Hãy liên hệ quản trị viên để cấp tài khoản.',
    }));
  }
  app.use(createApp({
    jwtSecret: config.jwtSecret,
    encryptionKey: config.encryptionKey,
    appBaseUrl: config.appBaseUrl,
    signupEnabled: false,
    userRepo: new UserRepo(pool),
    convRepo: new ConversationRepo(pool),
    msgRepo: new MessageRepo(pool),
    planRepo: new PlanRepo(pool),
    credentialRepo: new CredentialRepo(pool),
    sseManager: new SSEManager(),
    allowedOrigins: [new URL(config.appBaseUrl).origin],
    trustProxy: 1,
  }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint unavailable in this deployment.' }));
  return app;
}
