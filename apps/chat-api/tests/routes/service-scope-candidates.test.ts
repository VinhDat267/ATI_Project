import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createServicesRoutes } from '../../src/routes/services-routes.js';

const KEY = '0'.repeat(64);
const PAGES: Record<string, any> = {
  '': {
    ok: true,
    channels: [
      { id: 'C2', name: 'zeta', is_private: false, is_member: false },
      { id: 'C1', name: 'alpha', is_private: false, is_member: true },
    ],
    response_metadata: { next_cursor: 'P2' },
  },
  P2: { ok: true, channels: [{ id: 'G1', name: 'secret', is_private: true, is_member: true }], response_metadata: { next_cursor: '' } },
};

function slackFetch() {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('Authorization');
    const cursor = new URL(url.toString()).searchParams.get('cursor') ?? '';
    const body = auth === 'Bearer xoxb-bad' ? { ok: false, error: 'invalid_auth' } : PAGES[cursor] ?? { ok: false, error: 'invalid_cursor' };
    return { ok: true, status: 200, json: async () => body } as any;
  });
}

function app(opts: { workspace?: any; storedToken?: string; fetchFn: any }) {
  const credentialRepo: any = {
    getCredentials: vi.fn(async () =>
      opts.storedToken ? { config: encryptCredentials({ botToken: opts.storedToken, allowedScope: { channels: ['C1'] } }, KEY) } : null,
    ),
    getPersonalCredentials: vi.fn(async () => null),
  };
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => { req.user = { id: 'u1', email: 'admin@x' }; req.workspace = opts.workspace; next(); });
  a.use('/api/services', createServicesRoutes({ credentialRepo, encryptionKey: KEY, fetchFn: opts.fetchFn, adminUserIds: ['u1'] }));
  return { a, credentialRepo };
}

const ADMIN = { mode: 'organization', workspaceId: 'w1', role: 'admin' };

describe('POST /api/services/:service/scope-candidates (Slack channel picker)', () => {
  it('lists every page with unsaved credentials, joined channels first, and flags channels without the bot', async () => {
    const fetchFn = slackFetch();
    const res = await request(app({ fetchFn, workspace: ADMIN }).a)
      .post('/api/services/slack/scope-candidates').send({ credentials: { botToken: 'xoxb-new' } });
    expect(res.status).toBe(200);
    expect(res.body.items.map((c: any) => c.id)).toEqual(['C1', 'G1', 'C2']);
    expect(res.body.items[0]).toEqual({ id: 'C1', label: '#alpha' });
    expect(res.body.items[1]).toEqual({ id: 'G1', label: '🔒 secret' });
    expect(res.body.items[2].warning).toMatch(/invite/);
    expect(res.body.truncated).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]![0].toString()).toContain('/conversations.list?');
  });

  it('falls back to the stored credential of the caller workspace', async () => {
    const fetchFn = slackFetch();
    const { a, credentialRepo } = app({ fetchFn, storedToken: 'xoxb-stored', workspace: ADMIN });
    const res = await request(a).post('/api/services/slack/scope-candidates').send({});
    expect(res.status).toBe(200);
    expect(credentialRepo.getCredentials).toHaveBeenCalledWith('slack', 'w1');
    expect(new Headers(fetchFn.mock.calls[0]![1]!.headers).get('Authorization')).toBe('Bearer xoxb-stored');
  });

  it('forbids organization members who are not admins, without contacting the provider', async () => {
    const fetchFn = slackFetch();
    const res = await request(app({ fetchFn, workspace: { ...ADMIN, role: 'member' } }).a)
      .post('/api/services/slack/scope-candidates').send({ credentials: { botToken: 'xoxb-new' } });
    expect(res.status).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps an invalid token to a clear error, and asks for credentials when none exist', async () => {
    const fetchFn = slackFetch();
    const bad = await request(app({ fetchFn, workspace: ADMIN }).a).post('/api/services/slack/scope-candidates').send({ credentials: { botToken: 'xoxb-bad' } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('SLACK_TOKEN_INVALID');
    const none = await request(app({ fetchFn, workspace: ADMIN }).a).post('/api/services/slack/scope-candidates').send({});
    expect(none.status).toBe(400);
    expect(none.body.code).toBe('CREDENTIALS_REQUIRED');
  });

  it('returns 404 for services without a picker', async () => {
    const fetchFn = slackFetch();
    const res = await request(app({ fetchFn, workspace: ADMIN }).a).post('/api/services/trello/scope-candidates').send({});
    expect(res.status).toBe(404);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('GET /api/services advertises scopeCandidates and extended Slack tools (including slack.read_thread)', async () => {
    const fetchFn = slackFetch();
    const res = await request(app({ fetchFn, workspace: ADMIN }).a).get('/api/services');
    expect(res.status).toBe(200);
    const slack = res.body.services.find((s: any) => s.id === 'slack');
    expect(slack).toBeDefined();
    expect(slack.scopeCandidates).toBe(true);
    expect(slack.tools).toContain('slack.read_messages');
    expect(slack.tools).toContain('slack.read_thread');
    expect(slack.scopes).toEqual(expect.arrayContaining(['chat:write', 'channels:read', 'groups:read', 'channels:history', 'groups:history']));
  });

  it('POST /api/services/slack/scope-candidates fails closed in personal mode when userId is missing', async () => {
    const fetchFn = slackFetch();
    const credentialRepo: any = {
      getCredentials: vi.fn(async () => ({
        config: encryptCredentials({ botToken: 'xoxb-shared', allowedScope: { channels: ['C1'] } }, KEY),
      })),
      getPersonalCredentials: vi.fn(async () => null),
    };
    const a = express();
    a.use(express.json());
    a.use((req: any, _res, next) => { req.workspace = { mode: 'personal' }; next(); });
    a.use('/api/services', createServicesRoutes({ credentialRepo, encryptionKey: KEY, fetchFn: fetchFn as any }));

    const res = await request(a).post('/api/services/slack/scope-candidates').send({});
    expect(res.status).toBe(401);
    expect(credentialRepo.getCredentials).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
