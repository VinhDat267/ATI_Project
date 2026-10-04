import request from 'supertest';
import { expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
const secret = 'fe03-vietnamese-errors-test-secret';
const bearer = generateTokens({ id: 'owner', email: 'owner@example.test', name: 'Owner' }, secret).accessToken;
it('returns a Vietnamese authentication error through the actual middleware', async () => {
  const app = createApp({ jwtSecret: secret });
  const response = await request(app).get('/api/services');
  expect(response.status).toBe(401);
  expect(response.body.error).toMatch(/đăng nhập|xác thực/i);
});
it('returns a Vietnamese service error through the actual route', async () => {
  const response = await request(createApp({ jwtSecret: secret })).post('/api/services/no-such-service/test').set('Authorization', `Bearer ${bearer}`);
  expect(response.status).toBe(400);
  expect(response.body.error).toMatch(/Dịch vụ.*hỗ trợ/);
});
it('does not expose an unknown English persistence error to the user', async () => {
  const app = createApp({ jwtSecret: secret, convRepo: { createConversation: async () => { throw new Error('database table missing confidential detail'); } } as any, msgRepo: {} as any, chatService: {} as any });
  const response = await request(app).post('/api/conversations').set('Authorization', `Bearer ${bearer}`);
  expect(response.status).toBe(500);
  expect(response.body.error).toBe('Không thể hoàn tất yêu cầu. Hãy thử lại.');
});
