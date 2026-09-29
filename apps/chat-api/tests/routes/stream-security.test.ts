import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { SSEManager } from '../../src/sse/sse-manager.js';

const secret = 'stream-security-secret-at-least-32-chars';
const token = generateTokens({ id: 'user-a', email: 'a@example.test', name: 'A' }, secret).accessToken;

describe('SSE ownership boundary', () => {
  it('fails closed when the conversation repository is absent', async () => {
    const app = createApp({ jwtSecret: secret, sseManager: new SSEManager() });
    const response = await request(app).get('/api/conversations/conv-b/stream').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
  });

  it('does not accept a bearer token in a URL query string', async () => {
    const app = createApp({ jwtSecret: secret, sseManager: new SSEManager() });
    const response = await request(app).get(`/api/conversations/conv-b/stream?token=${token}`);
    expect(response.status).toBe(401);
  });
});
