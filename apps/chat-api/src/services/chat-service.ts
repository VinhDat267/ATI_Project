import { createHash } from 'node:crypto';
import type { MessageRepo } from '../db/repositories/message-repo.js';
import type { ConversationRepo } from '../db/repositories/conversation-repo.js';
import type { PlanRepo } from '../db/repositories/plan-repo.js';
import { WorkingMemory, type AIPlanner, type ChatMessage } from '@wap/planner';
import type { PlannerResponse } from '@wap/tool-schemas';
import { resourceLabels } from './resource-labels.js';

export interface HandleUserMessageInput {
  conversationId: string;
  userId: string;
  content: string;
  requestId?: string;
}

export interface IngestionResult {
  status: 202;
  messageId: string;
}

export interface ChatServiceOptions {
  msgRepo: MessageRepo;
  convRepo?: ConversationRepo;
  planRepo?: PlanRepo;
  planner: AIPlanner;
  eventEmitter: {
    emit: (event: string, payload: any) => void;
  };
}

export class ChatService {
  private msgRepo: MessageRepo;
  private convRepo?: ConversationRepo;
  private planRepo?: PlanRepo;
  private planner: AIPlanner;
  private eventEmitter: { emit: (event: string, payload: any) => void };

  constructor(options: ChatServiceOptions) {
    this.msgRepo = options.msgRepo;
    this.convRepo = options.convRepo;
    this.planRepo = options.planRepo;
    this.planner = options.planner;
    this.eventEmitter = options.eventEmitter;
  }

  async handleUserMessage(input: HandleUserMessageInput): Promise<IngestionResult> {
    const { conversationId, userId, content, requestId } = input;

    // 1. Save user message immediately to DB
    const message = requestId
      ? await this.msgRepo.createMessage(conversationId, 'user', content, { requestId })
      : await this.msgRepo.createMessage(conversationId, 'user', content);
    const correlation = { replyToMessageId: message.id, ...(requestId ? { requestId } : {}) };

    // 2. Schedule async planner pipeline execution
    setImmediate(() => {
      this.executePlannerPipeline(conversationId, userId, content, message.id, requestId).catch(async () => {
        const text = 'Không thể lập kế hoạch lúc này. Hãy thử lại.';
        try {
          await this.msgRepo.createMessage(conversationId, 'system', `Lỗi: ${text}`, { type: 'planning_error', ...correlation });
        } catch { /* SSE must still report the failure if saving its history fails. */ }
        this.eventEmitter.emit('error', { conversationId, message: text, ...correlation });
      });
    });

    return {
      status: 202,
      messageId: message.id,
    };
  }

  private async executePlannerPipeline(
    conversationId: string,
    _userId: string,
    content: string,
    currentMessageId: string,
    requestId?: string
  ): Promise<void> {
    const correlation = { replyToMessageId: currentMessageId, ...(requestId ? { requestId } : {}) };
    // Emit agent_state: planning
    this.eventEmitter.emit('agent_state', {
      conversationId,
      state: 'planning',
      ...correlation,
    });

    // Retrieve previous messages for conversation context
    const previousMessages = await this.msgRepo.listMessages(conversationId);
    const lastMemory = [...previousMessages].reverse().find((m: any) => m.metadata?.type === 'working_memory');
    const history: ChatMessage[] = previousMessages
      .filter((m: any) => m.id !== currentMessageId && m.metadata?.type !== 'working_memory' &&
        (m.role === 'user' || m.role === 'assistant'))
      .map((m: any) => ({
        role: m.role as any,
        // A saved plan goes back to the model as the JSON it produced, so a follow-up
        // such as "Điều chỉnh kế hoạch: …" can change it; people see only the summary.
        content: m.metadata?.type === 'plan' && m.metadata.plan ? JSON.stringify(m.metadata.plan) : m.content,
      }));

    // Call planner
    const memory = new WorkingMemory();
    if (lastMemory?.metadata?.state && typeof lastMemory.metadata.state === 'object') {
      memory.fromJSON(lastMemory.metadata.state);
    }
    const plannerResponse: PlannerResponse = await this.planner.processMessage({
      userMessage: content,
      history,
      memory,
      onGatherEvent: (event) => this.eventEmitter.emit('gather_progress', { conversationId, ...event }),
    });
    await this.msgRepo.createMessage(conversationId, 'system', '', { type: 'working_memory', state: memory.toJSON() });

    if (plannerResponse.kind === 'plan') {
      const labels = resourceLabels(plannerResponse, memory);
      const planHash = createHash('sha256')
        .update(JSON.stringify(plannerResponse))
        .digest('hex');

      let planId = `plan_${Date.now()}`;
      if (this.planRepo) {
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes TTL
        const createdPlan = await this.planRepo.createPlan({
          convId: conversationId,
          planJson: plannerResponse,
          planText: JSON.stringify(plannerResponse),
          planHash,
          expiresAt,
          resourceLabels: labels,
        });
        planId = createdPlan.id;
      }

      await this.msgRepo.createMessage(conversationId, 'assistant', `Kế hoạch: ${plannerResponse.summary}`, {
        type: 'plan', planId, plan: plannerResponse, resourceLabels: labels, ...correlation,
      });

      this.eventEmitter.emit('plan_preview', {
        conversationId,
        planId,
        plan: plannerResponse,
        resourceLabels: labels,
        ...correlation,
      });

      this.eventEmitter.emit('agent_state', {
        conversationId,
        state: 'waiting_for_approval',
        ...correlation,
      });
    } else if (plannerResponse.kind === 'clarification') {
      await this.msgRepo.createMessage(conversationId, 'assistant', plannerResponse.question, {
        type: 'clarification', options: plannerResponse.options ?? [], context: plannerResponse.context, ...correlation,
      });
      this.eventEmitter.emit('clarification', {
        conversationId,
        question: plannerResponse.question,
        options: plannerResponse.options ?? [],
        context: plannerResponse.context,
        ...correlation,
      });

      this.eventEmitter.emit('agent_state', {
        conversationId,
        state: 'idle',
        ...correlation,
      });
    } else if (plannerResponse.kind === 'refusal') {
      const refusal = {
        reason: plannerResponse.reason,
        suggestion: plannerResponse.suggestion,
        ...(plannerResponse.unavailableServices ? { unavailableServices: plannerResponse.unavailableServices } : {}),
      };
      await this.msgRepo.createMessage(conversationId, 'assistant', `Từ chối yêu cầu: ${plannerResponse.reason}${plannerResponse.suggestion ? `\nGợi ý: ${plannerResponse.suggestion}` : ''}`, { type: 'refusal', ...refusal, ...correlation });
      this.eventEmitter.emit('refusal', {
        conversationId,
        ...refusal,
        ...correlation,
      });

      this.eventEmitter.emit('agent_state', {
        conversationId,
        state: 'idle',
        ...correlation,
      });
    }
  }
}
