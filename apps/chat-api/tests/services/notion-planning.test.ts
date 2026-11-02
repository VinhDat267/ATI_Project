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
});
