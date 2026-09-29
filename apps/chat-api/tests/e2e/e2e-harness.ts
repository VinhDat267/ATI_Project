import { EventEmitter } from 'node:events';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { SSEManager } from '../../src/sse/sse-manager.js';
import { ChatService } from '../../src/services/chat-service.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import {
  AIPlanner,
  MockLLMProvider,
} from '@wap/planner';
import { TRELLO_TOOLS, SLACK_TOOLS, type PlannerResponse } from '@wap/tool-schemas';

export interface E2EAppOptions {
  mode: 'happy-path' | 'clarification' | 'fail-step';
  failStepId?: string;
}

export interface E2EContext {
  app: Express;
  events: EventEmitter;
  waitForEvent: (eventName: string, timeoutMs?: number) => Promise<any>;
  cleanup: () => Promise<void>;
}

export const VALID_3_STEP_PLAN = {
  kind: 'plan',
  thinking: 'User wants to create a Trello card on Frontend board, assign member Minh, and notify Slack general channel.',
  summary: 'Tạo card sửa CSS, gán Minh, và thông báo Slack',
  steps: [
    {
      id: 'step_1',
      tool: 'trello.create_card',
      description: 'Tạo card sửa CSS trên list To Do',
      args: { listId: 'list_todo_001', title: 'Sửa CSS' },
      dependsOn: [],
    },
    {
      id: 'step_2',
      tool: 'trello.add_member',
      description: 'Gán thành viên Minh vào card vừa tạo',
      args: { cardId: { $ref: 'step_1.output.id' }, memberId: 'member_minh_001' },
      dependsOn: ['step_1'],
    },
    {
      id: 'step_3',
      tool: 'slack.send_message',
      description: 'Báo thông tin card lên Slack channel general',
      args: { channel: 'C_GENERAL', text: { $template: 'Task mới: ${step_1.output.url}' } },
      dependsOn: ['step_1'],
    },
  ],
  warnings: [],
};

export const CLARIFICATION_RESPONSE = {
  kind: 'clarification',
  question: 'Tìm thấy 2 thành viên tên "Minh": Minh Nguyen và Minh Tran. Bạn muốn gán cho ai?',
  options: ['Minh Nguyen', 'Minh Tran'],
  context: 'Phát hiện nhiều thành viên trùng tên trên board',
};

