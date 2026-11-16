import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { encryptCredentials, StepError } from '@wap/tool-adapters';
import { WorkingMemory } from '@wap/planner';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';
import { NotionOAuthClient } from '../../src/services/notion/oauth-client.js';
import { NotionTokenManager } from '../../src/services/notion/token-manager.js';
import { createNotionConnectionLookup } from '../../src/services/notion/connection-reference.js';
import { getToolCatalogFor } from '../../src/services/registered-services.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { ChatService } from '../../src/services/chat-service.js';

const key = '0123456789abcdef0123456789abcdef';

describe('Notion OAuth tool catalog, ChatService plan binding, and AdapterFactory', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credRepo: CredentialRepo;
  let convRepo: ConversationRepo;
  let msgRepo: MessageRepo;
  let planRepo: PlanRepo;
  let notionRepo: NotionConnectionRepo;
  let alice: Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

  const wsId = '11111111-2222-3333-4444-555555555555';
  const botId = '22222222-3333-4444-5555-666666666666';
  const actorId = '33333333-4444-5555-6666-777777777777';
  const db1 = '44444444-5555-6666-7777-888888888888';
  const forbiddenDb = '99999999-8888-7777-6666-555555555555';

  beforeAll(async () => {
    db = await createMigratedSchema('notion_plan');
    credRepo = new CredentialRepo(db.pool, key);
    convRepo = new ConversationRepo(db.pool);
    msgRepo = new MessageRepo(db.pool);
    planRepo = new PlanRepo(db.pool);
    notionRepo = new NotionConnectionRepo(db.pool);
    alice = await db.person('alice');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('exposes NOTION_TOOLS only after database scope is selected, binds connections.notion into plan_hash & resourceLabels, and enforces identityVersion in AdapterFactory', async () => {
    const lookup = createNotionConnectionLookup({ repo: notionRepo });

    // 1. Not connected -> no Notion tools
    const initialTools = await getToolCatalogFor(credRepo, key, {
      userId: alice.id,
      gmailEnabled: false,
      notionConnection: lookup,
    });
    expect(initialTools.filter((t) => t.service === 'notion')).toEqual([]);

    // 2. Connect Notion without scope -> status is needs_scope, still no Notion tools
    await notionRepo.start({
      userId: alice.id,
      sessionId: alice.sid,
      stateHash: NotionConnectionRepo.hash('s-plan'),
      browserHash: NotionConnectionRepo.hash('b-plan'),
    });
    const consumed = (await notionRepo.consume({
      userId: alice.id,
      sessionId: alice.sid,
      state: 's-plan',
      browser: 'b-plan',
    }))!;
    const saved = (await notionRepo.save(alice.id, consumed.id, {
      appId: 'notion-app',
      workspaceId: wsId,
      workspaceName: 'ATI Notion WS',
      actorId,
      botId,
      config: encryptCredentials(
        { accessToken: 'ntn_tok_live', refreshToken: 'ntn_ref_live', botId },
        key,
      ),
      scopes: [],
    }))!;

    expect((await lookup(alice.id)).status).toBe('needs_scope');
    const unscopedTools = await getToolCatalogFor(credRepo, key, {
      userId: alice.id,
      gmailEnabled: false,
      notionConnection: lookup,
    });
    expect(unscopedTools.filter((t) => t.service === 'notion')).toEqual([]);

    // 3. Select database scope -> status is connected, 4 Notion tools unlocked
    await notionRepo.selectDatabases(alice.id, saved.id, saved.identity_version, [
      { id: db1, title: 'Bảng Công Việc', url: 'https://www.notion.so/bang-cong-viec' },
    ]);
    const scopedLookup = await lookup(alice.id);
    expect(scopedLookup.status).toBe('connected');
    expect(scopedLookup.connection?.databaseIds).toEqual([db1]);

    const scopedTools = await getToolCatalogFor(credRepo, key, {
      userId: alice.id,
      gmailEnabled: false,
      notionConnection: lookup,
    });
    expect(scopedTools.filter((t) => t.service === 'notion').map((t) => t.name)).toEqual([
      'notion.search_databases',
      'notion.query_database',
      'notion.create_page',
      'notion.append_text',
      'notion.get_page',
      'notion.update_page',
      'notion.get_database',
      'notion.search_pages',
      'notion.append_blocks',
      'notion.list_comments',
      'notion.add_comment',
    ]);

    // 4. ChatService binds connections.notion, resolves natural-language database title, and populates resourceLabels
    const conv = await convRepo.createConversation(alice.id, 'Notion test');
    const events: Array<{ event: string; payload: any }> = [];
    const chatService = new ChatService({
      msgRepo,
      convRepo,
      planRepo,
      notionConnection: lookup,
      eventEmitter: {
        emit: (event, payload) => events.push({ event, payload }),
      },
      planner: {
        processMessage: async () => ({
          kind: 'plan',
          thinking: 'Create page in Bảng Công Việc',
          summary: 'Tạo trang mới trên Bảng Công Việc',
          warnings: [],
          steps: [
            {
              id: 'step_1',
              tool: 'notion.create_page',
              description: 'Tạo trang báo cáo tuần',
              args: {
                databaseId: 'Bảng Công Việc',
                title: 'Báo cáo tuần 45',
                content: 'Hoàn thành Notion OAuth',
              },
              dependsOn: [],
            },
          ],
        }),
        routeSchedule: () => ({ services: ['notion'], unavailable: [] }),
      },
    });

    const prepared = await (chatService as any).prepareResponse(
      { conversationId: conv.id, userId: alice.id, correlation: {} },
      await (chatService as any).planner.processMessage({
        userMessage: 'Tạo trang báo cáo tuần trên Notion',
        memory: new WorkingMemory(),
      }),
      new WorkingMemory(),
      ['Tạo trang báo cáo tuần trên Notion'],
    );
    const { planId } = await prepared.write();
    prepared.announce();

    expect(planId).toBeTruthy();
    const storedPlan = await planRepo.getPlan(planId!);
    expect(storedPlan?.plan_json.steps[0].args.databaseId).toBe(db1);
    expect(storedPlan?.plan_json.connections?.notion).toEqual({
      credentialId: saved.id,
      workspaceId: wsId,
      workspaceName: 'ATI Notion WS',
      botId,
      identityVersion: 2,
      databaseIds: [db1],
      databases: [{ id: db1, title: 'Bảng Công Việc', url: 'https://www.notion.so/bang-cong-viec' }],
    });
    expect(storedPlan?.resource_labels?.[db1]).toBe('Bảng Công Việc');
    expect(storedPlan?.plan_text).toContain('"notion"');
    const expectedHash = createHash('sha256')
      .update(storedPlan!.plan_text ?? '')
      .digest('hex');
    expect(storedPlan?.plan_hash).toBe(expectedHash);

    // 5. Rejects forbidden databaseId in ChatService.bindConnections
    const forbiddenResp = await (chatService as any).bindConnections(
      {
        kind: 'plan',
        thinking: 'Forbidden db',
        summary: 'Tạo trang',
        warnings: [],
        steps: [
          {
            id: 'step_1',
            tool: 'notion.create_page',
            description: 'Tạo trang',
            args: { databaseId: forbiddenDb, title: 'Test' },
            dependsOn: [],
          },
        ],
      },
      alice.id,
    );
    expect(forbiddenResp.kind).toBe('refusal');

    // 6. AdapterFactory executes Notion OAuth adapter and enforces identityVersion + databaseIds at execution time
    const dsId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const pageId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/databases/${db1}`)) {
        return new Response(
          JSON.stringify({
            object: 'database',
            id: db1,
            title: [{ plain_text: 'Bảng Công Việc' }],
            url: 'https://www.notion.so/bang-cong-viec',
            data_sources: [{ id: dsId }],
          }),
        );
      }
      if (url.endsWith(`/data_sources/${dsId}`)) {
        return new Response(
          JSON.stringify({
            object: 'data_source',
            id: dsId,
            parent: { type: 'database_id', database_id: db1 },
            properties: { Name: { type: 'title' } },
          }),
        );
      }
      if (url.endsWith('/pages')) {
        return new Response(
          JSON.stringify({
            object: 'page',
            id: pageId,
            url: 'https://www.notion.so/page-1',
            parent: { type: 'data_source_id', data_source_id: dsId },
            properties: { Name: { type: 'title', title: [{ plain_text: 'Báo cáo tuần 45' }] } },
          }),
        );
      }
      return new Response(JSON.stringify({ object: 'error' }), { status: 404 });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchFn);

    try {
      const oauthClient = new NotionOAuthClient(
        {
          clientId: 'notion-app',
          clientSecret: 'secret',
          redirectUri: 'http://127.0.0.1:5174/connections/notion/callback',
          authorizationUrl: 'http://127.0.0.1:4100/v1/oauth/authorize',
          apiBaseUrl: 'http://127.0.0.1:4100/v1',
        },
        fetchFn,
      );
      const tokenManager = new NotionTokenManager(notionRepo, oauthClient, key);
      const factory = new AdapterFactory({
        credentialRepo: credRepo,
        encryptionKey: key,
        notionRepo,
        notionTokens: tokenManager,
      });

      const execAdapter = await factory.getAdapterForService('notion', {
        userId: alice.id,
        phase: 'execution',
        connections: storedPlan!.plan_json.connections,
      });
      const created = await execAdapter.execute('notion.create_page', {
        databaseId: db1,
        title: 'Báo cáo tuần 45',
      });
      expect(created).toMatchObject({ id: pageId, url: 'https://www.notion.so/page-1' });

      // Bump identity_version by re-selecting scope -> old plan's identityVersion (2) must be rejected!
      await notionRepo.selectDatabases(alice.id, saved.id, 2, [
        { id: db1, title: 'Bảng Công Việc', url: 'https://www.notion.so/bang-cong-viec' },
      ]);
      factory.clearPersonal(alice.id);

      await expect(
        factory.getAdapterForService('notion', {
          userId: alice.id,
          phase: 'execution',
          connections: storedPlan!.plan_json.connections,
        }),
      ).rejects.toBeInstanceOf(StepError);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('allows shared Notion plans when user has no personal OAuth connection, and preserves healthy OAuth tokens on 403 out-of-scope errors', async () => {
    const bob = await db.person('bob_notion');
    const lookup = createNotionConnectionLookup({ repo: notionRepo });

    // F6: Bob has not connected personal Notion -> shared Notion tool (notion.create_page) must NOT be refused by bindConnections
    const chatService = new ChatService({
      msgRepo,
      convRepo,
      planRepo,
      notionConnection: lookup,
      eventEmitter: { emit: () => {} },
      planner: {
        processMessage: async () => ({
          kind: 'plan',
          thinking: 'Shared Notion create_page',
          summary: 'Tạo trang Notion shared',
          warnings: [],
          steps: [
            {
              id: 's1',
              tool: 'notion.create_page',
              description: 'Tạo trang shared',
              args: { databaseId: db1, title: 'Shared Page' },
              dependsOn: [],
            },
          ],
        }),
        routeSchedule: () => ({ services: ['notion'], unavailable: [] }),
      },
    });

    const sharedBound = await (chatService as any).bindConnections(
      {
        kind: 'plan',
        thinking: 'Shared Notion create_page',
        summary: 'Tạo trang Notion shared',
        warnings: [],
        steps: [
          {
            id: 's1',
            tool: 'notion.create_page',
            description: 'Tạo trang shared',
            args: { databaseId: db1, title: 'Shared Page' },
            dependsOn: [],
          },
        ],
      },
      bob.id,
    );
    expect(sharedBound.kind).toBe('plan');

    // Whereas personal-only Notion tool (notion.get_page) IS refused when Bob has not connected personal Notion
    const personalOnlyBound = await (chatService as any).bindConnections(
      {
        kind: 'plan',
        thinking: 'Personal Notion get_page',
        summary: 'Đọc trang Notion cá nhân',
        warnings: [],
        steps: [
          {
            id: 's1',
            tool: 'notion.get_page',
            description: 'Đọc trang',
            args: { pageId: db1 },
            dependsOn: [],
          },
        ],
      },
      bob.id,
    );
    expect(personalOnlyBound.kind).toBe('refusal');

    // F7: 403 out-of-scope error on NotionAdapter must NOT trigger refresh or wipe healthy tokens in NotionTokenManager
    await notionRepo.start({
      userId: bob.id,
      sessionId: bob.sid,
      stateHash: NotionConnectionRepo.hash('s-bob'),
      browserHash: NotionConnectionRepo.hash('b-bob'),
    });
    const consumed = (await notionRepo.consume({
      userId: bob.id,
      sessionId: bob.sid,
      state: 's-bob',
      browser: 'b-bob',
    }))!;
    const bobSaved = (await notionRepo.save(bob.id, consumed.id, {
      appId: 'notion-app',
      workspaceId: '55555555-6666-7777-8888-999999999999',
      workspaceName: 'Bob Notion WS',
      actorId,
      botId,
      config: encryptCredentials(
        { accessToken: 'ntn_bob_live', refreshToken: 'ntn_bob_ref', botId },
        key,
      ),
      scopes: [],
    }))!;
    await notionRepo.selectDatabases(bob.id, bobSaved.id, bobSaved.identity_version, [
      { id: db1, title: 'Bảng Công Việc' },
    ]);

    const refreshSpy = vi.fn();
    const fetch403 = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/oauth/token')) {
        refreshSpy();
      }
      // Return a page whose parent data_source belongs to forbiddenDb -> local 403 AUTH_ERROR
      if (url.includes('/pages/')) {
        return new Response(
          JSON.stringify({
            object: 'page',
            id: forbiddenDb,
            url: 'https://www.notion.so/forbidden-page',
            parent: { type: 'data_source_id', data_source_id: forbiddenDb },
            properties: { Name: { type: 'title', title: [{ plain_text: 'Out of scope' }] } },
          }),
        );
      }
      if (url.includes('/data_sources/')) {
        return new Response(
          JSON.stringify({
            object: 'data_source',
            id: forbiddenDb,
            parent: { type: 'database_id', database_id: forbiddenDb },
            properties: { Name: { type: 'title' } },
          }),
        );
      }
      return new Response(JSON.stringify({ object: 'error' }), { status: 404 });
    }) as unknown as typeof fetch;

    const oauthClient = new NotionOAuthClient(
      {
        clientId: 'notion-app',
        clientSecret: 'secret',
        redirectUri: 'http://127.0.0.1:5174/connections/notion/callback',
        authorizationUrl: 'http://127.0.0.1:4100/v1/oauth/authorize',
        apiBaseUrl: 'http://127.0.0.1:4100/v1',
      },
      fetch403,
    );
    const tokenManager = new NotionTokenManager(notionRepo, oauthClient, key);
    const factory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: key,
      notionRepo,
      notionTokens: tokenManager,
      serviceFetchFn: fetch403,
    });

    const bobAdapter = await factory.getAdapterForService('notion', {
      userId: bob.id,
      phase: 'execution',
      connections: {
        notion: {
          credentialId: bobSaved.id,
          workspaceId: '55555555-6666-7777-8888-999999999999',
          workspaceName: 'Bob Notion WS',
          botId,
          identityVersion: 2,
          databaseIds: [db1],
        },
      },
    });

    await expect(
      bobAdapter.execute('notion.update_page', {
        pageId: forbiddenDb,
        title: 'Should Fail 403 Without Wiping Token',
      }),
    ).rejects.toMatchObject({ category: 'AUTH_ERROR', statusCode: 403 });

    expect(refreshSpy).not.toHaveBeenCalled();
    const bobAfter = await notionRepo.getActive(bob.id, bobSaved.id);
    expect(bobAfter?.status).toBe('active');
    expect(bobAfter?.config).toBeTruthy();
  });

  it('isolates Organization shared Notion credentials from member personal Notion OAuth connections across catalog, ChatService, and AdapterFactory', async () => {
    const orgMember = await db.person('org_notion_member');
    const orgId = '77777777-1111-2222-3333-444444444444';
    const orgDb = '88888888-1111-2222-3333-444444444444';
    const personalDb = '99999999-1111-2222-3333-444444444444';
    const orgDs = 'aaaaaaaa-1111-2222-3333-444444444444';

    await db.pool.query(
      `INSERT INTO workspaces(id, name, invite_code, require_approval, created_by) VALUES($1, 'Org Workspace', 'NOTION-ORG-TEST-01', true, $2)`,
      [orgId, orgMember.id],
    );
    await db.pool.query(
      `INSERT INTO workspace_members(workspace_id, user_id, role, status) VALUES($1, $2, 'member', 'active')`,
      [orgId, orgMember.id],
    );
    await credRepo.saveCredentials(
      'notion',
      encryptCredentials({ token: 'ntn_org_shared_token', allowedScope: { databases: [orgDb] } }, key),
      null,
      orgId,
    );

    // Give the member a broken personal Notion connection (reconnect_required / needs_scope)
    await notionRepo.start({
      userId: orgMember.id,
      sessionId: orgMember.sid,
      stateHash: NotionConnectionRepo.hash('s-org-mem'),
      browserHash: NotionConnectionRepo.hash('b-org-mem'),
    });
    const consumed = (await notionRepo.consume({
      userId: orgMember.id,
      sessionId: orgMember.sid,
      state: 's-org-mem',
      browser: 'b-org-mem',
    }))!;
    await notionRepo.save(orgMember.id, consumed.id, {
      appId: 'notion-app',
      workspaceId: '12121212-3434-5656-7878-909090909090',
      workspaceName: 'Member Personal WS',
      actorId: '23232323-3434-5656-7878-909090909090',
      botId: '34343434-3434-5656-7878-909090909090',
      config: encryptCredentials({ accessToken: 'ntn_personal_tok', refreshToken: 'ntn_personal_ref', botId: '34343434-3434-5656-7878-909090909090' }, key),
      scopes: [],
    });

    const lookup = createNotionConnectionLookup({ repo: notionRepo });
    // Organization catalog exposes ONLY shared NOTION_TOOLS (never personal NOTION_OAUTH_TOOLS)
    const orgCatalog = await getToolCatalogFor(credRepo, key, {
      userId: orgMember.id,
      workspaceMode: 'organization',
      workspaceId: orgId,
      gmailEnabled: false,
      notionConnection: lookup,
    });
    expect(orgCatalog.filter((t) => t.service === 'notion').map((t) => t.name)).toEqual([
      'notion.search_databases',
      'notion.query_database',
      'notion.create_page',
      'notion.append_text',
    ]);

    const orgConv = (
      await db.pool.query(
        `INSERT INTO conversations(user_id, workspace_id, workspace_mode, title) VALUES($1, $2, 'organization', 'Org Notion Chat') RETURNING id`,
        [orgMember.id, orgId],
      )
    ).rows[0].id as string;

    const chatService = new ChatService({
      msgRepo,
      convRepo,
      planRepo,
      notionConnection: lookup,
      eventEmitter: { emit: () => {} },
      planner: { processMessage: async () => ({ kind: 'refusal', reason: 'unused' }), routeSchedule: () => ({ services: ['notion'], unavailable: [] }) },
    });

    // Org shared Notion tool plan succeeds even though member's personal Notion is in needs_scope!
    const orgPlanAllowed = await (chatService as any).bindConnections(
      {
        kind: 'plan',
        thinking: 'Org shared notion',
        summary: 'Tạo trang trong workspace tổ chức',
        warnings: [],
        steps: [{ id: 's1', tool: 'notion.create_page', description: 'Tạo trang', args: { databaseId: orgDb, title: 'Org Page' }, dependsOn: [] }],
      },
      orgMember.id,
      undefined,
      undefined,
      undefined,
      orgId,
      undefined,
      undefined,
      undefined,
      orgConv,
    );
    expect(orgPlanAllowed.kind).toBe('plan');
    expect(orgPlanAllowed.connections?.notion).toBeUndefined();

    // Personal-only Notion tool (e.g. notion.append_blocks) is refused inside organization workspace
    const personalToolInOrg = await (chatService as any).bindConnections(
      {
        kind: 'plan',
        thinking: 'Personal notion tool in org',
        summary: 'Nối block cá nhân',
        warnings: [],
        steps: [{ id: 's1', tool: 'notion.append_blocks', description: 'Nối block', args: { pageId: personalDb, content: 'Hi' }, dependsOn: [] }],
      },
      orgMember.id,
      undefined,
      undefined,
      undefined,
      orgId,
      undefined,
      undefined,
      undefined,
      orgConv,
    );
    expect(personalToolInOrg.kind).toBe('refusal');

    // AdapterFactory in organization mode uses org token (ntn_org_shared_token), NOT personal NotionConnectionRepo!
    const seenAuthHeaders: string[] = [];
    const orgFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenAuthHeaders.push(new Headers(init?.headers).get('Authorization') ?? '');
      const url = String(input);
      if (url.endsWith(`/databases/${orgDb}`)) {
        return new Response(JSON.stringify({ object: 'database', id: orgDb, title: [{ plain_text: 'Org DB' }], url: 'https://www.notion.so/orgdb', data_sources: [{ id: orgDs }] }));
      }
      if (url.endsWith(`/data_sources/${orgDs}`)) {
        return new Response(JSON.stringify({ object: 'data_source', id: orgDs, parent: { type: 'database_id', database_id: orgDb }, properties: { Name: { type: 'title' } } }));
      }
      return new Response(JSON.stringify({ object: 'list', results: [], has_more: false }));
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', orgFetch);
    try {
      const factory = new AdapterFactory({
        credentialRepo: credRepo,
        encryptionKey: key,
        notionRepo,
        serviceFetchFn: orgFetch,
      });
      const orgAdapter = await factory.getAdapterForService('notion', {
        userId: orgMember.id,
        workspaceMode: 'organization',
        workspaceId: orgId,
        phase: 'execution',
      });
      await orgAdapter.execute('notion.query_database', { databaseId: orgDb });
      expect(seenAuthHeaders.length).toBeGreaterThan(0);
      expect(seenAuthHeaders.every((h) => h === 'Bearer ntn_org_shared_token')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
