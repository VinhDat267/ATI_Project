import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
const googleOAuth = { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://web.example.test/auth/google/callback', authorizationUrl: 'http://fake/authorize', tokenUrl: 'http://fake/token', jwksUrl: 'http://fake/jwks' };
describe('Google browser transport policy', () => {
  it('permits credentialed CORS only for configured Google web origins', async () => {
    const app = createApp({ jwtSecret: 'local-secret', googleOAuth, appBaseUrl: 'https://web.example.test' });
    const result = await request(app).options('/api/auth/google/start').set('Origin', 'https://web.example.test');
    expect(result.headers['access-control-allow-origin']).toBe('https://web.example.test');
    expect(result.headers['access-control-allow-credentials']).toBe('true'); expect(result.headers.vary).toContain('Origin');
    const hostile = await request(app).options('/api/auth/google/start').set('Origin', 'https://evil.test');
    expect(hostile.headers['access-control-allow-origin']).toBeUndefined(); expect(hostile.headers['access-control-allow-credentials']).toBeUndefined();
  });
  it('pins authorization endpoint in live even for directly injected fake AppOptions', async () => {
    const saved: object[] = [];
    const app = createApp({ jwtSecret: 'local-secret', runtimeMode: 'live', googleOAuth,
      userRepo: { googleAuth: { createState: async (row: object) => { saved.push(row); } }, sessions: {} } as any });
    const r = await request(app).post('/api/auth/google/start').send({ mode: 'login' });
    expect(r.status).toBe(200); expect(new URL(r.body.url).origin).toBe('https://accounts.google.com');
    expect(r.headers['set-cookie']![0]).toContain('Secure'); expect(saved).toHaveLength(1);
  });
});
