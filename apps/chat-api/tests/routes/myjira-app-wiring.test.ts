import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, type AppOptions } from '../../src/app.js';
import { validateEnv } from '../../src/config/env.js';
import { generateAccessToken } from '../../src/auth/jwt.js';

interface AppOptionsWithJira extends AppOptions {
  jira?: {
    enabled: boolean;
    oauth?: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      mode?: 'live' | 'fixture';
      fixtureBaseUrl?: string;
      timeoutMs?: number;
    };
    repo?: any;
    tokens?: any;
    client?: any;
    fetchFn?: typeof fetch;
    jiraTimeoutMs?: number;
    onConnectionChanged?: (userId: string) => void;
  };
}

describe('MyJira App Wiring & Flag-Off Invariants (JIRA-04 Task 6)', () => {
  const jwtSecret = 'test_jwt_secret_min_32_characters_long_for_wiring';
  const callerUser = {
    id: 'user-caller-1111-1111-111111111111',
    email: 'caller@example.test',
    name: 'Caller User',
    role: 'member' as const,
    status: 'active' as const,
  };
  const otherUser = {
    id: 'user-other-2222-2222-222222222222',
    email: 'other@example.test',
    name: 'Other User',
    role: 'member' as const,
    status: 'active' as const,
  };
  const callerSessionId = '44444444-4444-4444-4444-444444444444';

  function createCallerToken(userId = callerUser.id, sessionId = callerSessionId): string {
    return generateAccessToken(
      { id: userId, email: callerUser.email, name: callerUser.name, role: 'member', status: 'active' },
      jwtSecret,
      sessionId
    ).accessToken;
  }

  function createMockSessionRepo() {
    return {
      findActiveUser: vi.fn(async (sid: string, userId: string) => {
        if (sid === callerSessionId) {
          if (userId === callerUser.id) {
            return {
              id: callerUser.id,
              email: callerUser.email,
              name: callerUser.name,
              role: callerUser.role,
              status: callerUser.status,
              sid: callerSessionId,
            };
          }
          if (userId === otherUser.id) {
            return {
              id: otherUser.id,
              email: otherUser.email,
              name: otherUser.name,
              role: otherUser.role,
              status: otherUser.status,
              sid: callerSessionId,
            };
          }
        }
        return null;
      }),
      get: vi.fn(async (sessionId: string) => {
        if (sessionId === callerSessionId) {
          return { id: callerSessionId, userId: callerUser.id, isValid: true, createdAt: new Date() };
        }
        return null;
      }),
      create: vi.fn(async (userId: string) => ({ sessionId: callerSessionId })),
      revoke: vi.fn(async () => {}),
      revokeAllForUser: vi.fn(async () => {}),
      touch: vi.fn(async () => {}),
    };
  }

  function createMockStatesRepo() {
    return {
      createState: vi.fn(async (params: any) => ({
        id: 'state-uuid-1',
        rawState: 'test_raw_state_token_value_xyz',
        stateHash: 'state-hash-xyz',
        mode: params.mode,
        expiresAt: new Date(Date.now() + 600000),
      })),
      consumeState: vi.fn(async () => ({
        id: 'state-uuid-1',
        rawState: 'test_raw_state_token_value_xyz',
        stateHash: 'state-hash-xyz',
        mode: 'connect_jira_identity',
        userId: callerUser.id,
        sessionId: callerSessionId,
        browserCookieHash: 'cookie-hash',
        returnTo: null,
      })),
    };
  }

  function createMockConvRepo(conversations: Map<string, { id: string; user_id: string }>) {
    return {
      getConversation: vi.fn(async (id: string) => conversations.get(id) ?? null),
      createConversation: vi.fn(),
      listConversations: vi.fn(),
      deleteConversation: vi.fn(),
      updateConversation: vi.fn(),
    };
  }

  function createMockJiraRepo() {
    return {
      getConnectionStatus: vi.fn(async () => ({
        connected: false,
        identity: null,
        grant: null,
        sites: [],
      })),
      disconnect: vi.fn(async () => ({
        disconnected: true,
        identityVersion: 2,
      })),
      saveIdentityGrant: vi.fn(),
      saveSitesGrant: vi.fn(),
      syncSites: vi.fn(),
    };
  }

  function createMockJiraTokens() {
    return {
      getAccessToken: vi.fn(async () => 'mock-access-token'),
      clear: vi.fn(),
    };
  }

  function createMockJiraClient(fetchSpy?: typeof fetch) {
    return {
      authorizationUrl: vi.fn((params: { state: string }) => {
        return `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=test-client&scope=read%3Ame&redirect_uri=http%3A%2F%2F127.0.0.1%3A4187%2Fcallback&state=${params.state}&response_type=code&prompt=consent`;
      }),
      exchangeCode: vi.fn(),
      refreshToken: vi.fn(),
      getProfile: vi.fn(),
      getAccessibleResources: vi.fn(),
      fetchFn: fetchSpy,
    };
  }

  describe('1. Environment Configuration Contract (MYJIRA_ENABLED on/off, default off)', () => {
    it('defaults MYJIRA_ENABLED to false when omitted or empty', () => {
      const config = validateEnv({});
      expect(config.MYJIRA_ENABLED).toBe(false);
    });

    it('accepts MYJIRA_ENABLED="off" and resolves to false', () => {
      const config = validateEnv({ MYJIRA_ENABLED: 'off' });
      expect(config.MYJIRA_ENABLED).toBe(false);
    });

    it('accepts MYJIRA_ENABLED="on" and resolves to true', () => {
      const config = validateEnv({ MYJIRA_ENABLED: 'on' });
      expect(config.MYJIRA_ENABLED).toBe(true);
    });

    it('rejects stale plan flag values like "true", "false", "1", "yes" with contract error', () => {
      expect(() => validateEnv({ MYJIRA_ENABLED: 'true' })).toThrow(/MYJIRA_ENABLED must be on or off/);
      expect(() => validateEnv({ MYJIRA_ENABLED: 'false' })).toThrow(/MYJIRA_ENABLED must be on or off/);
      expect(() => validateEnv({ MYJIRA_ENABLED: '1' })).toThrow(/MYJIRA_ENABLED must be on or off/);
      expect(() => validateEnv({ MYJIRA_ENABLED: 'yes' })).toThrow(/MYJIRA_ENABLED must be on or off/);
    });

    it('enforces required OAuth variables in live mode when MYJIRA_ENABLED="on"', () => {
      const baseLiveEnv = {
        RUNTIME_MODE: 'live',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ati_v3',
        JWT_SECRET: '01234567890123456789012345678901_jwt_secret',
        ENCRYPTION_KEY: 'fedcba9876543210fedcba9876543210',
        GEMINI_API_KEY: 'mock-gemini-key',
        MYJIRA_ENABLED: 'on',
      };

      expect(() => validateEnv({ ...baseLiveEnv })).toThrow(
        /JIRA_OAUTH_CLIENT_ID is required when MYJIRA_ENABLED=on in live mode/
      );

      expect(() =>
        validateEnv({
          ...baseLiveEnv,
          JIRA_OAUTH_CLIENT_ID: 'cid-1',
        })
      ).toThrow(/JIRA_OAUTH_CLIENT_SECRET is required when MYJIRA_ENABLED=on in live mode/);

      expect(() =>
        validateEnv({
          ...baseLiveEnv,
          JIRA_OAUTH_CLIENT_ID: 'cid-1',
          JIRA_OAUTH_CLIENT_SECRET: 'csec-1',
        })
      ).toThrow(/JIRA_OAUTH_REDIRECT_URI is required when MYJIRA_ENABLED=on in live mode/);
    });
  });

  describe('2. Inert 503 Guard when Absent or Disabled (jira: undefined or enabled: false)', () => {
    it('returns 503 for all /api/connections/myjira endpoints when jira options are absent', async () => {
      const app = createApp({
        jwtSecret,
        runtimeMode: 'sandbox',
      } as AppOptionsWithJira);

      const paths = [
        { method: 'get', url: '/api/connections/myjira' },
        { method: 'post', url: '/api/connections/myjira/start', body: { mode: 'identity' } },
        { method: 'post', url: '/api/connections/myjira/callback', body: { code: 'c', state: 's' } },
        { method: 'post', url: '/api/connections/myjira/sync-sites', body: {} },
        { method: 'delete', url: '/api/connections/myjira' },
      ];

      for (const p of paths) {
        const req = (request(app) as any)[p.method](p.url).set('Authorization', `Bearer ${createCallerToken()}`);
        if (p.body) req.send(p.body);
        const res = await req;
        expect(res.status, `Expected 503 for absent jira on ${p.method.toUpperCase()} ${p.url}`).toBe(503);
      }
    });

    it('returns 503 for all /api/connections/myjira endpoints when jira.enabled is false', async () => {
      const app = createApp({
        jwtSecret,
        runtimeMode: 'sandbox',
        jira: { enabled: false },
      } as AppOptionsWithJira);

      const paths = [
        { method: 'get', url: '/api/connections/myjira' },
        { method: 'post', url: '/api/connections/myjira/start', body: { mode: 'identity' } },
        { method: 'post', url: '/api/connections/myjira/callback', body: { code: 'c', state: 's' } },
        { method: 'post', url: '/api/connections/myjira/sync-sites', body: {} },
        { method: 'delete', url: '/api/connections/myjira' },
      ];

      for (const p of paths) {
        const req = (request(app) as any)[p.method](p.url).set('Authorization', `Bearer ${createCallerToken()}`);
        if (p.body) req.send(p.body);
        const res = await req;
        expect(res.status, `Expected 503 for disabled jira on ${p.method.toUpperCase()} ${p.url}`).toBe(503);
      }
    });

    it('does not trigger provider network calls or client operations when disabled', async () => {
      const fetchSpy = vi.fn();
      const client = createMockJiraClient(fetchSpy);

      const app = createApp({
        jwtSecret,
        runtimeMode: 'sandbox',
        jira: {
          enabled: false,
          client,
          fetchFn: fetchSpy,
        },
      } as AppOptionsWithJira);

      const res = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${createCallerToken()}`)
        .send({ mode: 'identity' });

      expect(res.status).toBe(503);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(client.authorizationUrl).not.toHaveBeenCalled();
      expect(client.exchangeCode).not.toHaveBeenCalled();
    });
  });

  describe('3. Mounted Route Behavior when Enabled (jira.enabled: true)', () => {
    let sessionRepo: any;
    let states: any;
    let repo: any;
    let client: any;
    let tokens: any;
    let conversations: Map<string, { id: string; user_id: string }>;
    let convRepo: any;
    let app: any;

    beforeEach(() => {
      sessionRepo = createMockSessionRepo();
      states = createMockStatesRepo();
      repo = createMockJiraRepo();
      client = createMockJiraClient();
      tokens = createMockJiraTokens();
      conversations = new Map();
      convRepo = createMockConvRepo(conversations);

      app = createApp({
        jwtSecret,
        runtimeMode: 'sandbox',
        appBaseUrl: 'http://127.0.0.1:5174',
        sessionRepo,
        states,
        convRepo: convRepo as any,
        jira: {
          enabled: true,
          oauth: {
            clientId: 'test-client',
            clientSecret: 'test-secret',
            redirectUri: 'http://127.0.0.1:4187/connections/jira/callback',
          },
          repo,
          client,
          tokens,
        },
      } as AppOptionsWithJira);
    });

    it('enforces authentication on protected endpoints', async () => {
      const unauthStatus = await request(app).get('/api/connections/myjira');
      expect(unauthStatus.status).toBe(401);

      const unauthStart = await request(app)
        .post('/api/connections/myjira/start')
        .send({ mode: 'identity' });
      expect(unauthStart.status).toBe(401);

      const unauthDelete = await request(app).delete('/api/connections/myjira');
      expect(unauthDelete.status).toBe(401);
    });

    it('handles CORS preflight and includes credentials for allowed origins', async () => {
      const allowedOrigin = 'http://127.0.0.1:4187';

      const optionsRes = await request(app)
        .options('/api/connections/myjira')
        .set('Origin', allowedOrigin);
      expect(optionsRes.status).toBe(204);
      expect(optionsRes.headers['access-control-allow-methods']).toContain('GET');
      expect(optionsRes.headers['access-control-allow-methods']).toContain('POST');
      expect(optionsRes.headers['access-control-allow-methods']).toContain('DELETE');

      const getRes = await request(app)
        .get('/api/connections/myjira')
        .set('Authorization', `Bearer ${createCallerToken()}`)
        .set('Origin', allowedOrigin);

      expect(getRes.headers['access-control-allow-origin']).toBe(allowedOrigin);
      expect(getRes.headers['access-control-allow-credentials']).toBe('true');
    });

    it('sets ati_jira_browser cookie upon starting connection flow', async () => {
      const res = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${createCallerToken()}`)
        .send({ mode: 'identity' });

      expect(res.status).toBe(200);
      expect(res.body.authUrl).toBeDefined();

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieHeader = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
      expect(cookieHeader).toContain('ati_jira_browser=');
    });
  });

  describe('4. Trusted conversationOwner from convRepo (No Request Owner Injection)', () => {
    let sessionRepo: any;
    let states: any;
    let repo: any;
    let client: any;
    let tokens: any;
    let conversations: Map<string, { id: string; user_id: string }>;
    let convRepo: any;
    let app: any;

    const callerConvId = '11111111-1111-1111-1111-111111111111';
    const otherConvId = '22222222-2222-2222-2222-222222222222';
    const nonExistentConvId = '33333333-3333-3333-3333-333333333333';

    beforeEach(() => {
      sessionRepo = createMockSessionRepo();
      states = createMockStatesRepo();
      repo = createMockJiraRepo();
      client = createMockJiraClient();
      tokens = createMockJiraTokens();

      conversations = new Map<string, { id: string; user_id: string }>([
        [callerConvId, { id: callerConvId, user_id: callerUser.id }],
        [otherConvId, { id: otherConvId, user_id: otherUser.id }],
      ]);
      convRepo = createMockConvRepo(conversations);

      app = createApp({
        jwtSecret,
        runtimeMode: 'sandbox',
        sessionRepo,
        states,
        convRepo: convRepo as any,
        jira: {
          enabled: true,
          repo,
          client,
          tokens,
        },
      } as AppOptionsWithJira);
    });

    it('allows start when returnTo points to a conversation owned by the caller in convRepo', async () => {
      const res = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${createCallerToken()}`)
        .send({
          mode: 'identity',
          returnTo: `/c/${callerConvId}`,
        });

      expect(res.status).toBe(200);
      expect(res.body.authUrl).toBeDefined();
      expect(convRepo.getConversation).toHaveBeenCalledWith(callerConvId);
    });

    it('rejects start with 400 RETURN_TO_INVALID when returnTo belongs to another user in convRepo', async () => {
      const res = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${createCallerToken()}`)
        .send({
          mode: 'identity',
          returnTo: `/c/${otherConvId}`,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RETURN_TO_INVALID');
      expect(convRepo.getConversation).toHaveBeenCalledWith(otherConvId);
    });

    it('rejects start with 400 RETURN_TO_INVALID when returnTo conversation does not exist', async () => {
      const res = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${createCallerToken()}`)
        .send({
          mode: 'identity',
          returnTo: `/c/${nonExistentConvId}`,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RETURN_TO_INVALID');
      expect(convRepo.getConversation).toHaveBeenCalledWith(nonExistentConvId);
    });

    it('prevents caller from injecting conversation owner or overriding convRepo lookup', async () => {
      // Attacker tries to pass another user's conversation but injects owner fields in the request body
      const res = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${createCallerToken()}`)
        .send({
          mode: 'identity',
          returnTo: `/c/${otherConvId}`,
          ownerUserId: callerUser.id,
          conversationOwner: callerUser.id,
          userId: callerUser.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RETURN_TO_INVALID');
      // Proves that convRepo was queried for the actual conversation owner and injected fields were disregarded
      expect(convRepo.getConversation).toHaveBeenCalledWith(otherConvId);
    });
  });

  describe('5. Public Health Endpoint Invariant', () => {
    it('does not expose jiraEnabled in /api/health when jira is absent', async () => {
      const app = createApp({
        jwtSecret,
        runtimeMode: 'sandbox',
      } as AppOptionsWithJira);

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.jiraEnabled).toBeUndefined();
    });

    it('does not expose jiraEnabled in /api/health when jira.enabled is false', async () => {
      const app = createApp({
        jwtSecret,
        runtimeMode: 'sandbox',
        jira: { enabled: false },
      } as AppOptionsWithJira);

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.jiraEnabled).toBeUndefined();
    });
  });
});
