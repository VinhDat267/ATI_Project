import { Router, type Request, type Response } from 'express';
import type pg from 'pg';
import {
  ConversationRepo,
  ConversationAccessError,
  type ConversationScope,
} from '../db/repositories/conversation-repo.js';
import type { MessageRepo } from '../db/repositories/message-repo.js';
import type { PlanRepo } from '../db/repositories/plan-repo.js';
import type { ChatService } from '../services/chat-service.js';
import { HistoryValidationError, validateConversationTitle } from '../db/repositories/conversation-history.js';
import {
  assertConversationAccessWithFallback,
  ConversationAccessDeniedError,
} from '../services/conversation-access.js';

export interface ConversationRoutesOptions {
  convRepo: ConversationRepo;
  msgRepo: MessageRepo;
  chatService: ChatService;
  planRepo?: PlanRepo;
  pool?: pg.Pool;
  enableWorkspaceConversations?: boolean;
}

export function createConversationRoutes(options: ConversationRoutesOptions): Router {
  const router = Router();
  const { convRepo, msgRepo, chatService, planRepo, enableWorkspaceConversations } = options;
  const pool = options.pool ?? convRepo.getPool?.();

  // POST /api/conversations
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const headerMode = req.workspace?.mode ?? 'legacy';
      const headerWsId = req.workspace?.workspaceId ?? null;

      // Validate body jiraContext
      const rawJiraContext = req.body?.jiraContext;
      if (rawJiraContext !== undefined && typeof rawJiraContext !== 'boolean') {
        res.status(400).json({ error: 'Invalid jiraContext: must be a boolean' });
        return;
      }
      const jiraContext = Boolean(rawJiraContext);

      // Validate body workspaceId: old body workspace cannot invent scope or override header
      const bodyWsId = req.body?.workspaceId;
      if (bodyWsId !== undefined && bodyWsId !== null) {
        if (headerMode !== 'organization' || bodyWsId !== headerWsId) {
          res.status(400).json({ error: 'workspaceId in body cannot mismatch or override workspace header' });
          return;
        }
      }

      // Jira opt-in requires organization mode
      if (jiraContext) {
        if (headerMode !== 'organization' || !headerWsId) {
          res.status(400).json({ error: 'jiraContext is only supported in an organization workspace' });
          return;
        }

        if (!enableWorkspaceConversations) {
          res.status(503).json({
            code: 'WORKSPACE_CONVERSATIONS_UNAVAILABLE',
            error: 'Workspace conversation creation is disabled until model and execution isolation guards are active.',
          });
          return;
        }

        if (!pool && !convRepo.getPool?.()) {
          res.status(503).json({
            code: 'WORKSPACE_CONVERSATIONS_UNAVAILABLE',
            error: 'Workspace conversation authority is unavailable.',
          });
          return;
        }
      }

      const scope: ConversationScope = {
        workspaceMode: headerMode,
        workspaceId: headerWsId,
        jiraContext,
      };

      try {
        const conversation = await convRepo.createConversation(userId, req.body?.title, scope);
        res.status(201).json({ conversation });
      } catch (err: any) {
        if (
          err instanceof ConversationAccessError ||
          err?.code === 'WORKSPACE_NOT_FOUND' ||
          err?.code === 'WORKSPACE_MEMBERSHIP_REQUIRED' ||
          err?.code === 'INVALID_WORKSPACE_SCOPE' ||
          err?.status === 404
        ) {
          res.status(404).json({ error: err.message || 'Workspace not found or membership revoked' });
          return;
        }
        throw err;
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to create conversation' });
    }
  });

  // GET /api/conversations
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { limit, cursor, search } = req.query;
      if ([limit, cursor, search].some((value) => value !== undefined && typeof value !== 'string')) {
        throw new HistoryValidationError('Tham số lịch sử không hợp lệ.');
      }
      const scope: ConversationScope = {
        workspaceMode: req.workspace?.mode,
        workspaceId: req.workspace?.workspaceId,
      };
      const page = await convRepo.listConversationPage(
        userId,
        {
          ...(limit !== undefined ? { limit: Number(limit) } : {}),
          ...(cursor !== undefined ? { cursor: cursor as string } : {}),
          ...(search !== undefined ? { search: search as string } : {}),
        },
        scope
      );
      res.status(200).json(page);
    } catch (err: any) {
      res
        .status(err instanceof HistoryValidationError ? 400 : 500)
        .json({ error: err instanceof HistoryValidationError ? err.message : 'Không tải được lịch sử hội thoại.' });
    }
  });

  // GET /api/conversations/:id/plans/active
  router.get('/:id/plans/active', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const conversationId = req.params.id as string;
      try {
        await assertConversationAccessWithFallback(
          { pool, convRepo },
          conversationId,
          userId,
          {
            legacyNonOwnerStatus: 403,
            expectedWorkspaceId: req.workspace?.workspaceId ?? null,
            expectedWorkspaceMode: req.workspace?.mode,
          }
        );
      } catch (err: any) {
        if (err instanceof ConversationAccessDeniedError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }

      if (!planRepo) {
        res.status(500).json({ error: 'Plan repository not configured' });
        return;
      }
      const planRow = await planRepo.getPendingPlan(conversationId);
      if (!planRow) {
        res.status(404).json({ error: 'No active pending plan found' });
        return;
      }
      const parsed =
        typeof planRow.plan_json === 'string'
          ? JSON.parse(planRow.plan_json)
          : planRow.plan_json;
      res.status(200).json({
        id: planRow.id,
        convId: planRow.conv_id,
        status: planRow.status,
        ...parsed,
        resourceLabels: planRow.resource_labels ?? {},
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch active plan' });
    }
  });

  // GET /api/conversations/:id/messages/latest
  router.get('/:id/messages/latest', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const conversationId = req.params.id as string;
      try {
        await assertConversationAccessWithFallback(
          { pool, convRepo },
          conversationId,
          userId,
          {
            legacyNonOwnerStatus: 403,
            expectedWorkspaceId: req.workspace?.workspaceId ?? null,
            expectedWorkspaceMode: req.workspace?.mode,
          }
        );
      } catch (err: any) {
        if (err instanceof ConversationAccessDeniedError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }

      const messages = await msgRepo.listMessages(conversationId);
      if (!messages || messages.length === 0) {
        res.status(404).json({ error: 'No messages found in conversation' });
        return;
      }
      const latest = messages[messages.length - 1];
      res.status(200).json(latest);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch latest message' });
    }
  });

  // GET /api/conversations/:id
  router.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const conversationId = req.params.id as string;
      let conversation: any;
      try {
        conversation = await assertConversationAccessWithFallback(
          { pool, convRepo },
          conversationId,
          userId,
          {
            legacyNonOwnerStatus: 404,
            expectedWorkspaceId: req.workspace?.workspaceId ?? null,
            expectedWorkspaceMode: req.workspace?.mode,
          }
        );
      } catch (err: any) {
        if (err instanceof ConversationAccessDeniedError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }

      const messages = await msgRepo.listMessages(conversationId);
      res.status(200).json({ conversation, messages });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch conversation' });
    }
  });

  // PATCH /api/conversations/:id
  router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const conversationId = req.params.id as string;
      try {
        await assertConversationAccessWithFallback(
          { pool, convRepo },
          conversationId,
          userId,
          {
            legacyNonOwnerStatus: 404,
            expectedWorkspaceId: req.workspace?.workspaceId ?? null,
            expectedWorkspaceMode: req.workspace?.mode,
          }
        );
      } catch (err: any) {
        if (err instanceof ConversationAccessDeniedError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }

      const title = validateConversationTitle(req.body?.title);
      const conversation = await convRepo.renameConversation(conversationId, userId, title);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      res.status(200).json({ conversation });
    } catch (error) {
      res
        .status(error instanceof HistoryValidationError ? 400 : 500)
        .json({ error: error instanceof HistoryValidationError ? error.message : 'Không đổi được tên hội thoại.' });
    }
  });

  // POST /api/conversations/:id/messages
  router.post('/:id/messages', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const conversationId = req.params.id as string;
      try {
        await assertConversationAccessWithFallback(
          { pool, convRepo },
          conversationId,
          userId,
          {
            legacyNonOwnerStatus: 403,
            expectedWorkspaceId: req.workspace?.workspaceId ?? null,
            expectedWorkspaceMode: req.workspace?.mode,
          }
        );
      } catch (err: any) {
        if (err instanceof ConversationAccessDeniedError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        throw err;
      }

      const { content, tempId } = req.body || {};

      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content string is required' });
        return;
      }

      const result = await chatService.handleUserMessage({
        conversationId,
        userId,
        content,
        ...(typeof tempId === 'string' && tempId.length <= 128 ? { requestId: tempId } : {}),
      });

      res.status(202).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to ingest message' });
    }
  });

  return router;
}
