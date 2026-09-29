import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createE2EApp, type E2EContext } from './e2e-harness.js';

describe('E2E Scenario 2: Ambiguous Name Clarification', () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EApp({ mode: 'clarification' });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('returns clarification when ambiguous, then generates plan after user answers', async () => {
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

    // 3. Send ambiguous message
    const msg1Res = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Gán task cho Minh trên board Frontend' });
    expect(msg1Res.status).toBe(202);

    // 4. Wait for clarification event
    await ctx.waitForEvent('clarification');

    // 5. Check latest message is clarification
    const latestRes = await request(app)
      .get(`/api/conversations/${convId}/messages/latest`)
      .set('Authorization', `Bearer ${token}`);
    expect(latestRes.status).toBe(200);
    expect(latestRes.body.metadata?.type).toBe('clarification');
    expect(latestRes.body.metadata?.options).toContain('Minh Nguyen');
    expect(latestRes.body.metadata?.options).toContain('Minh Tran');

    // 6. Answer clarification
    const msg2Res = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Minh Nguyen' });
    expect(msg2Res.status).toBe(202);

    // 7. Wait for plan generation
    await ctx.waitForEvent('plan_preview');

    // 8. Verify active plan exists
    const planRes = await request(app)
      .get(`/api/conversations/${convId}/plans/active`)
      .set('Authorization', `Bearer ${token}`);
    expect(planRes.status).toBe(200);
    expect(planRes.body.steps).toBeDefined();
    expect(planRes.body.steps.length).toBeGreaterThanOrEqual(2);
  });
});
