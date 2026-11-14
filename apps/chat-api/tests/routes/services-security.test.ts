import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { generateAccessToken, generateTokens } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { getConfiguredToolCatalog, getToolCatalogFor } from '../../src/services/registered-services.js';

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

  it('still lists services when one shared credential cannot be decrypted with the current key', async () => {
    const db1 = '00000000-0000-0000-0000-000000000001';
    // Row written by a server started with a different ENCRYPTION_KEY: AES-GCM auth fails on read.
    const foreign = encryptCredentials({ token: 'notion-test-token', allowedScope: { databases: [db1] } }, 'another-encryption-key-of-32-bytes!');
    const readable = encryptCredentials({ botToken: 'xoxb-k', allowedScope: { channels: ['C1'] } }, key);
    const app = createApp({ jwtSecret: secret, credentialRepo: {
      getCredentials: async (service: string) => service === 'notion' ? { config: foreign } : service === 'slack' ? { config: readable } : null,
    } as any, encryptionKey: key });
    const response = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    const notion = response.body.services.find((service: any) => service.id === 'notion');
    expect(notion).toMatchObject({ configured: false, connected: false, connectionStatus: 'unconfigured', allowedScope: [] });
    expect(JSON.stringify(response.body)).not.toContain('notion-test-token');
    const slack = response.body.services.find((service: any) => service.id === 'slack');
    expect(slack).toMatchObject({ configured: true, allowedScope: ['C1'] });
  });

  it('reports personalStatus as scope_required when Trello/GitHub/Telegram OAuth is active with 0 selected boards/repos/chats, and connected when scope exists', async () => {
    const trelloConfig = encryptCredentials({ refreshToken: 'rt-1', username: 'vinhnguyndt1' }, key);
    const githubConfig = encryptCredentials({ accessToken: 'gho-1', login: 'vinhgh' }, key);
    const telegramNoChats = encryptCredentials({ telegramUserId: '111', username: 'vinhtg', selectedChats: [] }, key);

    let trelloBoards: Array<{ boardId: string; boardName: string }> = [];
    let githubRepos: Array<{ repoId: string; fullName: string }> = [];
    let telegramCredConfig = telegramNoChats;

    const app = createApp({
      jwtSecret: secret,
      credentialRepo: {
        getCredentials: async () => null,
        getPersonalCredentials: async () => null,
        getPersonalConnectionStatus: async (service: string) => {
          if (service === 'trello') return { id: 'c-trello', status: 'active', config: trelloConfig, updated_at: new Date() };
          if (service === 'github') return { id: 'c-github', status: 'active', config: githubConfig, updated_at: new Date() };
          if (service === 'telegram') return { id: 'c-tg', status: 'active', config: telegramCredConfig, updated_at: new Date() };
          return null;
        },
      } as any,
      encryptionKey: key,
      trelloTeamRepo: {
        get: async () => ({ boards: trelloBoards }),
      } as any,
      githubTeamRepo: {
        get: async () => ({ repos: githubRepos }),
      } as any,
    });

    // 1. 0 boards / repos / chats -> scope_required
    const resEmpty = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    expect(resEmpty.status).toBe(200);
    const trelloEmpty = resEmpty.body.services.find((s: any) => s.id === 'trello');
    const githubEmpty = resEmpty.body.services.find((s: any) => s.id === 'github');
    const telegramEmpty = resEmpty.body.services.find((s: any) => s.id === 'telegram');
    expect(trelloEmpty).toMatchObject({ personalStatus: 'scope_required', username: 'vinhnguyndt1', allowedScope: [] });
    expect(githubEmpty).toMatchObject({ personalStatus: 'scope_required', username: 'vinhgh', allowedScope: [] });
    expect(telegramEmpty).toMatchObject({ personalStatus: 'scope_required', username: 'vinhtg', allowedScope: [] });

    // 2. Boards / repos / chats configured -> connected with allowedScope populated
    trelloBoards = [{ boardId: 'b-123', boardName: 'Sprint 1' }];
    githubRepos = [{ repoId: 'r-1', fullName: 'ati/wap-v3' }];
    telegramCredConfig = encryptCredentials(
      { telegramUserId: '111', username: 'vinhtg', selectedChats: [{ chatId: '111', title: 'Private', type: 'private' }] },
      key
    );

    const resScoped = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    expect(resScoped.status).toBe(200);
    const trelloScoped = resScoped.body.services.find((s: any) => s.id === 'trello');
    const githubScoped = resScoped.body.services.find((s: any) => s.id === 'github');
    const telegramScoped = resScoped.body.services.find((s: any) => s.id === 'telegram');
    expect(trelloScoped).toMatchObject({ personalStatus: 'connected', username: 'vinhnguyndt1', allowedScope: ['b-123'] });
    expect(githubScoped).toMatchObject({ personalStatus: 'connected', username: 'vinhgh', allowedScope: ['ati/wap-v3'] });
    expect(telegramScoped).toMatchObject({ personalStatus: 'connected', username: 'vinhtg', allowedScope: ['111'] });
  });

  it('still returns 200 on GET /api/services when trelloTeamRepo.get or githubTeamRepo.get rejects with a DB error', async () => {
    const trelloConfig = encryptCredentials({ refreshToken: 'rt-1', username: 'vinhnguyndt1' }, key);
    const githubConfig = encryptCredentials({ accessToken: 'gho-1', login: 'vinhgh' }, key);

    const app = createApp({
      jwtSecret: secret,
      credentialRepo: {
        getCredentials: async () => null,
        getPersonalCredentials: async () => null,
        getPersonalConnectionStatus: async (service: string) => {
          if (service === 'trello') return { id: 'c-trello', status: 'active', config: trelloConfig, updated_at: new Date() };
          if (service === 'github') return { id: 'c-github', status: 'active', config: githubConfig, updated_at: new Date() };
          return null;
        },
      } as any,
      encryptionKey: key,
      trelloTeamRepo: {
        get: async () => {
          throw new Error('DB connection error reading trello_team_scope');
        },
      } as any,
      githubTeamRepo: {
        get: async () => {
          throw new Error('DB connection error reading github_team_scope');
        },
      } as any,
    });

    const res = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const trello = res.body.services.find((s: any) => s.id === 'trello');
    const github = res.body.services.find((s: any) => s.id === 'github');
    expect(trello).toMatchObject({ personalStatus: 'scope_required', username: 'vinhnguyndt1', allowedScope: [] });
    expect(github).toMatchObject({ personalStatus: 'scope_required', username: 'vinhgh', allowedScope: [] });
  });

  it('logs a warning without leaking secrets and skips undecryptable credentials in getConfiguredToolCatalog and getToolCatalogFor while preserving healthy services', async () => {
    const foreignKey = 'another-encryption-key-of-32-bytes!';
    const foreignNotion = encryptCredentials(
      { token: 'ntn_secret_token_999', allowedScope: { databases: ['00000000-0000-0000-0000-000000000001'] } },
      foreignKey,
    );
    const healthySlack = encryptCredentials(
      { botToken: 'xoxb-healthy-token', allowedScope: { channels: ['C01234567'] } },
      key,
    );
    const foreignGmail = encryptCredentials(
      { refreshToken: 'rt-gmail-secret', email: 'a@example.test' },
      foreignKey,
    );
    const healthyMyCal = encryptCredentials(
      {
        refreshToken: 'rt-cal-valid',
        email: 'a@example.test',
        selectedCalendars: [{ id: 'primary', summary: 'Primary' }],
        allowedScope: { calendars: ['primary'] },
      },
      key,
    );

    const repo = {
      getCredentials: async (service: string) => {
        if (service === 'notion') return { config: foreignNotion };
        if (service === 'slack') return { config: healthySlack };
        return null;
      },
      getPersonalCredentials: async (service: string) => {
        if (service === 'gmail') return { id: 'c-gmail', status: 'active', config: foreignGmail };
        if (service === 'mycalendar') return { id: 'c-mycal', status: 'active', config: healthyMyCal };
        return null;
      },
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const catalog = await getToolCatalogFor(repo as any, key, {
        userId: 'user-a',
        gmailEnabled: true,
        mycalendarEnabled: true,
      });

      const services = new Set(catalog.map((t) => t.service));
      expect(services.has('slack')).toBe(true);
      expect(services.has('mycalendar')).toBe(true);
      expect(services.has('notion')).toBe(false);
      expect(services.has('gmail')).toBe(false);

      const warnText = warnSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(warnText).toContain('notion');
      expect(warnText).toContain('gmail');
      expect(warnText).not.toContain('ntn_secret_token_999');
      expect(warnText).not.toContain('rt-gmail-secret');
      expect(warnText).not.toContain(foreignNotion);
      expect(warnText).not.toContain(foreignGmail);
      expect(warnText).not.toContain(key);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('reports Notion OAuth personalStatus, allowedScope, and NOTION_OAUTH_TOOLS when shared Notion is unconfigured (1h)', async () => {
    const db1 = '00000000-0000-0000-0000-000000000001';
    let activeRow: any = {
      id: 'n-conn-1',
      userId: 'user-a',
      status: 'active',
      encryptedToken: 'v1:encrypted-token',
      workspaceId: 'ws-1',
      workspaceName: 'Acme Notion',
      botId: 'bot-1',
      selectedDatabases: [{ id: db1, title: 'Tasks' }],
    };

    const app = createApp({
      jwtSecret: secret,
      credentialRepo: {
        getCredentials: async () => null,
        getPersonalCredentials: async () => null,
        getPersonalConnectionStatus: async () => null,
      } as any,
      encryptionKey: key,
      notionConnectionRepo: {
        getActive: async () => activeRow,
      } as any,
    });

    const resConnected = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    expect(resConnected.status).toBe(200);
    const notionConnected = resConnected.body.services.find((s: any) => s.id === 'notion');
    expect(notionConnected).toMatchObject({
      connection: 'personal',
      configured: true,
      connected: true,
      connectionStatus: 'healthy',
      personalStatus: 'connected',
      allowedScope: [db1],
    });
    expect(notionConnected.tools).toEqual(
      expect.arrayContaining(['notion.create_page', 'notion.get_page', 'notion.update_page']),
    );

    activeRow = { ...activeRow, selectedDatabases: [] };
    const resScopeRequired = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    const notionScope = resScopeRequired.body.services.find((s: any) => s.id === 'notion');
    expect(notionScope).toMatchObject({
      connected: false,
      personalStatus: 'scope_required',
      allowedScope: [],
    });

    activeRow = { ...activeRow, status: 'reconnect_required' };
    const resReconnect = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    const notionReconnect = resReconnect.body.services.find((s: any) => s.id === 'notion');
    expect(notionReconnect).toMatchObject({
      connected: false,
      personalStatus: 'reconnect_required',
      allowedScope: [],
    });
  });

  it('AUD-W2-04: does not report myjira as connected/healthy or leak raw cloudIds in Personal Mode', async () => {
    let jiraConnected = true;
    const app = createApp({
      jwtSecret: secret,
      credentialRepo: {
        getCredentials: async () => null,
        getPersonalCredentials: async () => null,
      } as any,
      encryptionKey: key,
      sessionRepo: {
        findActiveUser: async () => ({ id: 'user-a', email: 'a@example.test', name: 'A', sid: '00000000-0000-0000-0000-000000000001' }),
      } as any,
      states: {} as any,
      jira: {
        enabled: true,
        oauth: {
          clientId: 'cid',
          clientSecret: 'csec',
          redirectUri: 'http://localhost:5174/cb',
        },
        repo: {
          getConnectionStatus: async () => ({
            connected: jiraConnected,
            connectionState: jiraConnected ? 'connected' : 'not_connected',
            sites: jiraConnected ? [{ cloudId: 'raw-cloud-id-secret', name: 'Secret Site', url: 'https://secret.atlassian.net' }] : [],
          }),
        } as any,
        tokens: {} as any,
      },
    });

    // Personal mode (no X-Workspace-Id / mode !== 'organization') with identity connected
    const sidToken = generateAccessToken(
      { id: 'user-a', email: 'a@example.test', name: 'A' },
      secret,
      '00000000-0000-0000-0000-000000000001',
    ).accessToken;
    const resPersonalConnected = await request(app).get('/api/services').set('Authorization', `Bearer ${sidToken}`);
    expect(resPersonalConnected.status).toBe(200);
    const myjiraPersonal = resPersonalConnected.body.services.find((s: any) => s.id === 'myjira');
    expect(myjiraPersonal).toMatchObject({
      connected: false,
      configured: false,
      connectionStatus: 'needs_scope',
      personalStatus: 'scope_required',
      allowedScope: [],
    });
    expect(JSON.stringify(myjiraPersonal)).not.toContain('raw-cloud-id-secret');

    // Personal mode when not connected
    jiraConnected = false;
    const resPersonalUnconnected = await request(app).get('/api/services').set('Authorization', `Bearer ${sidToken}`);
    const myjiraUnconnected = resPersonalUnconnected.body.services.find((s: any) => s.id === 'myjira');
    expect(myjiraUnconnected).toMatchObject({
      connected: false,
      configured: false,
      connectionStatus: 'unconfigured',
      allowedScope: [],
    });
    expect(myjiraUnconnected.personalStatus).toBeUndefined();
  });

  it('verifies live GitHub repo membership when githubOAuthClient and githubTokens are provided (2e)', async () => {
    const githubConfig = encryptCredentials({ accessToken: 'gho-live', login: 'octocat' }, key);
    let callerRepos: Array<{ fullName: string; member?: boolean }> = [];

    const app = createApp({
      jwtSecret: secret,
      credentialRepo: {
        getCredentials: async () => null,
        getPersonalCredentials: async () => null,
        getPersonalConnectionStatus: async (service: string) =>
          service === 'github' ? { id: 'c-gh', status: 'active', config: githubConfig, updated_at: new Date() } : null,
      } as any,
      encryptionKey: key,
      githubTeamRepo: {
        get: async () => ({ repos: [{ repoId: 'r-1', fullName: 'org/private-repo' }] }),
      } as any,
      githubTokens: {
        forConnection: () => ({ getAccessToken: async () => 'gho-live' }),
      } as any,
      githubOAuthClient: {
        repos: async () => callerRepos,
      },
    });

    // 0 accessible repos -> needs_membership, connected: false, connectionStatus: 'needs_scope'
    const resNoAccess = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    expect(resNoAccess.status).toBe(200);
    const ghNoAccess = resNoAccess.body.services.find((s: any) => s.id === 'github');
    expect(ghNoAccess).toMatchObject({
      connected: false,
      configured: false,
      connectionStatus: 'needs_scope',
      personalStatus: 'needs_membership',
      allowedScope: [],
    });

    // Accessible repo -> connected: true, connectionStatus: 'healthy'
    callerRepos = [{ fullName: 'org/private-repo', member: true }];
    const resAccess = await request(app).get('/api/services').set('Authorization', `Bearer ${token}`);
    const ghAccess = resAccess.body.services.find((s: any) => s.id === 'github');
    expect(ghAccess).toMatchObject({
      connected: true,
      configured: true,
      connectionStatus: 'healthy',
      personalStatus: 'connected',
      allowedScope: ['org/private-repo'],
    });
  });
});
