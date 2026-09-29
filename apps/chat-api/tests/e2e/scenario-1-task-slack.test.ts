import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createE2EApp, type E2EContext } from './e2e-harness.js';

describe('E2E Scenario 1: Trello Card Creation & Slack Notification', () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EApp({ mode: 'happy-path' });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('completes full pipeline: chat → plan → approve → execute with 3-step cross-service workflow', async () => {
    const app = ctx.app;

    // 1. Login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@wap.local', password: 'password123' });
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.accessToken;
    expect(token).toBeDefined();

    // 2. Create conversation
    const convRes = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(convRes.status).toBe(201);
    const convId = convRes.body.conversation.id;
    expect(convId).toBeDefined();

    // 3. Send user message (async 202)
    const msgRes = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Tạo task sửa CSS, gán Minh trên board Frontend list To Do và báo channel general' });
    expect(msgRes.status).toBe(202);

    // 4. Wait for planner pipeline to complete
    await ctx.waitForEvent('plan_preview');

    // 5. Query generated active plan
    const planRes = await request(app)
      .get(`/api/conversations/${convId}/plans/active`)
      .set('Authorization', `Bearer ${token}`);
    expect(planRes.status).toBe(200);
    const plan = planRes.body;
    expect(plan.id).toBeDefined();
    expect(plan.steps).toBeDefined();
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);

    // 6. Approve plan
    const approveRes = await request(app)
      .post(`/api/plans/${plan.id}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(approveRes.status).toBe(200);

    // 7. Wait for execution to complete
    await ctx.waitForEvent('exec_done');

    // 8. Verify execution status
    const execRes = await request(app)
      .get(`/api/executions/${plan.id}/status`)
      .set('Authorization', `Bearer ${token}`);
    expect(execRes.status).toBe(200);
    expect(execRes.body.status).toBe('completed');
  });

  it('asks which list instead of previewing a plan whose list ID was never looked up', async () => {
    const app = ctx.app;
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@wap.local', password: 'password123' });
    const token = loginRes.body.accessToken;
    const convRes = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send();
    const convId = convRes.body.conversation.id;

    // The canned model still answers with listId 'list_todo_001', but no message names a list.
    const msgRes = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Tạo task sửa CSS, gán Minh trên board Frontend và báo channel general' });
    expect(msgRes.status).toBe(202);

    const clarification = await ctx.waitForEvent('clarification');
    expect(clarification.conversationId).toBe(convId);
    expect(clarification.question).toMatch(/list/i);

    const planRes = await request(app)
      .get(`/api/conversations/${convId}/plans/active`)
      .set('Authorization', `Bearer ${token}`);
    expect(planRes.status).toBe(404);
  });
});
