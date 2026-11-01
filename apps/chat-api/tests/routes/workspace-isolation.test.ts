import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';
import { TrelloTeamRepo } from '../../src/db/repositories/trello-team-repo.js';
import { AdminUserRepo } from '../../src/db/repositories/admin-user-repo.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { SSEManager } from '../../src/sse/sse-manager.js';
import { TrelloTokenManager } from '../../src/services/trello/token-manager.js';
import { getToolCatalogFor } from '../../src/services/registered-services.js';
import { createTrelloConnectionLookup } from '../../src/services/trello/connection-reference.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'workspace_isolation_test_secret_32_chars!';
const key = '0123456789abcdef0123456789abcdef';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('Task 4: Workspace Isolation (Services, Trello, Conversations, Schedules & Execution)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let workspaceRepo: WorkspaceRepo;
  let adminUserRepo: AdminUserRepo;
  let convRepo: ConversationRepo;
  let msgRepo: MessageRepo;
  let planRepo: PlanRepo;
  let stepRepo: StepRepo;
  let trelloTeamRepo: TrelloTeamRepo;
  let tokenManager: TrelloTokenManager;
  let scheduleService: ScheduleService;
  let executionService: ExecutionService;
  let app: ReturnType<typeof createApp>;

  let alice: Person;
  let bob: Person;
  let charlie: Person;

  const mockOAuthConfig = {
    clientId: 'fake-trello-client-id',
    clientSecret: 'fake-trello-client-secret',
    redirectUri: 'http://127.0.0.1:5174/connections/trello/callback',
    authorizationUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    apiBaseUrl: 'https://api.trello.com/1',
  };

  const fakeFetch: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes('/oauth/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'fake-trello-access-token',
          refresh_token: 'fake-trello-refresh-token',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/organizations')) {
      return new Response(
        JSON.stringify([{ id: 'ws-1', displayName: 'Engineering Workspace' }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/boards')) {
      return new Response(
        JSON.stringify([
          { id: 'b-1', name: 'Sprint Board', idOrganization: 'ws-1', member: true },
          { id: 'b-2', name: 'Bug Tracker', idOrganization: 'ws-1', member: true },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  };

  beforeAll(async () => {
    db = await createMigratedSchema('ws_iso');
    credentials = new CredentialRepo(db.pool, key);
    workspaceRepo = new WorkspaceRepo(db.pool);
    adminUserRepo = new AdminUserRepo(db.pool);
    convRepo = new ConversationRepo(db.pool);
    msgRepo = new MessageRepo(db.pool);
    planRepo = new PlanRepo(db.pool);
    stepRepo = new StepRepo(db.pool);
    trelloTeamRepo = new TrelloTeamRepo(db.pool);
    scheduleService = new ScheduleService({ pool: db.pool, timeZone: 'Asia/Ho_Chi_Minh' });

    tokenManager = new TrelloTokenManager({
      client: {
        refresh: async (token: string) => ({
          accessToken: `access-token-for-${token}`,
          refreshToken: `refreshed-for-${token}`,
          expiresIn: 3600,
        }),
      } as any,
      credentials,
    });

    executionService = new ExecutionService({
      planRepo,
      stepRepo,
      convRepo,
      workspaceRepo,
      adapterFactory: {
        getAdapterForService: () => ({
          execute: async () => ({ success: true }),
        }),
      },
    });

    app = createApp({
      jwtSecret: secret,
      userRepo: db.users,
      adminUserRepo,
      workspaceRepo,
      credentialRepo: credentials,
      encryptionKey: key,
      serviceFetchFn: async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      convRepo,
      msgRepo,
      sseManager: new SSEManager(),
      chatService: {
        handleUserMessage: async () => ({ messageId: 'm1' }),
      } as any,
      executionService,
      trelloTeamRepo,
      trello: {
        oauth: mockOAuthConfig,
        fetchFn: fakeFetch,
        teamRepo: trelloTeamRepo,
        tokens: tokenManager,
      },
      schedules: {
        service: scheduleService,
      },
    });
  });

  beforeEach(async () => {
    await db.pool.query('TRUNCATE workspaces, workspace_members, conversations, messages, plans, execution_steps, service_credentials, trello_team_scope, trello_team_boards, schedules CASCADE');
    alice = await db.person('Alice');
    bob = await db.person('Bob');
    charlie = await db.person('Charlie');
  });

  afterAll(async () => {
    await db.close();
  });

  const tokenFor = (p: Person) =>
    generateAccessToken(p, secret, p.sid).accessToken;

  const connectUserTrello = async (person: Person) => {
    const config = encryptCredentials(
      {
        refreshToken: `refresh-token-for-${person.id}`,
        username: `${person.name.toLowerCase()}_trello`,
        memberId: `m-${person.id}`,
        email: person.email,
        connectedAt: new Date().toISOString(),
      },
      key
    );
    await credentials.upsertPersonalCredentials({
      service: 'trello',
      userId: person.id,
      config,
      status: 'active',
    });
  };

  describe('1. Services isolation in Personal workspace mode', () => {
    it('hides enterprise Google Service Accounts in personal mode and shows them otherwise', async () => {
      const aliceToken = tokenFor(alice);

      // In personal mode: google-calendar and google-sheets are omitted
      const resPersonal = await request(app)
        .get('/api/services')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal');

      expect(resPersonal.status).toBe(200);
      const personalServices = resPersonal.body.services.map((s: any) => s.id);
      expect(personalServices).not.toContain('calendar');
      expect(personalServices).not.toContain('sheets');
      expect(personalServices).not.toContain('google-calendar');
      expect(personalServices).not.toContain('google-sheets');
      expect(personalServices).toContain('slack');
      expect(personalServices).toContain('jira');
      expect(resPersonal.body.canConfigure).toBe(true);

      // Create an organization
      const org = await workspaceRepo.create(alice.id, 'Acme Corp', false);

      // In organization mode: calendar and sheets ARE included
      const resOrg = await request(app)
        .get('/api/services')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', org.id);

      expect(resOrg.status).toBe(200);
      const orgServices = resOrg.body.services.map((s: any) => s.id);
      expect(orgServices).toContain('calendar');
      expect(orgServices).toContain('sheets');
      expect(orgServices).toContain('slack');
    });

    it('isolates personal credentials per user', async () => {
      const aliceToken = tokenFor(alice);
      const bobToken = tokenFor(bob);

      // Alice configures slack in personal mode
      const resConfig = await request(app)
        .post('/api/services/slack/credentials')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal')
        .send({
          credentials: { botToken: 'xoxb-alice-slack-token' },
          allowedScope: ['C1'],
        });

      expect(resConfig.status).toBe(200);

      // Alice sees slack as configured in personal mode
      const aliceServices = await request(app)
        .get('/api/services')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal');
      const aliceSlack = aliceServices.body.services.find((s: any) => s.id === 'slack');
      expect(aliceSlack.configured).toBe(true);

      // Bob sees slack as not configured in his personal mode
      const bobServices = await request(app)
        .get('/api/services')
        .set('Authorization', `Bearer ${bobToken}`)
        .set('X-Workspace-Id', 'personal');
      const bobSlack = bobServices.body.services.find((s: any) => s.id === 'slack');
      expect(bobSlack.configured).toBe(false);
    });
  });

  describe('2. Services isolation in Organization workspace mode', () => {
    it('shares org credentials among org members and keeps them isolated from other orgs', async () => {
      const aliceToken = tokenFor(alice);
      const bobToken = tokenFor(bob);
      const charlieToken = tokenFor(charlie);

      // Alice creates Org A; Bob joins Org A
      const orgA = await workspaceRepo.create(alice.id, 'Org A', false);
      await workspaceRepo.joinByInviteCode(bob.id, orgA.inviteCode!);

      // Charlie creates Org B
      const orgB = await workspaceRepo.create(charlie.id, 'Org B', false);

      // Alice (admin of Org A) configures jira in Org A
      const resJira = await request(app)
        .post('/api/services/jira/credentials')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', orgA.id)
        .send({
          credentials: {
            siteUrl: 'https://org-a.atlassian.net',
            email: 'alice@org-a.com',
            apiToken: 'token123',
          },
          allowedScope: ['PROJECT'],
        });
      expect(resJira.status).toBe(200);

      // Bob (member of Org A) sees jira configured in Org A
      const bobOrgA = await request(app)
        .get('/api/services')
        .set('Authorization', `Bearer ${bobToken}`)
        .set('X-Workspace-Id', orgA.id);
      expect(bobOrgA.body.canConfigure).toBe(false);
      const jiraOrgA = bobOrgA.body.services.find((s: any) => s.id === 'jira');
      expect(jiraOrgA.configured).toBe(true);

      // Bob as member cannot reconfigure or delete credentials in Org A
      const bobMutate = await request(app)
        .post('/api/services/jira/credentials')
        .set('Authorization', `Bearer ${bobToken}`)
        .set('X-Workspace-Id', orgA.id)
        .send({
          credentials: {
            siteUrl: 'https://hacked.atlassian.net',
            email: 'bob@org-a.com',
            apiToken: 'token456',
          },
          allowedScope: ['PROJECT'],
        });
      expect(bobMutate.status).toBe(403);

      // Charlie in Org B sees jira as not configured
      const charlieOrgB = await request(app)
        .get('/api/services')
        .set('Authorization', `Bearer ${charlieToken}`)
        .set('X-Workspace-Id', orgB.id);
      const jiraOrgB = charlieOrgB.body.services.find((s: any) => s.id === 'jira');
      expect(jiraOrgB.configured).toBe(false);

      // Even if a global legacy credential (workspace_id IS NULL) exists, Org B MUST NOT inherit it
      await credentials.saveCredentials(
        'jira',
        encryptCredentials(
          {
            siteUrl: 'https://legacy.atlassian.net',
            email: 'legacy@example.com',
            apiToken: 'legacy-token',
            allowedScope: { projects: ['LEGACY'] },
          },
          key
        ),
        null,
        null
      );
      const charlieOrgBAfterLegacy = await request(app)
        .get('/api/services')
        .set('Authorization', `Bearer ${charlieToken}`)
        .set('X-Workspace-Id', orgB.id);
      const jiraOrgBAfterLegacy = charlieOrgBAfterLegacy.body.services.find((s: any) => s.id === 'jira');
      expect(jiraOrgBAfterLegacy.configured).toBe(false);
    });

    it('isolates service health-check cache between personal and organization workspaces', async () => {
      const aliceToken = tokenFor(alice);
      const orgA = await workspaceRepo.create(alice.id, 'Org Health A', false);

      // Configure slack in both Alice personal and Org A
      await request(app)
        .post('/api/services/slack/credentials')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal')
        .send({ credentials: { botToken: 'xoxb-alice-personal' }, allowedScope: ['C1'] });

      await request(app)
        .post('/api/services/slack/credentials')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', orgA.id)
        .send({ credentials: { botToken: 'xoxb-org-a-token' }, allowedScope: ['C2'] });

      // Test connection in Personal workspace
      const testRes = await request(app)
        .post('/api/services/slack/test')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal');
      expect(testRes.status).toBe(200);

      // Personal workspace shows slack as healthy
      const personalList = await request(app)
        .get('/api/services')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal');
      expect(personalList.body.services.find((s: any) => s.id === 'slack').connectionStatus).toBe('healthy');

      // Org A workspace must still show slack as unchecked (not polluted by personal check)
      const orgList = await request(app)
        .get('/api/services')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', orgA.id);
      expect(orgList.body.services.find((s: any) => s.id === 'slack').connectionStatus).toBe('unchecked');
    });
  });

  describe('3. Trello scope isolation', () => {
    it('saves personal Trello scope under personal:userId and organization scope under orgId', async () => {
      const aliceToken = tokenFor(alice);
      const bobToken = tokenFor(bob);

      // Connect Alice to Trello
      await connectUserTrello(alice);

      // Personal user can save scope
      const resPersonal = await request(app)
        .put('/api/connections/trello/scope')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal')
        .send({
          workspaceId: 'ws-1',
          boardIds: ['b-1'],
        });
      expect(resPersonal.status).toBe(200);

      // Verify scope was saved with personal:userId
      const alicePersonalScope = await trelloTeamRepo.get(`personal:${alice.id}`);
      expect(alicePersonalScope).not.toBeNull();
      expect(alicePersonalScope!.workspaceName).toBe('Engineering Workspace');
      expect(alicePersonalScope!.boards).toEqual([{ boardId: 'b-1', boardName: 'Sprint Board' }]);

      // Org admin can save scope under orgId
      const org = await workspaceRepo.create(alice.id, 'Engineering', false);
      const resOrg = await request(app)
        .put('/api/connections/trello/scope')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', org.id)
        .send({
          workspaceId: 'ws-1',
          boardIds: ['b-1', 'b-2'],
        });
      expect(resOrg.status).toBe(200);

      const orgScope = await trelloTeamRepo.get(org.id);
      expect(orgScope).not.toBeNull();
      expect(orgScope!.workspaceName).toBe('Engineering Workspace');
      expect(orgScope!.boards.length).toBe(2);

      // Connect Bob to Trello, then add Bob to Org as member
      await connectUserTrello(bob);
      await workspaceRepo.joinByInviteCode(bob.id, org.inviteCode!);
      const resBob = await request(app)
        .put('/api/connections/trello/scope')
        .set('Authorization', `Bearer ${bobToken}`)
        .set('X-Workspace-Id', org.id)
        .send({
          workspaceId: 'ws-1',
          boardIds: ['b-1'],
        });
      expect(resBob.status).toBe(403);
    });
  });

  describe('4. Conversation and Schedules isolation', () => {
    it('isolates conversation creation and listing between personal and organization', async () => {
      const aliceToken = tokenFor(alice);
      const org = await workspaceRepo.create(alice.id, 'Alpha Org', false);

      // Create conversation in personal
      const convPRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal');
      expect(convPRes.status).toBe(201);
      const convPId = convPRes.body.conversation.id;

      // Create conversation in Alpha Org
      const convOrgRes = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', org.id);
      expect(convOrgRes.status).toBe(201);
      const convOrgId = convOrgRes.body.conversation.id;

      // List in personal: only convPId appears
      const listP = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal');
      const listPIds = listP.body.conversations.map((c: any) => c.id);
      expect(listPIds).toContain(convPId);
      expect(listPIds).not.toContain(convOrgId);

      // List in org: only convOrgId appears
      const listOrg = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', org.id);
      const listOrgIds = listOrg.body.conversations.map((c: any) => c.id);
      expect(listOrgIds).toContain(convOrgId);
      expect(listOrgIds).not.toContain(convPId);

      // Accessing convOrg from personal returns 404
      const getWrong = await request(app)
        .get(`/api/conversations/${convOrgId}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal');
      expect(getWrong.status).toBe(404);

      // Accessing convP from org returns 404
      const getWrong2 = await request(app)
        .get(`/api/conversations/${convPId}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', org.id);
      expect(getWrong2.status).toBe(404);
    });

    it('isolates schedule mutations and run listings across workspace boundaries', async () => {
      const aliceToken = tokenFor(alice);
      const org = await workspaceRepo.create(alice.id, 'Sched Org', false);

      // Create conversation and schedule proposal in personal space
      const convP = await convRepo.createConversation(alice.id, { workspaceMode: 'personal', workspaceId: null });
      const msg = await msgRepo.createMessage(convP.id, 'assistant', 'Đề xuất lịch', {
        type: 'schedule_proposal',
        proposal: {
          action: 'create',
          name: 'Báo cáo cá nhân',
          request: 'Gửi báo cáo lên Slack',
          summary: 'Lịch cá nhân',
          recurrence: { kind: 'daily', time: '09:00' },
        },
        services: ['slack'],
        nextRuns: [],
        scheduleId: null,
        baseVersion: null,
        previous: null,
      });

      // Confirm from personal workspace -> 200
      const confirmRes = await request(app)
        .post(`/api/conversations/${convP.id}/schedule-proposals/${msg.id}/confirm`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal');
      expect(confirmRes.status).toBe(200);
      const scheduleId = confirmRes.body.schedule.id;

      // Attempting to pause, list runs, or run-now on personal schedule from org workspace -> 404
      const runsWrongWs = await request(app)
        .get(`/api/schedules/${scheduleId}/runs`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', org.id);
      expect(runsWrongWs.status).toBe(404);

      const pauseWrongWs = await request(app)
        .post(`/api/schedules/${scheduleId}/pause`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', org.id)
        .send({ version: 1 });
      expect(pauseWrongWs.status).toBe(404);

      const runNowWrongWs = await request(app)
        .post(`/api/schedules/${scheduleId}/run-now`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', org.id);
      expect(runNowWrongWs.status).toBe(404);

      // Pause from personal workspace -> 200
      const pauseRightWs = await request(app)
        .post(`/api/schedules/${scheduleId}/pause`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal')
        .send({ version: 1 });
      expect(pauseRightWs.status).toBe(200);
    });

    it('builds isolated tool catalogs for personal vs organization workspaces during planning', async () => {
      const aliceToken = tokenFor(alice);
      const orgA = await workspaceRepo.create(alice.id, 'Catalog Org A', false);
      const orgB = await workspaceRepo.create(alice.id, 'Catalog Org B', false);

      // Configure Slack in Alice's personal workspace
      await request(app)
        .post('/api/services/slack/credentials')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal')
        .send({ credentials: { botToken: 'xoxb-personal-slack' }, allowedScope: ['C1'] });

      // Configure GitHub in Org A
      await request(app)
        .post('/api/services/github/credentials')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', orgA.id)
        .send({ credentials: { token: 'ghp_orgA_token123456' }, allowedScope: ['owner/repo'] });

      // Connect Trello & save personal scope for Alice
      await connectUserTrello(alice);
      await request(app)
        .put('/api/connections/trello/scope')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Workspace-Id', 'personal')
        .send({ workspaceId: 'ws-1', boardIds: ['b-1'] });

      const trelloLookup = createTrelloConnectionLookup({
        credentialRepo: credentials,
        teamRepo: trelloTeamRepo,
        encryptionKey: key,
        tokens: tokenManager,
        client: {
          boards: async () => [{ id: 'b-1', name: 'Sprint Board', idOrganization: 'ws-1', member: true }],
        } as any,
      });

      // 1. Personal tool catalog for Alice includes slack & trello, NOT github
      const personalCatalog = await getToolCatalogFor(credentials, key, {
        userId: alice.id,
        workspaceMode: 'personal',
        workspaceId: null,
        gmailEnabled: false,
        trelloConnection: trelloLookup,
      });
      const personalServices = new Set(personalCatalog.map((t) => t.service));
      expect(personalServices.has('slack')).toBe(true);
      expect(personalServices.has('trello')).toBe(true);
      expect(personalServices.has('github')).toBe(false);

      // 2. Org A tool catalog includes github, NOT Alice's personal slack or personal trello scope
      const orgACatalog = await getToolCatalogFor(credentials, key, {
        userId: alice.id,
        workspaceMode: 'organization',
        workspaceId: orgA.id,
        gmailEnabled: false,
        trelloConnection: trelloLookup,
      });
      const orgAServices = new Set(orgACatalog.map((t) => t.service));
      expect(orgAServices.has('github')).toBe(true);
      expect(orgAServices.has('slack')).toBe(false);
      expect(orgAServices.has('trello')).toBe(false);

      // 3. Org B tool catalog is empty
      const orgBCatalog = await getToolCatalogFor(credentials, key, {
        userId: alice.id,
        workspaceMode: 'organization',
        workspaceId: orgB.id,
        gmailEnabled: false,
        trelloConnection: trelloLookup,
      });
      expect(orgBCatalog).toHaveLength(0);
    });

    it('allows GET /api/workspaces even when X-Workspace-Id header points to a pending or disabled workspace', async () => {
      const aliceToken = tokenFor(alice);
      const bobToken = tokenFor(bob);
      const org = await workspaceRepo.create(alice.id, 'Pending Lockout Org', true);
      await workspaceRepo.joinByInviteCode(bob.id, org.inviteCode!);

      // Bob is pending in org, but sends X-Workspace-Id: org.id when fetching /api/workspaces
      const res = await request(app)
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${bobToken}`)
        .set('X-Workspace-Id', org.id);
      expect(res.status).toBe(200);
      expect(res.body.personal.id).toBe('personal');
      expect(res.body.organizations[0].status).toBe('pending');
    });
  });

  describe('5. Plan approval and disabled member check', () => {
    it('allows active org member to approve plan, and blocks disabled member with 403', async () => {
      const aliceToken = tokenFor(alice);
      const bobToken = tokenFor(bob);
      const org = await workspaceRepo.create(alice.id, 'Gamma Org', false);
      await workspaceRepo.joinByInviteCode(bob.id, org.inviteCode!);

      // Bob creates a conversation in Gamma Org
      const conv = await convRepo.createConversation(bob.id, {
        workspaceMode: 'organization',
        workspaceId: org.id,
      });

      // Insert a plan for Bob in Gamma Org
      const planData = {
        convId: conv.id,
        planJson: { steps: [{ id: 's1', tool: 'slack.send_message', args: {} }] },
        planText: JSON.stringify({ steps: [{ id: 's1', tool: 'slack.send_message', args: {} }] }),
        planHash: hash({ steps: [{ id: 's1', tool: 'slack.send_message', args: {} }] }),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      };
      const plan = await planRepo.createPlan(planData);

      // When Bob is active, approving succeeds
      const approveRes = await request(app)
        .post(`/api/plans/${plan.id}/approve`)
        .set('Authorization', `Bearer ${bobToken}`)
        .set('X-Workspace-Id', org.id);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.success).toBe(true);

      // Create a second plan for Bob
      const plan2 = await planRepo.createPlan({
        ...planData,
        planJson: { steps: [{ id: 's2', tool: 'slack.send_message', args: {} }] },
        planText: JSON.stringify({ steps: [{ id: 's2', tool: 'slack.send_message', args: {} }] }),
        planHash: hash({ steps: [{ id: 's2', tool: 'slack.send_message', args: {} }] }),
      });

      // Alice (org admin) disables Bob in Gamma Org
      await adminUserRepo.mutateForWorkspace(alice.id, alice.sid, org.id, bob.id, 'disable');

      // Bob attempts to approve plan2 with org header: middleware blocks with 403 WORKSPACE_MEMBER_DISABLED
      const blockedRes1 = await request(app)
        .post(`/api/plans/${plan2.id}/approve`)
        .set('Authorization', `Bearer ${bobToken}`)
        .set('X-Workspace-Id', org.id);
      expect(blockedRes1.status).toBe(403);
      expect(blockedRes1.body.error).toBe('WORKSPACE_MEMBER_DISABLED');

      // Even if Bob omits the X-Workspace-Id header (legacy mode), ExecutionService blocks him with WORKSPACE_ACCESS_DENIED
      const blockedRes2 = await request(app)
        .post(`/api/plans/${plan2.id}/approve`)
        .set('Authorization', `Bearer ${bobToken}`);
      expect(blockedRes2.status).toBe(403);
      expect(blockedRes2.body.error).toBe('WORKSPACE_ACCESS_DENIED');
    });

    it('[AUDIT-A] personal workspace mode never exposes legacy shared credentials (user_id IS NULL, workspace_id IS NULL)', async () => {
      // Legacy shared Slack credential exists in DB (user_id IS NULL, workspace_id IS NULL)
      await credentials.saveCredentials(
        'slack',
        encryptCredentials({ botToken: 'xoxb-legacy-company-secret', allowedScope: { channels: ['C1'] } }, key),
        null,
        null
      );

      // Charlie is a newly self-activated user in personal workspace mode
      const charlieToken = tokenFor(charlie);
      const res = await request(app)
        .get('/api/services')
        .set('Authorization', `Bearer ${charlieToken}`)
        .set('X-Workspace-Id', 'personal');
      expect(res.status).toBe(200);
      const slack = res.body.services.find((s: any) => s.id === 'slack');
      expect(slack.configured).toBe(false);
    });

    it('[AUDIT-B] blocks a disabled or active member from accessing an organization conversation or SSE stream when X-Workspace-Id is omitted or personal', async () => {
      const aliceToken = tokenFor(alice);
      const bobToken = tokenFor(bob);
      const org = await workspaceRepo.create(alice.id, 'Strict Org', false);
      await workspaceRepo.joinByInviteCode(bob.id, org.inviteCode!);

      const conv = await convRepo.createConversation(bob.id, {
        workspaceMode: 'organization',
        workspaceId: org.id,
      });

      // Disable Bob in Strict Org
      await adminUserRepo.mutateForWorkspace(alice.id, alice.sid, org.id, bob.id, 'disable');

      // Omitting X-Workspace-Id cannot read or post to org conversation
      const getNoHeader = await request(app)
        .get(`/api/conversations/${conv.id}`)
        .set('Authorization', `Bearer ${bobToken}`);
      expect(getNoHeader.status).toBe(404);

      const postNoHeader = await request(app)
        .post(`/api/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${bobToken}`)
        .send({ content: 'đọc Slack' });
      expect(postNoHeader.status).toBe(404);

      // Opening SSE stream on org conversation as a disabled member is blocked with 403
      const streamRes = await request(app)
        .get(`/api/conversations/${conv.id}/stream`)
        .set('Authorization', `Bearer ${bobToken}`);
      expect(streamRes.status).toBe(403);
    });

    it('[AUDIT-I] AdapterFactory.clearCache evicts only the targeted workspace or personal entry without sweeping unrelated workspaces', async () => {
      const orgA = await workspaceRepo.create(alice.id, 'Cache Org A', false);
      const orgB = await workspaceRepo.create(bob.id, 'Cache Org B', false);

      await credentials.upsertCredentials(
        'slack',
        encryptCredentials({ botToken: 'xoxb-cache-org-a', allowedScope: { channels: ['CA'] } }, key),
        'active',
        alice.email,
        orgA.id
      );
      await credentials.upsertCredentials(
        'slack',
        encryptCredentials({ botToken: 'xoxb-cache-org-b', allowedScope: { channels: ['CB'] } }, key),
        'active',
        bob.email,
        orgB.id
      );

      const factory = new AdapterFactory({ credentialRepo: credentials, encryptionKey: key });
      const adapterA1 = await factory.getAdapterForService('slack', {
        phase: 'planning',
        workspaceMode: 'organization',
        workspaceId: orgA.id,
      });
      const adapterB1 = await factory.getAdapterForService('slack', {
        phase: 'planning',
        workspaceMode: 'organization',
        workspaceId: orgB.id,
      });

      // Clear only Org A's slack cache
      factory.clearCache('slack', orgA.id);

      const adapterA2 = await factory.getAdapterForService('slack', {
        phase: 'planning',
        workspaceMode: 'organization',
        workspaceId: orgA.id,
      });
      const adapterB2 = await factory.getAdapterForService('slack', {
        phase: 'planning',
        workspaceMode: 'organization',
        workspaceId: orgB.id,
      });

      expect(adapterA2).not.toBe(adapterA1);
      expect(adapterB2).toBe(adapterB1);
    });
  });
});
