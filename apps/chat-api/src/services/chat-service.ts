import { createHash } from 'node:crypto';
import type { MessageRepo } from '../db/repositories/message-repo.js';
import type { ConversationRepo } from '../db/repositories/conversation-repo.js';
import type { PlanRepo } from '../db/repositories/plan-repo.js';
import { WorkingMemory, type AIPlanner, type ChatMessage } from '@wap/planner';
import type { PlannerResponse } from '@wap/tool-schemas';

export interface HandleUserMessageInput {
  conversationId: string;
  userId: string;
  content: string;
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
    const { conversationId, userId, content } = input;

    // 1. Save user message immediately to DB
    const message = await this.msgRepo.createMessage(
      conversationId,
      'user',
      content
    );

    // 2. Schedule async planner pipeline execution
    setImmediate(() => {
      this.executePlannerPipeline(conversationId, userId, content).catch((err) => {
        this.eventEmitter.emit('error', {
          conversationId,
          message: err?.message || 'Unexpected error in planning pipeline',
        });
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
    content: string
  ): Promise<void> {
    // Emit agent_state: planning
    this.eventEmitter.emit('agent_state', {
      conversationId,
      state: 'planning',
    });

    // Retrieve previous messages for conversation context
    const previousMessages = await this.msgRepo.listMessages(conversationId);
    const history: ChatMessage[] = previousMessages
      .filter((m: any) => m.content !== content)
      .map((m: any) => ({
        role: m.role as any,
        content: m.content,
      }));

    // Call planner
    const memory = new WorkingMemory();
    const plannerResponse: PlannerResponse = await this.planner.processMessage({
      userMessage: content,
      history,
      memory,
    });

    if (plannerResponse.kind === 'plan') {
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
        });
        planId = createdPlan.id;
      }

      this.eventEmitter.emit('plan_preview', {
        conversationId,
        planId,
        plan: plannerResponse,
      });

      this.eventEmitter.emit('agent_state', {
        conversationId,
        state: 'waiting_for_approval',
      });
    } else if (plannerResponse.kind === 'clarification') {
      this.eventEmitter.emit('clarification', {
        conversationId,
        question: plannerResponse.question,
        options: plannerResponse.options,
        context: plannerResponse.context,
      });

      this.eventEmitter.emit('agent_state', {
        conversationId,
        state: 'idle',
      });
    } else if (plannerResponse.kind === 'refusal') {
      this.eventEmitter.emit('refusal', {
        conversationId,
        reason: plannerResponse.reason,
        suggestion: plannerResponse.suggestion,
      });

      this.eventEmitter.emit('agent_state', {
        conversationId,
        state: 'idle',
      });
    }
  }
}
