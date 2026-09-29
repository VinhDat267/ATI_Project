import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';

const secret = 'service-route-secret-at-least-32-chars';
const key = 'test-only-encryption-key-with-32bytes';
const token = generateTokens({ id: 'user-a', email: 'a@example.test', name: 'A' }, secret).accessToken;

describe('service credential and health boundary', () => {
  it('returns the saved allowlist when listing services', async () => {
    const config = encryptCredentials({ apiKey: 'k', token: 't', allowedScope: { boards: ['board-1', 'board-2'] } }, key);
    const app = createApp({ jwtSecret: secret, credentialRepo: {
      getCredentials: async (service: string) => service === 'trello' ? { config } : null,
    } as any, encryptionKey: key });
    const response = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.services.find((service: any) => service.id === 'trello').allowedScope).toEqual(['board-1', 'board-2']);
  });
  it('encrypts credentials and stores allowed scope inside encrypted team config', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'cred', service: 'trello' }], rowCount: 1 });
    const repo = new CredentialRepo({ query, connect: async () => ({ query, release: () => undefined }) } as any);
    const app = createApp({ jwtSecret: secret, credentialRepo: repo, encryptionKey: key, serviceAdminUserIds: ['user-a'] });
    const response = await request(app).post('/api/services/trello/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ credentials: { apiKey: 'api-secret', token: 'token-secret' }, allowedScope: ['board-1'] });
    expect(response.status).toBe(200);
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO service_credentials'));
    expect(insert).toBeDefined();
    expect(insert![1][1]).toBeNull();
    expect(insert![1][2]).toMatch(/^v1:/);
    expect(JSON.stringify(insert![1])).not.toContain('api-secret');
    expect(decryptCredentials(insert![1][2], key)).toEqual({ apiKey: 'api-secret', token: 'token-secret', allowedScope: { boards: ['board-1'] } });
  });

  it('does not let any authenticated team member overwrite shared credentials', async () => {
    const saveCredentials = vi.fn();
    const app = createApp({ jwtSecret: secret, credentialRepo: { saveCredentials } as any, encryptionKey: key, serviceAdminUserIds: ['other-admin'] });
    const response = await request(app).post('/api/services/slack/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ credentials: { botToken: 'xoxb-test-only' }, allowedScope: ['C1'] });
    expect(response.status).toBe(403);
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it('reports healthy only after a provider read confirms credentials', async () => {
    const config = encryptCredentials({ botToken: 'xoxb-test-only', allowedScope: { slackChannelIds: ['C1'] } }, key);
    const repo = { getCredentials: async () => ({ config, service: 'slack' }) };
    const fetchFn = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, user_id: 'U1' }), { status: 200 }));
    const app = createApp({ jwtSecret: secret, credentialRepo: repo as any, encryptionKey: key, serviceFetchFn: fetchFn });
    const first = await request(app).post('/api/services/slack/test').set('Authorization', `Bearer ${token}`);
    expect(first.status).not.toBe(200);
    expect(first.body.status).not.toBe('healthy');
    const second = await request(app).post('/api/services/slack/test').set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('healthy');
    expect(second.body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
