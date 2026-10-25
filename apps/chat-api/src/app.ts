import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createAuthRoutes } from './routes/auth/index.js';
import { createAccountRoutes } from './routes/auth/account.js';
import { LoginFailures } from './auth/login-failures.js';
import { createAdminUsersRoutes, type AdminUsersOptions } from './routes/auth/admin-users.js';
import { createConversationRoutes } from './routes/conversation-routes.js';
import { createStreamRoutes } from './routes/stream-routes.js';
import { createExecutionRoutes } from './routes/execution-routes.js';
import { createServicesRoutes } from './routes/services-routes.js';
import { createScheduleRoutes, isSchedulePath, type ScheduleRoutesOptions } from './routes/schedule-routes.js';
import { createAuthMiddleware } from './auth/jwt.js';
import type { ConversationRepo } from './db/repositories/conversation-repo.js';
import type { MessageRepo } from './db/repositories/message-repo.js';
import type { PlanRepo } from './db/repositories/plan-repo.js';
import type { UserRepo } from './db/repositories/user-repo.js';
import type { SessionRepo } from './db/repositories/session-repo.js';
import type { AuthUser } from './auth/jwt.js';
import type { CredentialRepo } from './db/repositories/credential-repo.js';
import type { ChatService } from './services/chat-service.js';
import type { SSEManager } from './sse/sse-manager.js';
import type { ExecutionService } from './services/execution-service.js';
import { userFacingError } from './services/user-facing-error.js';
import type { EmailSender } from './services/email/index.js';
import type { GoogleOAuthConfig } from './auth/google-oidc.js';
import type { GmailOAuthConfig } from './config/env.js';
import type { GmailConnectionRepo } from './db/repositories/gmail-connection-repo.js';
import { createGmailConnectionRoutes, isGmailAvailable } from './routes/connections/gmail.js';

/** Gmail as each member's own connection (GMAIL_ENABLED). Absent or disabled: the routes do not exist. */
export interface GmailAppOptions {
  enabled: boolean;
  oauth?: GmailOAuthConfig;
  repo?: GmailConnectionRepo;
  fetchFn?: typeof fetch;
  googleTimeoutMs?: number;
  revokeTimeoutMs?: number;
  onConnectionChanged?: (userId: string) => void;
}

export interface AppOptions extends AdminUsersOptions {
  jwtSecret: string;
  runtimeMode?: 'sandbox' | 'live';
  userRepo?: UserRepo;
  sessionRepo?: SessionRepo;
  authClock?: () => number;
  signupEnabled?: boolean;
  appBaseUrl?: string;
  emailSender?: EmailSender;
  googleOAuth?: GoogleOAuthConfig;
  googleFetchFn?: typeof fetch;
  googleSignupEnabled?: boolean;
  validateCredentials?: (email: string, password: string) => Promise<AuthUser | null> | AuthUser | null;
  convRepo?: ConversationRepo;
  msgRepo?: MessageRepo;
  planRepo?: PlanRepo;
  credentialRepo?: CredentialRepo;
  encryptionKey?: string;
  serviceFetchFn?: typeof fetch;
  onCredentialsChanged?: (service: string) => void;
  serviceAdminUserIds?: string[];
  chatService?: ChatService;
  sseManager?: SSEManager;
  executionService?: ExecutionService;
  gmail?: GmailAppOptions;
  /** Scheduled workflows; present only when SCHEDULES_ENABLED is on and PostgreSQL is available. */
  schedules?: ScheduleRoutesOptions;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  const sessionRepo = options.sessionRepo ?? options.userRepo?.sessions;
  const gmailRoutes = options.gmail?.enabled ? {
    jwtSecret: options.jwtSecret, sessionRepo, states: options.userRepo?.googleAuth, credentialRepo: options.credentialRepo,
    repo: options.gmail.repo, oauth: options.gmail.oauth, encryptionKey: options.encryptionKey, fetchFn: options.gmail.fetchFn,
    clock: options.authClock, googleTimeoutMs: options.gmail.googleTimeoutMs, revokeTimeoutMs: options.gmail.revokeTimeoutMs,
    onConnectionChanged: options.gmail.onConnectionChanged,
  } : undefined;

