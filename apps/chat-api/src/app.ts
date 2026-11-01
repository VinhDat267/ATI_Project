import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type pg from 'pg';
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
import { createWorkspaceContextMiddleware } from './middleware/workspace-context.js';
import { createWorkspacesRouter } from './routes/workspaces-routes.js';
import { createWorkspaceRoutes } from './routes/workspace-routes.js';
import type { WorkspaceRateLimitConfig } from './routes/workspace-rate-limiter.js';
import type { WorkspaceRepo } from './db/repositories/workspace-repo.js';
import type { JiraWorkspaceRepo } from './db/repositories/index.js';
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
import type { GmailOAuthConfig, GitHubOAuthConfig, TrelloOAuthConfig } from './config/env.js';
import type { GmailConnectionRepo } from './db/repositories/gmail-connection-repo.js';
import { TrelloTeamRepo } from './db/repositories/trello-team-repo.js';
import { GitHubTeamRepo } from './db/repositories/github-team-repo.js';
import { createGmailConnectionRoutes, isGmailAvailable } from './routes/connections/gmail.js';
import { createMyCalendarConnectionRoutes, isMyCalendarAvailable } from './routes/connections/mycalendar.js';
import { createMySheetsConnectionRoutes, isMySheetsAvailable } from './routes/connections/mysheets.js';
import { createTrelloConnectionRoutes, isTrelloConnectAvailable, type TrelloConnectionsOptions } from './routes/connections/trello.js';
import { createGitHubConnectionRoutes, type GitHubConnectionsOptions } from './routes/connections/github.js';
import type { GlobalRateLimiter } from '@wap/tool-adapters';
import type { GoogleAuthRepo } from './db/repositories/google-auth-repo.js';
import type { GmailTokenManager } from './services/gmail/token-manager.js';
import type { TrelloTokenManager } from './services/trello/token-manager.js';
import type { GitHubTokenManager } from './services/github/token-manager.js';

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

/** MyCalendar as each member's own connection (MYCALENDAR_ENABLED). Absent or disabled: the routes do not exist. */
export interface MyCalendarAppOptions {
  enabled: boolean;
  oauth?: GmailOAuthConfig;
  repo?: GmailConnectionRepo;
  fetchFn?: typeof fetch;
  googleTimeoutMs?: number;
  revokeTimeoutMs?: number;
  onConnectionChanged?: (userId: string) => void;
}

/** MySheets as each member's own connection (MYSHEETS_ENABLED). Absent or disabled: the routes do not exist. */
export interface MySheetsAppOptions {
  enabled: boolean;
  oauth?: GmailOAuthConfig;
  repo?: GmailConnectionRepo;
  fetchFn?: typeof fetch;
  googleTimeoutMs?: number;
  revokeTimeoutMs?: number;
  onConnectionChanged?: (userId: string) => void;
  picker?: { apiKey: string; appId: string };
  fakePickerBaseUrl?: string;
  driveApiBaseUrl?: string;
  pickerLimiter?: GlobalRateLimiter;
}

/** Trello as each member's own OAuth connection and team workspace boards. */
export interface TrelloAppOptions {
  oauth?: TrelloOAuthConfig;
  fetchFn?: typeof fetch;
  trelloTimeoutMs?: number;
  onConnectionChanged?: (userId: string) => void;
  tokens?: Pick<TrelloTokenManager, 'forConnection'>;
  teamRepo?: TrelloTeamRepo;
}

/** GitHub as each member's own OAuth connection and team repositories. */
export interface GitHubAppOptions {
  oauth?: GitHubOAuthConfig;
  fetchFn?: typeof fetch;
  githubTimeoutMs?: number;
  onConnectionChanged?: (userId: string) => void;
  tokens?: Pick<GitHubTokenManager, 'forConnection'>;
  teamRepo?: GitHubTeamRepo;
}

