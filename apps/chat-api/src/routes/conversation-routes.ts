import { Router, type Request, type Response } from 'express';
import type { ConversationRepo } from '../db/repositories/conversation-repo.js';
import type { MessageRepo } from '../db/repositories/message-repo.js';
import type { PlanRepo } from '../db/repositories/plan-repo.js';
import type { ChatService } from '../services/chat-service.js';
import { HistoryValidationError, validateConversationTitle } from '../db/repositories/conversation-history.js';

export interface ConversationRoutesOptions {
  convRepo: ConversationRepo;
  msgRepo: MessageRepo;
  chatService: ChatService;
  planRepo?: PlanRepo;
}

export function createConversationRoutes(options: ConversationRoutesOptions): Router {
  const router = Router();
  const { convRepo, msgRepo, chatService, planRepo } = options;
  if(chatService.hasSlackReads?.())router.post('/:id/slack-read-plans',async(req:Request,res:Response)=>{
    try{
      const userId=(req as any).user?.id,conversationId=req.params.id as string;
      if(!userId){res.status(401).json({error:'Unauthorized'});return;}
      const conversation=await convRepo.getConversation(conversationId);
      if(!conversation||conversation.user_id!==userId){res.status(404).json({error:'Conversation not found'});return;}
      const body=req.body;
      if(!body||Object.keys(body).some(k=>!['content','connectionId','tempId'].includes(k))||typeof body.content!=='string'||!body.content.trim()||body.content.length>4000||
         typeof body.connectionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.connectionId)||
         (body.tempId!==undefined&&(typeof body.tempId!=='string'||body.tempId.length>128))){
        res.status(400).json({error:'Yêu cầu đọc Slack không hợp lệ.'});return;
      }
      const result=await chatService.handleSlackReadProposal({conversationId,userId,content:body.content.trim(),connectionId:body.connectionId,...(body.tempId?{requestId:body.tempId}:{})});
      res.status(202).json(result);
    }catch{res.status(503).json({error:'Không lập được yêu cầu đọc Slack. Hãy thử lại.'});}
  });
  if(chatService.hasSlackWrites?.())router.post('/:id/slack-write-plans',async(req:Request,res:Response)=>{
    try{
      const userId=(req as any).user?.id,conversationId=req.params.id as string;
      if(!userId){res.status(401).json({error:'Unauthorized'});return;}
      const conversation=await convRepo.getConversation(conversationId);
      if(!conversation||conversation.user_id!==userId){res.status(404).json({error:'Conversation not found'});return;}
      const body=req.body;
      if(!body||Object.keys(body).some(k=>!['content','connectionId','channel','tempId'].includes(k))||typeof body.content!=='string'||!body.content.trim()||body.content.length>4000||
         typeof body.channel!=='string'||!/^([CG][A-Za-z0-9_-]{1,63})$/.test(body.channel)||typeof body.connectionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.connectionId)||
         (body.tempId!==undefined&&(typeof body.tempId!=='string'||body.tempId.length>128))){
        res.status(400).json({error:'Yêu cầu đọc Slack không hợp lệ.'});return;
      }
      const result=await chatService.handleSlackWriteProposal({conversationId,userId,content:body.content,channel:body.channel,connectionId:body.connectionId,...(body.tempId?{requestId:body.tempId}:{})});
      res.status(202).json(result);
    }catch{res.status(503).json({error:'Không lập được yêu cầu gửi Slack. Hãy thử lại.'});}
  });

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
      const { limit, cursor, search } = req.query;
      if ([limit, cursor, search].some(value => value !== undefined && typeof value !== 'string')) throw new HistoryValidationError('Tham số lịch sử không hợp lệ.');
      const page = await convRepo.listConversationPage(userId, {
        ...(limit !== undefined ? { limit: Number(limit) } : {}),
        ...(cursor !== undefined ? { cursor: cursor as string } : {}),
        ...(search !== undefined ? { search: search as string } : {}),
      });
      res.status(200).json(page);
    } catch (err: any) {
      res.status(err instanceof HistoryValidationError ? 400 : 500).json({ error: err instanceof HistoryValidationError ? err.message : 'Không tải được lịch sử hội thoại.' });
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
      const conv = await convRepo.getConversation(conversationId);
      if (!conv) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      if (conv.user_id !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
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
      const conv = await convRepo.getConversation(conversationId);
      if (!conv) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      if (conv.user_id !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
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
      const conversation = await convRepo.getConversation(conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      if (conversation.user_id !== userId) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      const messages = await msgRepo.listMessages(conversationId);
      res.status(200).json({ conversation, messages });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch conversation' });
    }
  });

  router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const title = validateConversationTitle(req.body?.title);
      const conversation = await convRepo.renameConversation(req.params.id as string, userId, title);
      if (!conversation) { res.status(404).json({ error: 'Conversation not found' }); return; }
      res.status(200).json({ conversation });
    } catch (error) {
      res.status(error instanceof HistoryValidationError ? 400 : 500).json({ error: error instanceof HistoryValidationError ? error.message : 'Không đổi được tên hội thoại.' });
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
      const conv = await convRepo.getConversation(conversationId);
      if (!conv) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      if (conv.user_id !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
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