  app.use(express.json());
  app.use((_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body: any) => {
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        if (typeof body.error === 'string') body = { ...body, error: userFacingError(body.error) };
        if (typeof body.message === 'string' && (res.statusCode >= 400 || /^(Successfully connected|Provider rejected)/.test(body.message))) body = { ...body, message: userFacingError(body.message) };
      }
      return json(body);
    };
    next();
  });

  // CORS middleware
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/auth/google/') || (gmailRoutes && req.path.startsWith('/api/connections/gmail'))) {
      const origins = [options.appBaseUrl, options.googleOAuth?.redirectUri, options.gmail?.oauth?.redirectUri].filter(Boolean).map(url => new URL(url!).origin);
      const origin = req.get('Origin');
      res.vary('Origin');
      if (origin && origins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    } else res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Last-Event-ID');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    // With GMAIL_ENABLED off the public health answer stays exactly as before; absent means false.
    res.status(200).json({ status: 'ok', version: 'v3', runtimeMode: options.runtimeMode ?? 'sandbox',
      ...(gmailRoutes ? { gmailEnabled: isGmailAvailable(gmailRoutes) } : {}),
      ...(options.schedules ? { schedulesEnabled: true } : {}) });
  });

  // Auth routes (public login/refresh, protected /me)
  const loginFailures = new LoginFailures(options.authClock);
  app.use(
    '/api/auth',
    createAuthRoutes({ jwtSecret: options.jwtSecret, userRepo: options.userRepo, sessionRepo: options.sessionRepo,
      clock: options.authClock, validateCredentials: options.validateCredentials,
      signupEnabled: options.signupEnabled, appBaseUrl: options.appBaseUrl, emailSender: options.emailSender,
      runtimeMode: options.runtimeMode, googleOAuth: options.googleOAuth, googleFetchFn: options.googleFetchFn,
      googleSignupEnabled: options.googleSignupEnabled, loginFailures })
  );
  app.use('/api/account', createAccountRoutes({ jwtSecret: options.jwtSecret, userRepo: options.userRepo,
    sessionRepo: options.sessionRepo, clock: options.authClock, loginFailures }));

  const authMiddleware = createAuthMiddleware(options.jwtSecret, { sessionRepo: options.sessionRepo ?? options.userRepo?.sessions, clock: options.authClock });

  // Memory storage cannot manage persistent accounts, even with a legacy JWT.
  app.use('/api/admin/users', (req, res, next) => {
    if (!options.adminUserRepo) { res.status(503).json({ error: 'Quản trị người dùng cần PostgreSQL.' }); return; }
    authMiddleware(req, res, next);
  }, createAdminUsersRoutes(options));

  // Services routes (protected via Bearer header)
  app.use(
    '/api/services',
    authMiddleware,
    createServicesRoutes({ credentialRepo: options.credentialRepo, encryptionKey: options.encryptionKey, fetchFn: options.serviceFetchFn, onCredentialsChanged: options.onCredentialsChanged, adminUserIds: options.serviceAdminUserIds,
      gmailAvailable: Boolean(gmailRoutes && isGmailAvailable(gmailRoutes)) })
  );

  if (gmailRoutes) app.use('/api/connections/gmail', createGmailConnectionRoutes(gmailRoutes));

  // Only schedule paths pass through this auth check, so other /api requests are not checked twice.
  if (options.schedules) app.use('/api', (req, res, next) => isSchedulePath(req.path) ? authMiddleware(req, res, next) : next(),
    createScheduleRoutes(options.schedules));

  // Stream routes require the Authorization header and a conversation owner check.
  if (options.sseManager) {
    app.use(
      '/api/conversations',
      authMiddleware,
      createStreamRoutes({ sseManager: options.sseManager, convRepo: options.convRepo })
    );
  }

  // Conversation routes (protected via Bearer header)
  if (options.convRepo && options.msgRepo && options.chatService) {
    app.use(
      '/api/conversations',
      authMiddleware,
      createConversationRoutes({
        convRepo: options.convRepo,
        msgRepo: options.msgRepo,
        chatService: options.chatService,
        planRepo: options.planRepo,
      })
    );
  }

  // Execution routes (protected via Bearer header)
  if (options.executionService) {
    app.use(
      '/api',
      authMiddleware,
      createExecutionRoutes({ executionService: options.executionService })
    );
  }

  // Global error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    const message = err?.message || 'Internal server error';
    res.status(status).json({ error: message });
  });

  return app;
}