export async function createE2EApp(options: E2EAppOptions): Promise<E2EContext> {
  const events = new EventEmitter();
  events.on('error', () => undefined);
  const jwtSecret = 'super-secret-jwt-test-key-at-least-32-chars';

  // 1. In-memory data storage
  const convMap = new Map<string, any>();
  const msgMap = new Map<string, any[]>();
  const planMap = new Map<string, any>();
  const stepMap = new Map<string, any>();

  // 2. Mock Repositories
  const mockConvRepo = {
    createConversation: async (userId: string) => {
      const id = `conv_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const conv = {
        id,
        user_id: userId,
        status: 'chatting',
        created_at: new Date(),
        updated_at: new Date(),
      };
      convMap.set(id, conv);
      msgMap.set(id, []);
      return conv;
    },
    listConversations: async (userId: string) => {
      return Array.from(convMap.values()).filter((c) => c.user_id === userId);
    },
    getConversation: async (id: string) => {
      return convMap.get(id) || null;
    },
  };

  const mockMsgRepo = {
    createMessage: async (convId: string, role: string, content: string, metadata?: any) => {
      const id = `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const msg = {
        id,
        conv_id: convId,
        role,
        content,
        metadata: metadata || null,
        created_at: new Date(),
      };
      const list = msgMap.get(convId) || [];
      list.push(msg);
      msgMap.set(convId, list);
      return msg;
    },
    listMessages: async (convId: string) => {
      return msgMap.get(convId) || [];
    },
  };

  const mockPlanRepo = {
    createPlan: async (data: {
      convId: string;
      planJson: any;
      planText?: string;
      planHash: string;
      expiresAt: Date;
    }) => {
      const id = `plan_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const row = {
        id,
        conv_id: data.convId,
        plan_json: data.planJson,
        plan_text: data.planText || JSON.stringify(data.planJson),
        plan_hash: data.planHash,
        status: 'pending',
        expires_at: data.expiresAt,
        decided_at: null,
        created_at: new Date(),
      };
      planMap.set(id, row);
      return row;
    },
    getPlan: async (id: string) => {
      return planMap.get(id) || null;
    },
    getPendingPlan: async (convId: string) => {
      for (const plan of planMap.values()) {
        if (plan.conv_id === convId && plan.status === 'pending') {
          return plan;
        }
      }
      return null;
    },
    approvePlan: async (planId: string) => {
      const plan = planMap.get(planId);
      if (!plan || plan.status !== 'pending') {
        return false;
      }
      plan.status = 'approved';
      plan.decided_at = new Date();
      return true;
    },
    rejectPlan: async (planId: string) => {
      const plan = planMap.get(planId);
      if (!plan || plan.status !== 'pending') {
        return false;
      }
      plan.status = 'rejected';
      plan.decided_at = new Date();
      return true;
    },
    updatePlanStatus: async (planId: string, status: string) => {
      const plan = planMap.get(planId);
      if (plan) {
        plan.status = status;
      }
    },
  };

  const mockStepRepo = {
    createStep: async (data: {
      planId: string;
      stepId: string;
      tool: string;
      argsJson: any;
      requestedBy: string;
    }) => {
      const id = `step_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const row = {
        id,
        plan_id: data.planId,
        step_id: data.stepId,
        tool: data.tool,
        args_json: data.argsJson,
        status: 'pending',
        output_json: null,
        error_json: null,
        requested_by: data.requestedBy,
        started_at: null,
        completed_at: null,
        duration_ms: null,
      };
      stepMap.set(id, row);
      return row;
    },
    updateStepStatus: async (
      id: string,
      status: string,
      outputJson?: any,
      errorJson?: any,
      durationMs?: number
    ) => {
      const row = stepMap.get(id);
      if (row) {
        row.status = status;
        if (outputJson) row.output_json = outputJson;
        if (errorJson) row.error_json = errorJson;
        if (durationMs) row.duration_ms = durationMs;
      }
      return row;
    },
    listSteps: async (planId: string) => {
      return Array.from(stepMap.values()).filter((s) => s.plan_id === planId);
    },
  };

  // 3. Mock LLM Provider
  const mockProvider = new MockLLMProvider();
  if (options.mode === 'happy-path' || options.mode === 'fail-step') {
    mockProvider.setPlanResponses([VALID_3_STEP_PLAN]);
  } else if (options.mode === 'clarification') {
    mockProvider.setPlanResponses([{ ...VALID_3_STEP_PLAN, steps: VALID_3_STEP_PLAN.steps.slice(0, 2) }]);
  }

  // 4. Planner
  const planner = new AIPlanner({
    provider: mockProvider,
    toolCatalog: [...TRELLO_TOOLS, ...SLACK_TOOLS],
    gatherSearch: async ({ tool }) => {
      if (tool === 'trello.search_boards') return [{ id: 'board_frontend', name: 'Frontend' }];
      if (tool === 'trello.search_members') return options.mode === 'clarification'
        ? [{ id: 'member_minh_001', name: 'Minh Nguyen' }, { id: 'member_minh_002', name: 'Minh Tran' }]
        : [{ id: 'member_minh_001', name: 'Minh' }];
      if (tool === 'slack.search_channels') return [{ id: 'C_GENERAL', name: 'general' }];
      return [];
    },
  });

  // 5. SSE Manager with event bridging
  const eventHistory: Array<{ event: string; data: any }> = [];
  const recordEvent = (eventName: string, data: any) => {
    eventHistory.push({ event: eventName, data });
    events.emit(eventName, data);
  };

  const sseManager = new SSEManager();
  const originalEmit = sseManager.emitEvent.bind(sseManager);
  sseManager.emitEvent = (convId: string, eventName: string, data: any) => {
    const event = originalEmit(convId, eventName, data);
    recordEvent(eventName, data);
    return event;
  };

  // 6. Chat Service event forwarding
  const chatEventEmitter = {
    emit: (event: string, payload: any) => {
      recordEvent(event, payload);
    },
  };

  const chatService = new ChatService({
    msgRepo: mockMsgRepo as any,
    convRepo: mockConvRepo as any,
    planRepo: mockPlanRepo as any,
    planner,
    eventEmitter: chatEventEmitter,
  });

  // 7. Mock Adapter Factory with simulated tool executions
  const adapterFactory = {
    getAdapterForService: (_serviceName: string) => {
      return {
        execute: async (tool: string, args: any) => {
          // If fail-step mode is active and this tool is the failing step (e.g. trello.add_member for step_2)
          if (
            options.mode === 'fail-step' &&
            options.failStepId === 'step_2' &&
            tool === 'trello.add_member'
          ) {
            const err: any = new Error('Member not found');
            err.category = 'NOT_FOUND';
            err.status = 404;
            throw err;
          }

          if (tool === 'trello.create_card') {
            return {
              id: 'card_c1',
              name: args.title || 'New Card',
              url: 'https://trello.com/c/card_c1',
            };
          }
          if (tool === 'trello.add_member') {
            return {
              id: args.cardId,
              idMembers: [args.memberId],
            };
          }
          if (tool === 'slack.send_message') {
            return {
              ok: true,
              channel: args.channel,
              ts: '1727500000.000100',
            };
          }
          return { ok: true, output: 'default_mock_output' };
        },
      };
    },
  };

  // 8. Execution Service
  const executionService = new ExecutionService({
    planRepo: mockPlanRepo as any,
    stepRepo: mockStepRepo as any,
    convRepo: mockConvRepo as any,
    adapterFactory,
    sseManager,
  });

  // 9. Create Express App
  const app = createApp({
    jwtSecret,
    validateCredentials: async (email, password) =>
      email === 'admin@wap.local' && password === 'password123'
        ? { id: 'a0000000-0000-4000-8000-000000000001', email, name: 'Fixture Admin' }
        : null,
    convRepo: mockConvRepo as any,
    msgRepo: mockMsgRepo as any,
    planRepo: mockPlanRepo as any,
    chatService,
    sseManager,
    executionService,
  });

  const waitForEvent = (eventName: string, timeoutMs = 5000): Promise<any> => {
    const existingIndex = eventHistory.findIndex((e) => e.event === eventName);
    if (existingIndex !== -1) {
      const [matched] = eventHistory.splice(existingIndex, 1);
      if (matched) {
        return Promise.resolve(matched.data);
      }
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event '${eventName}' after ${timeoutMs}ms`));
      }, timeoutMs);

      events.once(eventName, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  };

  return {
    app,
    events,
    waitForEvent,
    cleanup: async () => {},
  };
}
