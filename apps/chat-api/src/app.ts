import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createAuthRoutes } from './routes/auth/index.js';
import { createConversationRoutes } from './routes/conversation-routes.js';
import { createStreamRoutes } from './routes/stream-routes.js';
import { createExecutionRoutes } from './routes/execution-routes.js';
import { createServicesRoutes } from './routes/services-routes.js';
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

export interface AppOptions {
  jwtSecret: string;
  runtimeMode?: 'sandbox' | 'live';
  userRepo?: UserRepo;
  sessionRepo?: SessionRepo;
  authClock?: () => number;
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
}

export function createApp(options: AppOptions): Express {
  const app = express();

  app.use(express.json());

  // CORS middleware
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Last-Event-ID');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok', version: 'v3', runtimeMode: options.runtimeMode ?? 'sandbox' });
  });

  // Auth routes (public login/refresh, protected /me)
  app.use(
    '/api/auth',
    createAuthRoutes({ jwtSecret: options.jwtSecret, userRepo: options.userRepo, sessionRepo: options.sessionRepo,
      clock: options.authClock, validateCredentials: options.validateCredentials })
  );

  const authMiddleware = createAuthMiddleware(options.jwtSecret, { sessionRepo: options.sessionRepo ?? options.userRepo?.sessions, clock: options.authClock });

  // Services routes (protected via Bearer header)
  app.use(
    '/api/services',
    authMiddleware,
    createServicesRoutes({ credentialRepo: options.credentialRepo, encryptionKey: options.encryptionKey, fetchFn: options.serviceFetchFn, onCredentialsChanged: options.onCredentialsChanged, adminUserIds: options.serviceAdminUserIds })
  );

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
