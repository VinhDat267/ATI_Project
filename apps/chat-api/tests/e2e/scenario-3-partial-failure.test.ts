import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createE2EApp, type E2EContext } from './e2e-harness.js';

describe('E2E Scenario 3: Partial Failure Recovery', () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EApp({ mode: 'fail-step', failStepId: 'step_2' });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('pauses at failed step_2, skips it, and completes remaining steps', async () => {
    const app = ctx.app;

    // 1. Login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@wap.local', password: 'password123' });
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.accessToken;

    // 2. Create conversation
    const convRes = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(convRes.status).toBe(201);
    const convId = convRes.body.conversation.id;

    // 3. Send message
    await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Tạo card và gửi Slack' });

    // 4. Wait for plan
    await ctx.waitForEvent('plan_preview');

    const planRes = await request(app)
      .get(`/api/conversations/${convId}/plans/active`)
      .set('Authorization', `Bearer ${token}`);
    expect(planRes.status).toBe(200);
    const plan = planRes.body;

    // 5. Approve plan
    const approveRes = await request(app)
      .post(`/api/plans/${plan.id}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(approveRes.status).toBe(200);

    // 6. Wait for execution pause (exec_done event with status 'partial')
    const doneEvent = await ctx.waitForEvent('exec_done');
    expect(doneEvent.status).toBe('partial');
    expect(doneEvent.pausedAtStepId).toBe('step_2');

    // 7. Check status is paused at step_2
    const status1 = await request(app)
      .get(`/api/executions/${plan.id}/status`)
      .set('Authorization', `Bearer ${token}`);
    expect(status1.status).toBe(200);
    expect(status1.body.status).toBe('partial');
    expect(status1.body.pausedStepId).toBe('step_2');

    // 8. Skip step_2
    const skipRes = await request(app)
      .post(`/api/executions/${plan.id}/steps/step_2/skip`)
      .set('Authorization', `Bearer ${token}`);
    expect(skipRes.status).toBe(200);
    expect(skipRes.body.status).toBe('completed');

    // 9. Wait for final exec_done
    const finalEvent = await ctx.waitForEvent('exec_done');
    expect(finalEvent.status).toBe('completed');

    // 10. Verify final execution status
    const status2 = await request(app)
      .get(`/api/executions/${plan.id}/status`)
      .set('Authorization', `Bearer ${token}`);
    expect(status2.status).toBe(200);
    expect(status2.body.status).toBe('completed');
  });
});