export interface AppOptions extends AdminUsersOptions {
  jwtSecret: string;
  runtimeMode?: 'sandbox' | 'live';
  userRepo?: UserRepo;
  sessionRepo?: SessionRepo;
  states?: GoogleAuthRepo;
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
  onCredentialsChanged?: (service: string, workspaceId?: string | null, userId?: string) => void;
  serviceAdminUserIds?: string[];
  chatService?: ChatService;
  sseManager?: SSEManager;
  executionService?: ExecutionService;
  gmail?: GmailAppOptions;
  mycalendar?: MyCalendarAppOptions;
  mycalendarTokens?: Pick<GmailTokenManager, 'forConnection'>;
  mysheets?: MySheetsAppOptions;
  mysheetsTokens?: Pick<GmailTokenManager, 'forConnection'>;
  trello?: TrelloAppOptions;
  trelloTokens?: Pick<TrelloTokenManager, 'forConnection'>;
  trelloTeamRepo?: TrelloTeamRepo;
  workspaceRepo?: WorkspaceRepo;
  jiraWorkspaceRepo?: JiraWorkspaceRepo;
  jiraWorkspaceRateLimit?: WorkspaceRateLimitConfig;
  workspaceRateLimit?: WorkspaceRateLimitConfig;
  pool?: pg.Pool;
  enableWorkspaceConversations?: boolean;
  github?: GitHubAppOptions;
  githubTokens?: Pick<GitHubTokenManager, 'forConnection'>;
  githubTeamRepo?: GitHubTeamRepo;
  /** Scheduled workflows; present only when SCHEDULES_ENABLED is on and PostgreSQL is available. */
  schedules?: ScheduleRoutesOptions;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  const sessionRepo = options.sessionRepo ?? options.userRepo?.sessions;
  const states = options.states ?? options.userRepo?.googleAuth;
  const gmailRoutes = options.gmail?.enabled ? {
    jwtSecret: options.jwtSecret, sessionRepo, states, credentialRepo: options.credentialRepo,
    repo: options.gmail.repo, oauth: options.gmail.oauth, encryptionKey: options.encryptionKey, fetchFn: options.gmail.fetchFn,
    clock: options.authClock, googleTimeoutMs: options.gmail.googleTimeoutMs, revokeTimeoutMs: options.gmail.revokeTimeoutMs,
    onConnectionChanged: options.gmail.onConnectionChanged,
    conversationOwner: options.convRepo ? async (id: string) => (await options.convRepo!.getConversation(id))?.user_id ?? null : undefined,
  } : undefined;
  const mycalendarRoutes = options.mycalendar?.enabled ? {
    jwtSecret: options.jwtSecret, sessionRepo, states, credentialRepo: options.credentialRepo,
    repo: options.mycalendar.repo, oauth: options.mycalendar.oauth, encryptionKey: options.encryptionKey, fetchFn: options.mycalendar.fetchFn,
    clock: options.authClock, googleTimeoutMs: options.mycalendar.googleTimeoutMs, revokeTimeoutMs: options.mycalendar.revokeTimeoutMs,
    onConnectionChanged: options.mycalendar.onConnectionChanged,
    conversationOwner: options.convRepo ? async (id: string) => (await options.convRepo!.getConversation(id))?.user_id ?? null : undefined,
    tokens: options.mycalendarTokens,
  } : undefined;
  const mysheetsRoutes = options.mysheets?.enabled ? {
    jwtSecret: options.jwtSecret, sessionRepo, states, credentialRepo: options.credentialRepo,
    repo: options.mysheets.repo, oauth: options.mysheets.oauth, encryptionKey: options.encryptionKey, fetchFn: options.mysheets.fetchFn,
    clock: options.authClock, googleTimeoutMs: options.mysheets.googleTimeoutMs, revokeTimeoutMs: options.mysheets.revokeTimeoutMs,
    onConnectionChanged: options.mysheets.onConnectionChanged,
    conversationOwner: options.convRepo ? async (id: string) => (await options.convRepo!.getConversation(id))?.user_id ?? null : undefined,
    tokens: options.mysheetsTokens,
    picker: options.mysheets.picker,
    fakePickerBaseUrl: options.mysheets.fakePickerBaseUrl,
    driveApiBaseUrl: options.mysheets.driveApiBaseUrl,
    pickerLimiter: options.mysheets.pickerLimiter,
  } : undefined;
  const trelloTeamRepo = options.trelloTeamRepo ?? options.trello?.teamRepo ?? (options.credentialRepo ? new TrelloTeamRepo((options.credentialRepo as any).pool) : undefined);
  const trelloTokens = options.trelloTokens ?? options.trello?.tokens;
  const trelloRoutes: TrelloConnectionsOptions = {
    jwtSecret: options.jwtSecret, sessionRepo, states, credentialRepo: options.credentialRepo,
    teamRepo: trelloTeamRepo, oauth: options.trello?.oauth, encryptionKey: options.encryptionKey, fetchFn: options.trello?.fetchFn,
    clock: options.authClock, trelloTimeoutMs: options.trello?.trelloTimeoutMs,
    onConnectionChanged: options.trello?.onConnectionChanged,
    conversationOwner: options.convRepo ? async (id: string) => (await options.convRepo!.getConversation(id))?.user_id ?? null : undefined,
    tokens: trelloTokens, adminUserIds: options.serviceAdminUserIds,
    workspaceRepo: options.workspaceRepo,
  };
  const githubTeamRepo = options.githubTeamRepo ?? options.github?.teamRepo ?? (options.credentialRepo ? new GitHubTeamRepo((options.credentialRepo as any).pool) : undefined);
  const githubTokens = options.githubTokens ?? options.github?.tokens;
  const githubRoutes: GitHubConnectionsOptions = {
    jwtSecret: options.jwtSecret, sessionRepo, states, credentialRepo: options.credentialRepo,
    teamRepo: githubTeamRepo, oauth: options.github?.oauth, encryptionKey: options.encryptionKey, fetchFn: options.github?.fetchFn,
    clock: options.authClock, githubTimeoutMs: options.github?.githubTimeoutMs,
    onConnectionChanged: options.github?.onConnectionChanged,
    conversationOwner: options.convRepo ? async (id: string) => (await options.convRepo!.getConversation(id))?.user_id ?? null : undefined,
    tokens: githubTokens, adminUserIds: options.serviceAdminUserIds,
  };

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
    if (req.path.startsWith('/api/auth/google/') || (gmailRoutes && req.path.startsWith('/api/connections/gmail')) || (mycalendarRoutes && req.path.startsWith('/api/connections/mycalendar')) || (mysheetsRoutes && req.path.startsWith('/api/connections/mysheets')) || req.path.startsWith('/api/connections/trello') || req.path.startsWith('/api/connections/github')) {
      const origins = [options.appBaseUrl, options.googleOAuth?.redirectUri, options.gmail?.oauth?.redirectUri, options.mycalendar?.oauth?.redirectUri, options.mysheets?.oauth?.redirectUri, options.trello?.oauth?.redirectUri, options.github?.oauth?.redirectUri].filter(Boolean).map(url => new URL(url!).origin);
      const origin = req.get('Origin');
      res.vary('Origin');
      if (origin && origins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    } else res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Last-Event-ID, X-Workspace-Id');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    // With GMAIL_ENABLED / MYCALENDAR_ENABLED / MYSHEETS_ENABLED off the public health answer stays exactly as before; absent means false.
    res.status(200).json({ status: 'ok', version: 'v3', runtimeMode: options.runtimeMode ?? 'sandbox',
      ...(gmailRoutes ? { gmailEnabled: isGmailAvailable(gmailRoutes) } : {}),
      ...(mycalendarRoutes ? { mycalendarEnabled: isMyCalendarAvailable(mycalendarRoutes) } : {}),
      ...(mysheetsRoutes ? { mysheetsEnabled: isMySheetsAvailable(mysheetsRoutes) } : {}),
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
  const workspaceContextMiddleware = createWorkspaceContextMiddleware(options.workspaceRepo);
  const withAuthAndWorkspace = (req: Request, res: Response, next: NextFunction) => {
    authMiddleware(req, res, (err?: any) => {
      if (err) return next(err);
      workspaceContextMiddleware(req, res, next);
    });
  };

  // Memory storage cannot manage persistent accounts, even with a legacy JWT.
  app.use('/api/admin/users', (req, res, next) => {
    if (!options.adminUserRepo) { res.status(503).json({ error: 'Quản trị người dùng cần PostgreSQL.' }); return; }
    withAuthAndWorkspace(req, res, next);
  }, createAdminUsersRoutes(options));

  const dbPool = options.pool ?? options.convRepo?.getPool?.();

  if (options.workspaceRepo) {
    app.use('/api/workspaces', authMiddleware, createWorkspacesRouter({
      workspaceRepo: options.workspaceRepo,
      emailSender: options.emailSender,
    }));
  }

  if (options.jiraWorkspaceRepo) {
    const { adminRouter, workspaceRouter, joinRouter } = createWorkspaceRoutes({
      workspaceRepo: options.jiraWorkspaceRepo,
      rateLimit: options.jiraWorkspaceRateLimit ?? options.workspaceRateLimit,
    });
    app.use('/api/admin/jira-workspaces', authMiddleware, adminRouter);
    app.use('/api/jira-workspaces', authMiddleware, workspaceRouter);
    app.use('/api/jira-workspace-join-requests', authMiddleware, joinRouter);
  } else {
    const unavailableHandler = (_req: Request, res: Response) => {
      res.status(503).json({ error: 'Jira workspace service is unavailable' });
    };
    app.use('/api/admin/jira-workspaces', authMiddleware, unavailableHandler);
    app.use('/api/jira-workspaces', authMiddleware, unavailableHandler);
    app.use('/api/jira-workspace-join-requests', authMiddleware, unavailableHandler);
  }

  // Services routes (protected via Bearer header)
  app.use(
    '/api/services',
    withAuthAndWorkspace,
    createServicesRoutes({ credentialRepo: options.credentialRepo, encryptionKey: options.encryptionKey, fetchFn: options.serviceFetchFn, onCredentialsChanged: options.onCredentialsChanged, adminUserIds: options.serviceAdminUserIds,
      gmailAvailable: Boolean(gmailRoutes && isGmailAvailable(gmailRoutes)),
      mycalendarAvailable: Boolean(mycalendarRoutes && isMyCalendarAvailable(mycalendarRoutes)),
      mysheetsAvailable: Boolean(mysheetsRoutes && isMySheetsAvailable(mysheetsRoutes)) })
  );

  if (gmailRoutes) app.use('/api/connections/gmail', createGmailConnectionRoutes(gmailRoutes));
  if (mycalendarRoutes) app.use('/api/connections/mycalendar', createMyCalendarConnectionRoutes(mycalendarRoutes));
  if (mysheetsRoutes) app.use('/api/connections/mysheets', createMySheetsConnectionRoutes(mysheetsRoutes));
  app.use('/api/connections/trello', createTrelloConnectionRoutes(trelloRoutes));
  app.use('/api/connections/github', createGitHubConnectionRoutes(githubRoutes));

  // Only schedule paths pass through this auth check, so other /api requests are not checked twice.
  if (options.schedules) {
    app.use(
      '/api',
      (req, res, next) => (isSchedulePath(req.path) ? withAuthAndWorkspace(req, res, next) : next()),
      createScheduleRoutes({
        ...options.schedules,
        pool: dbPool,
        convRepo: options.convRepo,
      })
    );
  }

  // Stream routes require the Authorization header and a conversation owner check.
  if (options.sseManager) {
    app.use(
      '/api/conversations',
      withAuthAndWorkspace,
      createStreamRoutes({
        sseManager: options.sseManager,
        convRepo: options.convRepo,
        workspaceRepo: options.workspaceRepo,
        pool: dbPool,
      })
    );
  }

  // Conversation routes (protected via Bearer header)
  if (options.convRepo && options.msgRepo && options.chatService) {
    app.use(
      '/api/conversations',
      withAuthAndWorkspace,
      createConversationRoutes({
        convRepo: options.convRepo,
        msgRepo: options.msgRepo,
        chatService: options.chatService,
        planRepo: options.planRepo,
        pool: dbPool,
        enableWorkspaceConversations: options.enableWorkspaceConversations,
      })
    );
  }

  // Execution routes (protected via Bearer header)
  if (options.executionService) {
    app.use(
      '/api',
      withAuthAndWorkspace,
      createExecutionRoutes({
        executionService: options.executionService,
        pool: dbPool,
        convRepo: options.convRepo,
        planRepo: options.planRepo,
      })
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
