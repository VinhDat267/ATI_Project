import { Router, type Request, type Response } from 'express';
import type { ConversationRepo } from '../db/repositories/conversation-repo.js';
import type { MessageRepo } from '../db/repositories/message-repo.js';
import type { PlanRepo } from '../db/repositories/plan-repo.js';
import type { ChatService } from '../services/chat-service.js';

export interface ConversationRoutesOptions {
  convRepo: ConversationRepo;
  msgRepo: MessageRepo;
  chatService: ChatService;
  planRepo?: PlanRepo;
}

export function createConversationRoutes(options: ConversationRoutesOptions): Router {
  const router = Router();
  const { convRepo, msgRepo, chatService, planRepo } = options;

  // POST /api/conversations
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const conversation = await convRepo.createConversation(userId);
      res.status(201).json({ conversation });
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
      const conversations = await convRepo.listConversations(userId);
      res.status(200).json({ conversations });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to list conversations' });
    }
  });

  // GET /api/conversations/:id/plans/active
  router.get('/:id/plans/active', async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = req.params.id as string;
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
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch active plan' });
    }
  });

  // GET /api/conversations/:id/messages/latest
  router.get('/:id/messages/latest', async (req: Request, res: Response): Promise<void> => {
    try {
      const conversationId = req.params.id as string;
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
      const conversation = await convRepo.getConversation(conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      const messages = await msgRepo.listMessages(conversationId);
      res.status(200).json({ conversation, messages });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch conversation' });
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
      const { content } = req.body || {};

      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content string is required' });
        return;
      }

      const result = await chatService.handleUserMessage({
        conversationId,
        userId,
        content,
      });

      res.status(202).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to ingest message' });
    }
  });

  return router;
}
