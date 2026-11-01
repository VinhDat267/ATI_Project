import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { generateTokens } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { getConfiguredToolCatalog } from '../../src/services/registered-services.js';

const secret = 'service-route-secret-at-least-32-chars';
const key = 'test-only-encryption-key-with-32bytes';
const token = generateTokens({ id: 'user-a', email: 'a@example.test', name: 'A' }, secret).accessToken;

describe('service credential and health boundary', () => {
  it('returns the saved allowlist when listing services', async () => {
    const config = encryptCredentials({ botToken: 'xoxb-k', allowedScope: { channels: ['C1', 'C2'] } }, key);
    const app = createApp({ jwtSecret: secret, credentialRepo: {
      getCredentials: async (service: string) => service === 'slack' ? { config } : null,
    } as any, encryptionKey: key });
    const response = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.services.find((service: any) => service.id === 'slack').allowedScope).toEqual(['C1', 'C2']);
  });
  it('encrypts credentials and stores allowed scope inside encrypted team config', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'cred', service: 'slack' }], rowCount: 1 });
    const repo = new CredentialRepo({ query, connect: async () => ({ query, release: () => undefined }) } as any);
    const app = createApp({ jwtSecret: secret, credentialRepo: repo, encryptionKey: key, serviceAdminUserIds: ['user-a'] });
    const response = await request(app).post('/api/services/slack/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ credentials: { botToken: 'xoxb-secret' }, allowedScope: ['C1'] });
    expect(response.status).toBe(200);
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO service_credentials'));
    expect(insert).toBeDefined();
    expect(insert![1][1]).toBeNull();
    expect(insert![1][2]).toMatch(/^v1:/);
    expect(JSON.stringify(insert![1])).not.toContain('xoxb-secret');
    expect(decryptCredentials(insert![1][2], key)).toEqual({ botToken: 'xoxb-secret', allowedScope: { channels: ['C1'] } });
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

  it('lists Notion configuration and verifies a saved token with a read-only request', async () => {
    const db1 = '00000000-0000-0000-0000-000000000001';
    const config = encryptCredentials({ token: 'notion-test-token', allowedScope: { databases: [db1] } }, key);
    const repo = { getCredentials: async (service: string) => service === 'notion' ? { config } : null };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: 'database', id: db1, title: [{ plain_text: 'Fixture' }] }), { status: 200 }));
    const app = createApp({ jwtSecret: secret, credentialRepo: repo as any, encryptionKey: key, serviceFetchFn: fetchFn });
    const listed = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    expect(listed.status).toBe(200);
    const notion = listed.body.services.find((service: any) => service.id === 'notion');
    expect(notion).toMatchObject({ allowedScope: [db1], connected: false, scopeKey: 'databases' });
    expect(notion.credentialFields).toEqual([{ key: 'token', label: expect.any(String), type: 'password' }]);

    const rejected = await request(app).post('/api/services/notion/test').set('Authorization', `Bearer ${token}`);
    expect(rejected.status).toBe(502);
    expect(rejected.body.status).toBe('unhealthy');
    const checked = await request(app).post('/api/services/notion/test').set('Authorization', `Bearer ${token}`);
    expect(checked.status).toBe(200);
    const [url, init] = fetchFn.mock.calls[1]!;
    expect(String(url)).toBe(`https://api.notion.com/v1/databases/${db1}`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer notion-test-token');
    const afterCheck = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    expect(afterCheck.body.services.find((service: any) => service.id === 'notion').connected).toBe(true);
  });

  it('stores only registered credential fields and a valid Notion database scope', async () => {
    const db1 = '00000000-0000-0000-0000-000000000001';
    const saveCredentials = vi.fn().mockResolvedValue({});
    const app = createApp({ jwtSecret: secret, credentialRepo: { saveCredentials } as any, encryptionKey: key, serviceAdminUserIds: ['user-a'] });
    const invalid = await request(app).post('/api/services/notion/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ credentials: { token: 'notion-test-token' }, allowedScope: ['not-a-uuid'] });
    expect(invalid.status).toBe(400);
    expect(saveCredentials).not.toHaveBeenCalled();

    const saved = await request(app).post('/api/services/notion/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ credentials: { token: 'notion-test-token', unwanted: 'discard-me' }, allowedScope: [` ${db1} `, db1] });
    expect(saved.status).toBe(200);
    const encrypted = saveCredentials.mock.calls[0]![1];
    expect(decryptCredentials(encrypted, key)).toEqual({ token: 'notion-test-token', allowedScope: { databases: [db1] } });
  });

  it('exposes live planner tools only for services with valid credentials and scope', async () => {
    const db1 = '00000000-0000-0000-0000-000000000001';
    const configured = encryptCredentials({ token: 'notion-test-token', allowedScope: { databases: [db1] } }, key);
    const unscoped = encryptCredentials({ botToken: 'xoxb-test', allowedScope: { channels: [] } }, key);
    const repo = { getCredentials: async (service: string) => service === 'notion' ? { config: configured } : service === 'slack' ? { config: unscoped } : null };
    const catalog = await getConfiguredToolCatalog(repo as any, key);
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((tool) => tool.service === 'notion')).toBe(true);
    expect(catalog.some((tool) => tool.name === 'notion.create_page')).toBe(true);
  });
});
