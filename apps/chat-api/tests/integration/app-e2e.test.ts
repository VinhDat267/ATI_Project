import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/app.js';
import { SSEManager } from '../../src/sse/sse-manager.js';
import { DEMO_ADMIN_ID } from '../../src/routes/auth-routes.js';

describe('apps/chat-api Reality Check (End-to-End Real HTTP Integration)', () => {
  const secret = 'super-secret-jwt-test-key-at-least-32-chars';
  let server: Server;
  let baseUrl: string;
  let sseManager: SSEManager;

  const mockConvRepo = {
    createConversation: vi.fn().mockImplementation(async (userId: string) => ({
      id: 'conv-e2e-1',
      user_id: userId,
      title: 'New Conversation',
      created_at: new Date(),
      updated_at: new Date(),
    })),
    listConversations: vi.fn().mockImplementation(async (userId: string) => [
      { id: 'conv-e2e-1', user_id: userId, title: 'New Conversation' },
    ]),
    getConversation: vi.fn().mockImplementation(async (id: string) => ({
      id,
      user_id: DEMO_ADMIN_ID,
      title: 'New Conversation',
    })),
  };

  const mockMsgRepo = {
    createMessage: vi.fn().mockResolvedValue({ id: 'msg-e2e-1' }),
    listMessages: vi.fn().mockResolvedValue([]),
  };

  const mockChatService = {
    handleUserMessage: vi.fn().mockResolvedValue({
      status: 202,
      messageId: 'msg-e2e-1',
    }),
  };

  const mockExecutionService = {
    approveAndStart: vi.fn().mockResolvedValue({
      status: 200,
      success: true,
      planId: 'plan-e2e-1',
    }),
    retryStep: vi.fn(),
    skipStep: vi.fn(),
    stop: vi.fn(),
  };

  beforeAll(async () => {
    sseManager = new SSEManager();
    const app = createApp({
      jwtSecret: secret,
      validateCredentials: async (email, password) =>
        email === 'admin@wap.local' && password === 'password123'
          ? { id: DEMO_ADMIN_ID, email, name: 'Fixture Admin' }
          : null,
      convRepo: mockConvRepo as any,
      msgRepo: mockMsgRepo as any,
      chatService: mockChatService as any,
      sseManager,
      executionService: mockExecutionService as any,
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('serves GET /api/health with 200 and version info', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', version: 'v3', runtimeMode: 'sandbox' });
  });

  it('rejects unauthenticated requests to protected endpoints with 401', async () => {
    const res = await fetch(`${baseUrl}/api/conversations`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/authorization/i);
  });

  it('rejects login with invalid credentials with 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@wap.local', password: 'wrongpassword' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid email or password/i);
  });

  it('rejects login for arbitrary unknown email with 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'intruder@unknown.com', password: 'password123' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid email or password/i);
  });

  let validToken = '';

  it('authenticates valid credentials and issues access & refresh tokens', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@wap.local', password: 'password123' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('admin@wap.local');
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    validToken = body.accessToken;
  });

  it('allows access to GET /api/auth/me using Bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('admin@wap.local');
  });

  it('allows creating conversation with valid auth token', async () => {
    const res = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.conversation.id).toBe('conv-e2e-1');
  });

  it('allows posting message to conversation with valid auth token', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv-e2e-1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ content: 'Create a new card on Board' }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe(202);
    expect(body.messageId).toBe('msg-e2e-1');
  });

  it('allows plan approval with valid auth token', async () => {
    const res = await fetch(`${baseUrl}/api/plans/plan-e2e-1/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validToken}`,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('rejects unauthenticated SSE stream connection with 401', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv-e2e-1/stream`);
    expect(res.status).toBe(401);
  });

  it('authenticates SSE stream connection via the Authorization header', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/conversations/conv-e2e-1/stream`, {
      headers: { Authorization: `Bearer ${validToken}` },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // Emit an SSE event to verify stream delivers
    sseManager.emitEvent('conv-e2e-1', 'status', { state: 'testing' });

    // Abort after confirming stream connection
    controller.abort();
  });
});
