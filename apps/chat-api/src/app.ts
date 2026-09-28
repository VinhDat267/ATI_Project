import express, { type Express } from 'express';
import { createAuthRoutes } from './routes/auth-routes.js';
import { createConversationRoutes } from './routes/conversation-routes.js';
import { createStreamRoutes } from './routes/stream-routes.js';
import { createExecutionRoutes } from './routes/execution-routes.js';
import type { ConversationRepo } from './db/repositories/conversation-repo.js';
import type { MessageRepo } from './db/repositories/message-repo.js';
import type { ChatService } from './services/chat-service.js';
import type { SSEManager } from './sse/sse-manager.js';
import type { ExecutionService } from './services/execution-service.js';

export interface AppOptions {
  jwtSecret: string;
  convRepo?: ConversationRepo;
  msgRepo?: MessageRepo;
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
    res.status(200).json({ status: 'ok', version: 'v3' });
  });

  // Auth routes
  app.use('/api/auth', createAuthRoutes({ jwtSecret: options.jwtSecret }));

  // Stream routes
  if (options.sseManager) {
    app.use('/api/conversations', createStreamRoutes({ sseManager: options.sseManager }));
  }

  // Conversation routes
  if (options.convRepo && options.msgRepo && options.chatService) {
    app.use(
      '/api/conversations',
      createConversationRoutes({
        convRepo: options.convRepo,
        msgRepo: options.msgRepo,
        chatService: options.chatService,
      })
    );
  }

  // Execution routes
  if (options.executionService) {
    app.use('/api', createExecutionRoutes({ executionService: options.executionService }));
  }

  return app;
}
