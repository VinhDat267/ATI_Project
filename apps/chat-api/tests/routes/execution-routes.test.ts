import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ExecutionService } from '../../src/services/execution-service.js';
import { createExecutionRoutes } from '../../src/routes/execution-routes.js';
import { SSEManager } from '../../src/sse/sse-manager.js';
import { createHash } from 'node:crypto';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('apps/chat-api (Task 18: Execution Service Approval & Adapter Injection)', () => {
  it('approves pending plan with optimistic lock and rejects concurrent duplicate with 409', async () => {
    let callCount = 0;
    const mockPlanRepo = {
      approvePlan: vi.fn().mockImplementation(async () => {
        callCount++;
        return callCount === 1; // Only first call succeeds
      }),
      getPlan: vi.fn().mockResolvedValue({
        id: 'p1',
        conv_id: 'conv-1',
        status: 'approved',
        plan_json: { steps: [] },
        plan_hash: hash({ steps: [] }),
      }),
    };

    const mockAdapterFactory = {
      getAdapterForService: vi.fn().mockResolvedValue({ execute: vi.fn() }),
    };

    const service = new ExecutionService({
      planRepo: mockPlanRepo as any,
      convRepo: { getConversation: async () => ({ user_id: 'u1' }) },
      stepRepo: { createStep: vi.fn(), updateStepState: vi.fn() } as any,
      credentialRepo: { getCredentials: vi.fn() } as any,
      adapterFactory: mockAdapterFactory as any,
      sseManager: { emitEvent: vi.fn() } as any,
    });

    const call1 = await service.approveAndStart('p1', 'u1');
    expect(call1.success).toBe(true);
    expect(call1.status).toBe(200);

    const call2 = await service.approveAndStart('p1', 'u1');
    expect(call2.success).toBe(false);
    expect(call2.status).toBe(409);
    expect(call2.error).toMatch(/already approved/i);
  });

  it('runs execution controller on approved plan and emits SSE events', async () => {
    const mockPlanRepo = {
      approvePlan: vi.fn().mockResolvedValue(true),
      updatePlanStatus: vi.fn().mockResolvedValue(undefined),
      getPlan: vi.fn().mockResolvedValue({
        id: 'p2',
        conv_id: 'conv-2',
        status: 'approved',
        plan_json: {
          steps: [
            { id: 's1', tool: 'trello.create_card', description: 'Create card', args: {}, dependsOn: [] },
          ],
        },
        plan_hash: hash({ steps: [
          { id: 's1', tool: 'trello.create_card', description: 'Create card', args: {}, dependsOn: [] },
        ] }),
      }),
    };

    const mockAdapter = {
      execute: vi.fn().mockResolvedValue({ id: 'c1', url: 'https://trello.com/c/c1' }),
    };

    const mockAdapterFactory = {
      getAdapterForService: vi.fn().mockReturnValue(mockAdapter),
    };

    const mockSSEManager = {
      emitEvent: vi.fn(),
    };

    const mockStepRepo = {
      createStep: vi.fn().mockResolvedValue({ id: 'step-db-1' }),
      updateStepStatus: vi.fn().mockResolvedValue({}),
    };

    const service = new ExecutionService({
      planRepo: mockPlanRepo as any,
      convRepo: { getConversation: async () => ({ user_id: 'u2' }) },
      stepRepo: mockStepRepo as any,
      adapterFactory: mockAdapterFactory as any,
      sseManager: mockSSEManager as any,
    });

    const result = await service.approveAndStart('p2', 'u2');
    expect(result.success).toBe(true);

    // Wait for background execution to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockSSEManager.emitEvent).toHaveBeenCalledWith(
      'conv-2',
      'exec_start',
      expect.objectContaining({ planId: 'p2' })
    );
    expect(mockSSEManager.emitEvent).toHaveBeenCalledWith(
      'conv-2',
      'exec_step',
      expect.objectContaining({ stepId: 's1', status: 'succeeded' })
    );
    expect(mockSSEManager.emitEvent).toHaveBeenCalledWith(
      'conv-2',
      'exec_done',
      expect.objectContaining({ planId: 'p2', status: 'completed' })
    );
  });

  it('clears buffered plan_preview from SSEManager when a plan is rejected via POST /api/plans/:id/reject', async () => {
    const sseManager = new SSEManager();
    const convId = 'conv-reject-1';
    const planId = 'plan-reject-1';

    sseManager.emitEvent(convId, 'thinking', { text: 'Planning...' });
    sseManager.emitEvent(convId, 'plan_preview', { planId, plan: { id: planId, steps: [] } });
    expect(sseManager.getMissedEventsForCursor(convId, undefined).some((e) => e.event === 'plan_preview')).toBe(true);

    const mockPlanRepo = {
      getPlan: vi.fn().mockResolvedValue({
        id: planId,
        conv_id: convId,
        status: 'pending',
        plan_json: { steps: [] },
        plan_hash: hash({ steps: [] }),
      }),
      rejectPlan: vi.fn().mockResolvedValue(true),
    };

    const executionService = new ExecutionService({
      planRepo: mockPlanRepo as any,
      convRepo: { getConversation: async () => ({ user_id: 'u1' }) },
      adapterFactory: { getAdapterForService: vi.fn() } as any,
      sseManager,
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: 'u1' };
      next();
    });
    app.use('/api', createExecutionRoutes({ executionService }));

    const res = await request(app).post(`/api/plans/${planId}/reject`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, status: 'rejected' });

    const missedAfterReject = sseManager.getMissedEventsForCursor(convId, undefined);
    expect(missedAfterReject.some((e) => e.event === 'plan_preview' || e.event === 'plan')).toBe(false);
    expect(missedAfterReject.map((e) => e.event)).toEqual(['thinking']);
  });
});
